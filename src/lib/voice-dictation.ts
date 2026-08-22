/**
 * voice-dictation.ts
 * The composer's microphone — record a clip, get text back.
 *
 * Distinct from realtime-voice.ts, which is a live phone call. This is
 * one-shot: hold a few seconds of audio, upload it, and drop the words into
 * the message box so they can be READ AND EDITED before anything is sent.
 * That editing step is the entire reason it is not the browser's live
 * SpeechRecognition — that wrote its guesses straight into a request, and a
 * misheard word became a question the user never asked.
 *
 * React-free for the same reason as the call controller: a MediaRecorder whose
 * cleanup depends on render timing leaves the microphone light on.
 */

/** Bars in the waveform. Matched to the composer's width, not to the audio. */
export const LEVEL_BARS = 48;

export interface DictationHandlers {
  /**
   * Current loudness per bar, newest last, each 0..1. Called on animation
   * frames while recording so the waveform can be drawn without the component
   * re-rendering on every sample.
   */
  onLevels?: (levels: number[]) => void;
  onError?: (detail: string) => void;
}

/** What a finished recording produced. */
export interface DictationResult {
  blob: Blob;
  /** Milliseconds of audio. Used to discard accidental taps. */
  durationMs: number;
}

/**
 * Recordings shorter than this are treated as a mis-tap and thrown away rather
 * than sent for transcription, which would return an empty string after a
 * pointless round trip.
 */
export const MIN_CLIP_MS = 350;

/** Pick a container the browser will actually produce. Safari differs from Chrome. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',        // Safari
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export class Dictation {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private levels: number[] = new Array(LEVEL_BARS).fill(0);
  private startedAt = 0;
  private stopped = false;

  private constructor(private handlers: DictationHandlers) {}

  /** Begin recording. Rejects only if the microphone is unavailable. */
  static async start(handlers: DictationHandlers): Promise<Dictation> {
    const d = new Dictation(handlers);
    await d.begin();
    return d;
  }

  private async begin() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    // A timeslice means a long recording is not held as one giant buffer, and
    // that a crash mid-recording still leaves the earlier chunks usable.
    this.recorder.start(250);
    this.startedAt = performance.now();

    this.watchLevels();
  }

  /** Drive the waveform from the live signal. */
  private watchLevels() {
    if (!this.stream) return;
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (this.stopped || !this.analyser) return;
      this.analyser.getByteTimeDomainData(buf);

      // RMS around the 128 midpoint, which is what silence reads as for
      // unsigned 8-bit PCM. Peak alone made the bars twitch on room noise.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Speech sits low in a 0..1 range, so it is lifted with a curve rather
      // than a flat multiplier — a linear scale looks flat until someone
      // shouts, which reads as a broken meter.
      const level = Math.min(1, Math.pow(rms * 3.2, 0.65));

      this.levels = [...this.levels.slice(1), level];
      this.handlers.onLevels?.(this.levels);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Stop and hand back what was recorded. Resolves null when the clip was too
   * short to be worth transcribing.
   */
  async stop(): Promise<DictationResult | null> {
    if (this.stopped) return null;
    const durationMs = performance.now() - this.startedAt;

    const blob = await new Promise<Blob | null>((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
      try { rec.stop(); } catch { resolve(null); }
    });

    this.teardown();

    if (!blob || !blob.size || durationMs < MIN_CLIP_MS) return null;
    return { blob, durationMs };
  }

  /** Throw the recording away and release the microphone. */
  cancel() {
    try { this.recorder?.stop(); } catch { /* already stopped */ }
    this.chunks = [];
    this.teardown();
  }

  private teardown() {
    if (this.stopped) return;
    this.stopped = true;

    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    // Stopping the tracks is what clears the browser's recording indicator;
    // closing the AudioContext alone leaves the microphone live.
    this.stream?.getTracks().forEach((t) => {
      try { t.stop(); } catch { /* already stopped */ }
    });
    this.stream = null;
    this.analyser = null;
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.recorder = null;
  }
}
