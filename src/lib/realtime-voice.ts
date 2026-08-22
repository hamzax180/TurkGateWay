/**
 * realtime-voice.ts
 * Browser half of the Realtime voice call.
 *
 * One WebRTC connection carries the caller's microphone up and the model's
 * speech back down, with a data channel alongside for events. That is the
 * whole reason this exists: the old path was speech-recognition, then a model
 * call, then a text-to-speech call, three sequential round trips that added up
 * to roughly three and a half seconds of silence per turn and could not be
 * interrupted.
 *
 * Deliberately free of React so the connection lifecycle can be reasoned about
 * on its own — chat/page.tsx is past 3,600 lines and a peer connection whose
 * teardown depends on render timing is how you leak microphones.
 *
 * ── On event names ───────────────────────────────────────────────────────
 * The Realtime event vocabulary changed across the beta and the GA release
 * (response.audio_transcript.* became response.output_audio_transcript.*, and
 * so on). Both spellings are accepted below. That is not defensiveness for its
 * own sake: this file cannot be exercised without a live API key, so the cost
 * of guessing one name wrong is a silent caption rather than a loud failure,
 * and unrecognised events are logged instead of dropped.
 */

export interface RealtimeCallHandlers {
  /** Caller's own words. `final` false means it is still being revised. */
  onUserTranscript?: (text: string, final: boolean) => void;
  /** What the agent is saying, as it says it. */
  onAgentTranscript?: (text: string, final: boolean) => void;
  /** True while the agent's audio is actually playing. */
  onSpeakingChange?: (speaking: boolean) => void;
  /**
   * Loudness of the agent's voice right now, 0..1, on animation frames.
   *
   * Exists so the on-screen orb can move with what is actually being said
   * rather than on a fixed timer. A canned pulse looks convincing for about
   * two seconds and then reads as decoration, because it keeps pulsing through
   * pauses and stays flat through emphasis.
   */
  onAudioLevel?: (level: number) => void;
  /** True while the caller is being heard — drives the listening indicator. */
  onListeningChange?: (listening: boolean) => void;
  /** The model decided the intake is done. Fires before teardown. */
  onEndCall?: (args: { service?: string; detail?: string }) => void;
  /**
   * The model called a tool other than end_call. Whatever this resolves to is
   * serialised straight back as the tool's result, so return the shape the
   * model was told to expect. Rejecting is fine — the model is told the lookup
   * failed rather than being left waiting.
   */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Connection is fully closed, whatever the reason. */
  onClosed?: (reason: string) => void;
  onError?: (detail: string) => void;
}

const SDP_URL = 'https://api.openai.com/v1/realtime/calls';

/** How long to let a closing sentence finish before dropping the line anyway. */
const HANGUP_GRACE_MS = 6000;

/**
 * How long a connection may sit in 'disconnected' before the call is given up.
 *
 * 'disconnected' is NOT terminal. It means ICE has temporarily lost
 * connectivity and is still trying — Wi-Fi roaming, a moment of packet loss, a
 * busy CPU. Browsers routinely pass through it and recover within a second or
 * two. Tearing down on sight, which is what this used to do, hung up on the
 * caller every time their network hiccuped.
 */
const RECONNECT_GRACE_MS = 8000;

/**
 * STUN is what lets the browser discover its public address behind NAT.
 * Without it only host candidates are offered, which works on an open network
 * and fails on most home and office ones — and fails at connection time, so it
 * looks like the feature is broken rather than blocked.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];

interface SessionCredentials {
  client_secret: string;
  model: string;
}

export class RealtimeCall {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  private hangupTimer: ReturnType<typeof setTimeout> | null = null;
  private meterCtx: AudioContext | null = null;
  private meterRaf: number | null = null;
  /** Pending give-up while a transient 'disconnected' state resolves itself. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private endCallSeen = false;

  private constructor(private handlers: RealtimeCallHandlers) {}

  /**
   * Open a call. Rejects if the mic is refused or the session cannot be minted;
   * everything after that is reported through handlers rather than thrown, so a
   * mid-call failure cannot leave the caller staring at an un-hung-up screen.
   */
  static async open(
    credentials: SessionCredentials,
    handlers: RealtimeCallHandlers,
  ): Promise<RealtimeCall> {
    const call = new RealtimeCall(handlers);
    await call.connect(credentials);
    return call;
  }

  private async connect({ client_secret, model }: SessionCredentials) {
    // Ask for the microphone first. If this is refused there is nothing to
    // connect and no point minting anything further.
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // the agent's own voice comes out of the same speakers
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    // The model's voice.
    //
    // This element MUST be in the document. A detached <audio> with a live
    // MediaStream is silent in several browsers no matter what autoplay
    // policy says — the connection succeeds, transcripts arrive over the data
    // channel, the remote track fires, and absolutely no sound comes out. It
    // looks exactly like a working call with a broken model.
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');   // iOS refuses to play inline without it
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    this.audioEl = audioEl;

    pc.ontrack = (event) => {
      audioEl.srcObject = event.streams[0];
      // autoplay is a request, not a guarantee. Calling play() explicitly and
      // reporting the rejection is the difference between a caller who knows
      // to tap the page and one who thinks the product is broken.
      void audioEl.play().catch(() => {
        this.handlers.onError?.('Audio is blocked by the browser. Tap the page and try again.');
      });
      if (this.handlers.onAudioLevel) this.meterRemote(event.streams[0]);
    };

    for (const track of this.mic.getAudioTracks()) {
      pc.addTrack(track, this.mic);
    }

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (event) => this.onServerEvent(event.data);
    dc.onerror = () => this.handlers.onError?.('data channel error');

    // Speak first.
    //
    // With turn detection alone the model waits to be spoken to, so the call
    // opened in total silence and the caller had to work out that it was their
    // move. Every phone call in the world starts with the person who answered
    // saying something; this is that. The greeting itself comes from the
    // session instructions, so it is already in the caller's language.
    dc.onopen = () => this.send({ type: 'response.create' });

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      // Recovered — cancel any pending give-up.
      if (state === 'connected') {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
          console.debug('[realtime] connection recovered');
        }
        return;
      }

      // Terminal. Nothing to wait for.
      if (state === 'failed') {
        this.teardown('connection failed');
        return;
      }

      // Transient. Give ICE a chance before hanging up on somebody mid-sentence.
      if (state === 'disconnected' && !this.reconnectTimer) {
        console.debug('[realtime] connection disconnected — waiting for recovery');
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.pc?.connectionState !== 'connected') {
            this.teardown('connection lost');
          }
        }, RECONNECT_GRACE_MS);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // The SDP exchange is the only direct browser→OpenAI call, and it carries
    // the ephemeral secret rather than the account key.
    const res = await fetch(`${SDP_URL}?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${client_secret}`,
        'Content-Type': 'application/sdp',
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.teardown('sdp exchange failed');
      throw new Error(`realtime sdp ${res.status}: ${detail.slice(0, 200)}`);
    }

    const answer = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    this.handlers.onListeningChange?.(true);
  }

  /**
   * Measure the agent's voice so the UI can move with it.
   *
   * Taps the received stream rather than the <audio> element: reading the
   * element would mean routing playback through WebAudio, and any mistake
   * there silences the call. This branch only observes.
   */
  private meterRemote(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      this.meterCtx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      const tick = () => {
        if (this.closed) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Speech occupies a narrow band near the bottom of 0..1, so it is
        // curved up; and smoothed, because raw RMS jitters per frame and makes
        // anything bound to it vibrate rather than breathe.
        const target = Math.min(1, Math.pow(rms * 3.5, 0.6));
        smoothed += (target - smoothed) * 0.25;
        this.handlers.onAudioLevel?.(smoothed);
        this.meterRaf = requestAnimationFrame(tick);
      };
      this.meterRaf = requestAnimationFrame(tick);
    } catch {
      // Metering is decoration. Losing it must never cost the call.
    }
  }

  // ── Server events ────────────────────────────────────────────────────────

  private onServerEvent(raw: unknown) {
    if (typeof raw !== 'string') return;
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const type: string = event?.type ?? '';

    switch (type) {
      // ── the caller's own speech ──
      case 'conversation.item.input_audio_transcription.delta':
        this.handlers.onUserTranscript?.(event.delta ?? '', false);
        return;
      case 'conversation.item.input_audio_transcription.completed':
        this.handlers.onUserTranscript?.(event.transcript ?? '', true);
        return;

      // ── what the agent is saying ──
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.handlers.onAgentTranscript?.(event.delta ?? '', false);
        return;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        this.handlers.onAgentTranscript?.(event.transcript ?? '', true);
        return;

      // ── is sound actually coming out ──
      case 'output_audio_buffer.started':
        this.handlers.onSpeakingChange?.(true);
        return;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.handlers.onSpeakingChange?.(false);
        // A closing sentence that has finished playing is the cue to drop the
        // line. Waiting for this rather than using a fixed timer is what stops
        // the goodbye being cut off mid-word.
        if (this.endCallSeen) this.teardown('call complete');
        return;

      // ── caller started/stopped talking (barge-in) ──
      case 'input_audio_buffer.speech_started':
        this.handlers.onListeningChange?.(true);
        return;
      case 'input_audio_buffer.speech_stopped':
        this.handlers.onListeningChange?.(false);
        return;

      case 'response.done':
        this.handleResponseDone(event);
        return;

      case 'error':
        this.handlers.onError?.(event.error?.message ?? 'realtime error');
        return;

      default:
        // Names shifted between beta and GA; surfacing the unknown ones is how
        // a renamed transcript event gets noticed rather than silently ignored.
        if (type.endsWith('.delta') || type.endsWith('.done')) return;  // too chatty to log
        console.debug('[realtime] unhandled event', type);
    }
  }

  /** The model finished a turn — it may have called a tool. */
  private handleResponseDone(event: any) {
    const outputs: any[] = event?.response?.output ?? [];
    for (const item of outputs) {
      if (item?.type !== 'function_call') continue;

      let args: Record<string, any> = {};
      try {
        args = JSON.parse(item.arguments ?? '{}');
      } catch {
        // A malformed argument blob is not worth refusing to act on — for
        // end_call the model has said it is done, and that is the part that
        // matters; for a lookup the empty object is a valid "no filters".
      }

      if (item.name === 'end_call') {
        // Acknowledge so the session is left in a valid state, even though we
        // are about to close it.
        this.reply(item.call_id, { ok: true });
        this.endCallSeen = true;
        this.handlers.onEndCall?.(args);

        // Backstop: if the closing audio never reports stopping — a dropped
        // packet, a renamed event — the line still drops.
        this.hangupTimer = setTimeout(() => this.teardown('call complete (timeout)'), HANGUP_GRACE_MS);
        return;
      }

      void this.runTool(item.name, item.call_id, args);
    }
  }

  /**
   * Execute a tool and hand the result back.
   *
   * Unlike the Qwen agent's tools these run in the browser, so the round trip
   * is asynchronous and the model is left mid-turn until it returns. A failure
   * therefore has to answer with something rather than nothing: silence here
   * is a caller listening to dead air while the model waits forever.
   */
  private async runTool(name: string, callId: string, args: Record<string, unknown>) {
    let result: unknown;
    try {
      result = (await this.handlers.onToolCall?.(name, args)) ?? {
        error: 'not_available',
        message: 'That lookup is not available on a call. Say so briefly and carry on.',
      };
    } catch {
      result = {
        error: 'lookup_failed',
        message: 'The lookup failed. Tell the caller you will confirm it in the chat, and carry on.',
      };
    }

    if (this.closed) return;
    this.reply(callId, result);
    // The model does not resume on its own after a tool result; this is what
    // makes it speak the answer.
    this.send({ type: 'response.create' });
  }

  /** Hand a tool's result back to the model. */
  private reply(callId: string, output: unknown) {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
  }

  private send(payload: unknown) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(payload));
    }
  }

  // ── Teardown ─────────────────────────────────────────────────────────────

  /** Hang up. Safe to call repeatedly and from any state. */
  hangUp() {
    this.teardown('hung up');
  }

  private teardown(reason: string) {
    if (this.closed) return;
    this.closed = true;

    if (this.hangupTimer) {
      clearTimeout(this.hangupTimer);
      this.hangupTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.meterRaf !== null) {
      cancelAnimationFrame(this.meterRaf);
      this.meterRaf = null;
    }
    try { void this.meterCtx?.close(); } catch { /* already closed */ }
    this.meterCtx = null;
    this.handlers.onAudioLevel?.(0);

    // Stopping the tracks is what actually releases the microphone and clears
    // the browser's recording indicator. Closing the peer connection alone
    // leaves the mic hot.
    this.mic?.getTracks().forEach((t) => {
      try { t.stop(); } catch { /* already stopped */ }
    });
    this.mic = null;

    try { this.dc?.close(); } catch { /* already closed */ }
    this.dc = null;

    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;

    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.srcObject = null;
        this.audioEl.remove();
      } catch { /* already torn down */ }
      this.audioEl = null;
    }

    this.handlers.onSpeakingChange?.(false);
    this.handlers.onListeningChange?.(false);
    this.handlers.onClosed?.(reason);
  }
}
