'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, User, Mic, Plus, ChevronDown, FileText, Menu, GraduationCap, Cpu, X, Volume2, VolumeX, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import LoadingScreen from '../components/LoadingScreen';

type Role = 'assistant' | 'user';
interface Msg { id: number; role: Role; content: string; }

export default function ChatPage() {
  const { t, isRTL, language, translateHistory } = useLanguage();
  const { token, isAuthenticated, user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [allSessions, setAllSessions] = useState<any[]>([]);

  const [assistantType, setAssistantType] = useState<'permit' | 'student' | 'lawyer'>('permit');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const QUICK_Q = [
    t('chat_q1'),
    t('chat_q2'),
    t('chat_q3'),
    t('chat_q4'),
  ];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [detectedService, setDetectedService] = useState<string | null>(null);
  const [callEnded, setCallEnded] = useState(false);
  const callTimerRef = useRef<any>(null);
  const voiceLoopRef = useRef(false);
  const msgIdRef = useRef(1);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voicesLoadedRef = useRef(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const ttsKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Initialize Speech Voices — load early, retry until populated
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        setAvailableVoices(voices);
        voicesLoadedRef.current = true;
      }
    };

    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }
    // Fallback polling — some browsers fire onvoiceschanged late
    const poll = setInterval(() => {
      if (!voicesLoadedRef.current) loadVoices();
      else clearInterval(poll);
    }, 300);
    return () => clearInterval(poll);
  }, []);

  // Load sessions on mount or when auth changes
  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      // Check for forced type from dashboard/sidebar
      const forcedType = localStorage.getItem('permitops_assistant_type') as 'permit' | 'student' | 'lawyer' | null;
      if (forcedType) {
        setAssistantType(forcedType);
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/sessions`);
          if (res?.ok) {
            const data = await res.json();
            if (!mounted) return;
            setAllSessions(data);

            // Read what Dashboard requested (if any)
            const forcedSessionId = localStorage.getItem('permitops_ask_step_session');
            if (forcedSessionId) {
              localStorage.removeItem('permitops_ask_step_session');
              const fSession = data.find((s: any) => s.id === forcedSessionId);
              setSessionId(forcedSessionId);
              setSessionTitle(fSession ? (fSession.title || '') : '');
              if (fSession && fSession.assistant_type) {
                setAssistantType(fSession.assistant_type);
              }
              return;
            }

            // Normal load: check if there's a stored active session
            const activeSessionId = localStorage.getItem('permitops_active_session_id');
            const activeSession = data.find((s: any) => s.id === activeSessionId);

            if (activeSession) {
              setSessionId(activeSession.id);
              setSessionTitle(activeSession.title || '');
              // Only override assistant type if no forced type exists
              if (!forcedType && activeSession.assistant_type) {
                setAssistantType(activeSession.assistant_type);
              }
            } else if (!activeSessionId && forcedType) {
              // Redirected from dashboard with a SPECIFIC agent but NO session
              handleNewChat();
            } else if (data.length > 0) {
              setSessionId(data[0].id);
              setSessionTitle(data[0].title || '');
              if (!forcedType && data[0].assistant_type) setAssistantType(data[0].assistant_type);
            } else {
              handleNewChat();
            }
          }
        } catch (e) {
          console.error("Failed to fetch sessions", e);
        }
      } else {
        // Ephemeral GUEST session — unique per visit but not saved in DB
        const existingGuestId = localStorage.getItem('permitops_active_session_id');
        if (existingGuestId && existingGuestId.length > 20) {
          setSessionId(existingGuestId);
        } else {
          const newId = `guest-${Math.random().toString(36).substring(2, 15)}`;
          setSessionId(newId);
          localStorage.setItem('permitops_active_session_id', newId);
        }
      }
    };
    initSession();
    return () => { mounted = false; };
  }, [token, isAuthenticated]);

  // Load messages from backend when sessionId changes
  useEffect(() => {
    const loadHistory = async () => {
      const startTime = Date.now();
      if (!sessionId) {
        // Small delay for smooth transition
        await new Promise(r => setTimeout(r, 500));
        setIsLoaded(true);
        return;
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/history/${sessionId}`);
          if (res?.ok) {
            const data = await res.json();
            setMsgs(data);
            if (data.length > 0) {
              msgIdRef.current = Math.max(...data.map((m: any) => m.id)) + 1;
            } else {
              msgIdRef.current = 1;
            }
          }
        } catch (e) {
          console.error("Failed to fetch history from backend", e);
        }
      } else if (sessionId === "default-session") {
        const saved = localStorage.getItem('permitops_chat_history');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
              setMsgs(parsed);
              msgIdRef.current = Math.max(...parsed.map((m: Msg) => m.id)) + 1;
            }
          } catch (e) {
            console.error("Failed to parse local chat history", e);
          }
        }
      }

      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      setIsLoaded(true);
    };
    loadHistory();
  }, [sessionId, token, isAuthenticated]);

  useEffect(() => {
    if (isLoaded && !isAuthenticated && sessionId === "default-session") {
      localStorage.setItem('permitops_chat_history', JSON.stringify(msgs));
    }
    if (sessionId) {
      localStorage.setItem('permitops_active_session_id', sessionId);
      // Use a specific key so Dashboard only updates when a session is set
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }
  }, [msgs, isLoaded, isAuthenticated, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  // Auto-send a question if navigated from "Ask AI about this step"
  useEffect(() => {
    if (!sessionId || !isLoaded) return;
    const pending = localStorage.getItem('permitops_ask_step');
    if (!pending) return;
    localStorage.removeItem('permitops_ask_step');
    // Small delay so the page settles first
    const timer = setTimeout(() => send(pending), 600);
    return () => clearTimeout(timer);
  }, [sessionId, isLoaded]);

  const handleNewChat = async (forceType?: string) => {
    const typeToUse = forceType || assistantType;
    if (isAuthenticated && token) {
      try {
        const res = await apiFetch(`/chat/sessions?assistant_type=${typeToUse}`, { method: 'POST' });
        if (res?.ok) {
          const data = await res.json();
          setAllSessions(prev => [data, ...prev]);
          setSessionId(data.id);
          setMsgs([]);
        }
      } catch (e) {
        console.error("Failed to create new session", e);
      }
    } else {
      // Ephemeral GUEST reset
      const newGuestId = `guest-${Math.random().toString(36).substring(2, 15)}`;
      setSessionId(newGuestId);
      localStorage.setItem('permitops_active_session_id', newGuestId);
      clearChat();
    }
  };

  const switchAssistant = (newType: 'permit' | 'student' | 'lawyer') => {
    setAssistantType(newType);
    setIsDropdownOpen(false);

    // Resume logic: find the most recent session belonging to the requested type
    const recentSession = allSessions.find(s => (s.assistant_type || 'permit') === newType);
    if (recentSession) {
      setSessionId(recentSession.id);
      setSessionTitle(recentSession.title || '');
    } else {
      handleNewChat(newType);
    }
  };

  // --- Voice Chat Logic ---
  const toggleVoice = () => {
    if (isListening || isVoiceMode) {
      hangUpCall();
    } else {
      startCall();
    }
  };

  const startCall = () => {
    setIsVoiceMode(true);
    setCallEnded(false);
    setCallDuration(0);
    setDetectedService(assistantType); // show chip immediately
    setVoiceTranscript('');
    voiceLoopRef.current = true;
    // Start call timer
    callTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);

    // Initial Greeting — short, punchy, human
    const greeting = assistantType === 'student'
      ? "Hey, I'm your student agent. What do you need?"
      : assistantType === 'lawyer'
        ? "Hello, legal agent here. Go ahead."
        : "Hey! Permit agent here. What business are you opening?";

    // Small delay for UI transition, then greet immediately
    setTimeout(() => { speak(greeting); }, 400);
  };

  const hangUpCall = () => {
    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    clearInterval(callTimerRef.current);
    // Clear TTS keepalive
    if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
    setIsListening(false);
    setIsSpeaking(false);
    setCallEnded(true);
    // Push to dashboard after 2s then close
    setTimeout(() => {
      setIsVoiceMode(false);
      setCallEnded(false);
      // Trigger dashboard refresh
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }, 3000);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Speech recognition not supported in this browser.'); return; }

    // Prime audio context so TTS fires instantly after recognition (no muted-audio glitch)
    try {
      const synth = window.speechSynthesis;
      if (synth && !synth.speaking) {
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        synth.speak(silent);
      }
    } catch (e) { }

    const rec = new SpeechRecognition();
    rec.lang = language === 'tr' ? 'tr-TR' : language === 'ar' ? 'ar-SA' : 'en-US';
    rec.continuous = true;       // phone-call style — keep listening
    rec.interimResults = true;   // show live transcript
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
      setIsListening(false);
      // Auto-restart quickly if still in call and AI isn't speaking
      if (voiceLoopRef.current && !isSpeaking) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeaking) startListening(); }, 150);
      }
    };

    rec.onerror = (e: any) => {
      if ((e.error === 'no-speech' || e.error === 'aborted') && voiceLoopRef.current) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeaking) startListening(); }, 200);
      } else if (e.error !== 'not-allowed') {
        setIsListening(false);
      }
    };

    let lastFinalTranscript = '';

    rec.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }

      const liveText = (finalTranscript || interimTranscript).trim();
      if (liveText) setVoiceTranscript(liveText);

      // Live service detection
      const lower = liveText.toLowerCase();
      if (/cafe|coffee|restaurant|shop|retail|office|bakery|pharmacy|gym|barber|permit|ruhsat|محل|مطعم|كافيه/.test(lower)) {
        setDetectedService('permit');
      } else if (/university|student|visa|scholarship|dorm|ikamet|جامعة|طالب|منحة/.test(lower)) {
        setDetectedService('student');
      } else if (/lawyer|contract|company|lawsuit|legal|court|dispute|محامي|عقد|شركة/.test(lower)) {
        setDetectedService('lawyer');
      }

      if (finalTranscript && finalTranscript !== lastFinalTranscript && finalTranscript.length > 2) {
        // Browser confirmed final — send immediately, no silence wait
        lastFinalTranscript = finalTranscript;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        handleUserFinished(finalTranscript);
        return;
      }

      // Interim: start/reset silence timer — 500ms feels like natural call pacing
      if (interimTranscript.length > 2) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (interimTranscript.trim().length > 2) handleUserFinished(interimTranscript.trim());
        }, 500);
      }
    };

    const handleUserFinished = (transcript: string) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setVoiceTranscript('');
      try { rec.stop(); } catch (e) { }
      send(transcript, true);
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch { }
  };

  const stopListening = () => {
    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  // ── Pick the best available male voice ──────────────────────────────────────
  const pickMaleVoice = (voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null => {
    const searchLangs = [lang, lang.split('-')[0]];
    const inLang = (v: SpeechSynthesisVoice) => searchLangs.some(l => v.lang.startsWith(l));

    // Explicit male names across OS/browser combos — ordered by quality
    const maleKeywords = [
      'Google UK English Male',
      'Microsoft David',
      'Microsoft Mark',
      'Microsoft Guy',
      'Daniel',          // macOS high-quality male EN
      'Aaron',           // macOS male EN-US
      'Google US English',   // usually male-sounding
      'Google UK English',
      'Fred',
      'Alex',
      'Male',
      'man',
      'Guy',
    ];

    for (const kw of maleKeywords) {
      const v = voices.find(v => inLang(v) && v.name.toLowerCase().includes(kw.toLowerCase()));
      if (v) return v;
    }
    // Fallback: any voice in the correct language
    return voices.find(inLang) ?? null;
  };

  // ── Pre-process text for natural, fast TTS ───────────────────────────────────
  const cleanForSpeech = (raw: string): string => raw
    .replace(/\[CTA: .+? \| .+?\]/g, '')           // remove CTA blocks
    .replace(/```[\s\S]*?```/g, '')                  // remove code blocks
    .replace(/`[^`]+`/g, '')                         // remove inline code
    .replace(/#+\s*/g, '')                            // remove markdown headings
    .replace(/[*_~>|]/g, '')                          // remove markdown symbols
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')              // links → label only
    .replace(/!\[.*?\]\(.*?\)/g, '')                 // remove images
    .replace(/\n{2,}/g, '. ')                         // double newline → pause
    .replace(/\n/g, ' ')                              // single newline → space
    .replace(/\s{2,}/g, ' ')                          // collapse whitespace
    .replace(/([.!?])([A-Z])/g, '$1 $2')             // ensure space after sentence
    .trim();

  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    speechQueueRef.current = [];
    isSpeechQueueActiveRef.current = false;

    const cleanText = cleanForSpeech(text);
    setFullCleanText(cleanText);
    setSpokenWordIndex(0);

    // Split into sentences — keeps punctuation, handles ellipsis & abbreviations
    const sentences = cleanText
      .match(/[^.!?\n]+(?:[.!?]+['"]?|$)/g)
      ?.map(s => s.trim())
      .filter(s => s.length > 1) ?? [cleanText];

    speechQueueRef.current = sentences;
    if (speechQueueRef.current.length > 0) processSpeechQueue();
  };

  const processSpeechQueue = () => {
    const synth = window.speechSynthesis;
    if (!synth || speechQueueRef.current.length === 0) {
      isSpeechQueueActiveRef.current = false;
      return;
    }

    isSpeechQueueActiveRef.current = true;
    const text = speechQueueRef.current.shift()!;
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtteranceRef.current = utterance;

    utterance.lang = language === 'tr' ? 'tr-TR' : language === 'ar' ? 'ar-SA' : 'en-US';

    // ── Voice parameters — human-like male, conversational speed ──
    const voices = availableVoices.length > 0 ? availableVoices : synth.getVoices();
    const bestVoice = pickMaleVoice(voices, utterance.lang);
    if (bestVoice) utterance.voice = bestVoice;

    // Natural male prosody — slightly faster than default, deep pitch
    utterance.rate  = assistantType === 'lawyer' ? 1.05 : 1.12;   // conversational fast
    utterance.pitch = assistantType === 'lawyer' ? 0.80 : 0.85;   // deep male tone
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      // Stop mic while AI speaks to prevent echo
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch { }
      // ── Chrome TTS keepalive: Chrome silently pauses synth after ~15s ──
      // Calling pause()+resume() every 12s kicks it back alive without interrupting speech.
      if (ttsKeepaliveRef.current) clearInterval(ttsKeepaliveRef.current);
      ttsKeepaliveRef.current = setInterval(() => {
        const s = window.speechSynthesis;
        if (s && s.speaking) { s.pause(); s.resume(); }
        else if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
      }, 12000);
    };

    utterance.onend = () => {
      if (speechQueueRef.current.length > 0) {
        processSpeechQueue(); // immediately chain next sentence
      } else {
        // All sentences done — clear keepalive
        if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
        setIsSpeaking(false);
        setSpokenWordIndex(-1);
        currentUtteranceRef.current = null;
        // Resume listening quickly — feels like a live call
        if (voiceLoopRef.current) {
          setTimeout(() => { if (voiceLoopRef.current) startListening(); }, 120);
        }
      }
    };

    utterance.onerror = (e: any) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return; // normal cancel
      console.warn('TTS error — skipping sentence:', e.error);
      if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
      setIsSpeaking(false);
      currentUtteranceRef.current = null;
      if (speechQueueRef.current.length > 0) processSpeechQueue();
      else if (voiceLoopRef.current) {
        setTimeout(() => { if (voiceLoopRef.current) startListening(); }, 120);
      }
    };

    synth.speak(utterance);
  };

  const handleDeleteSession = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/history/${id}?token=${token}`, { method: 'DELETE' });
      if (res?.ok) {
        setAllSessions(prev => prev.filter((s: any) => s.id !== id));
        if (sessionId === id) setSessionId(null);
        else setSessionId(prev => prev);
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const send = async (text?: string, isFromVoice: boolean = false) => {
    const q = (text ?? input).trim();
    if ((!q && !file) || busy || !sessionId) return;
    const wasListening = isListening; // Capture state before potential reset
    setInput('');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);

    const displayQ = file ? `📎 [Attached: ${file.name}]\n${q}` : q;
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: displayQ };
    setMsgs(p => [...p, userMsg]);
    setBusy(true);
    if (!sessionTitle && msgs.length === 0) {
      setSessionTitle(q.length > 35 ? q.slice(0, 32) + '...' : q || "Document Analysis");
    }

    const currentFile = file;
    setFile(null);

    try {
      let body;
      let headers: HeadersInit = {};

      if (currentFile) {
        const formData = new FormData();
        formData.append('query', q);
        formData.append('language', language);
        formData.append('session_id', sessionId);
        if (token) formData.append('token', token);
        formData.append('file', currentFile);
        formData.append('assistant_type', assistantType);
        body = formData;
        // Browser sets Content-Type multipart/form-data boundary automatically
      } else {
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({ query: q, language, context: { session_id: sessionId }, assistant_type: assistantType });
      }

      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res || !res.ok) throw new Error();
      const data = await res.json();


      if (data.session_title && data.session_title !== sessionTitle) {
        setSessionTitle(data.session_title);
        setSidebarRefresh(prev => prev + 1);
      }

      const rawContent: string = data.content ?? data.answer ?? data.response ?? 'Done.';

      // Detect topic-switch redirect signal
      if (rawContent.startsWith('REDIRECT_NEW_CHAT:')) {
        const displayMsg = rawContent.replace('REDIRECT_NEW_CHAT:', '').trim();
        setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: displayMsg }]);
        setBusy(false);
        // Auto-navigate to a new chat after 2 seconds
        setTimeout(async () => {
          await handleNewChat();
          setMsgs([]);
        }, 2000);
        return;
      }

      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: rawContent }]);

      // Auto-speak if it was a voice query or we are in call mode
      if (isVoiceMode || isFromVoice || wasListening) {
        speak(rawContent);
        setVoiceTranscript("");
      }
    } catch {
      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: "⚠️ Backend is currently offline. Please make sure the server is running." }]);
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (isAuthenticated && token && sessionId) {
      try {
        await apiFetch(`/chat/history/${sessionId}`, { method: 'DELETE' });
        setSessionId(null);
      } catch (e) {
        console.error("Failed to clear history on backend", e);
      }
    } else {
      localStorage.removeItem('permitops_chat_history');
      setMsgs([]);
      msgIdRef.current = 1;
    }
  };

  const isEmpty = msgs.length === 0;

  if (!isLoaded) return <LoadingScreen />;

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)] transition-colors duration-500">
      {/* Dynamic Background — uses CSS vars so it auto-adapts to dark mode */}
      <div className="absolute inset-0 bg-[var(--bg)] pointer-events-none transition-colors duration-500" />
      <Sidebar
        currentSessionId={sessionId}
        assistantType={assistantType}
        onSessionSelect={(id, title) => { setSessionId(id); setSessionTitle(title); }}
        onNewChat={() => handleNewChat()}
        onDeleteSession={handleDeleteSession}
        token={token}
        onSwitchAssistant={switchAssistant}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        refreshTrigger={sidebarRefresh}
      />

      <main className={`flex-1 flex flex-col min-w-0 transition-colors duration-300 relative border-[var(--border)] ${isRTL ? 'border-r' : 'border-l'}`}>
        {/* Desktop Navbar with Agent Selector */}
        <div className="hidden md:block">
          <Navbar
            isAppPage
            extraContent={
              <div className="relative" ref={dropdownRef}>
                <div
                  className={`flex items-center gap-2.5 cursor-pointer px-4 py-2 rounded-full transition-all border glass-mesh shadow-lg group hover:scale-[1.02] active:scale-95 ${assistantType === 'student' ? 'border-emerald-500/20 mesh-green shadow-emerald-500/10' :
                    assistantType === 'lawyer' ? 'border-amber-500/20 mesh-amber shadow-amber-500/10' :
                      'border-blue-500/20 mesh-blue shadow-blue-500/10'
                    }`}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <div className="relative flex items-center justify-center">
                    <Cpu size={15} className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      }`} />
                    <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${assistantType === 'student' ? 'bg-emerald-500/30' :
                      assistantType === 'lawyer' ? 'bg-amber-500/30' :
                        'bg-blue-500/30'
                      }`} />
                  </div>
                  <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${assistantType === 'student' ? 'text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-500' :
                      'text-blue-500'
                    }`}>
                    {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
                  </span>
                  <ChevronDown size={12} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''} ${assistantType === 'student' ? 'text-emerald-400 group-hover:text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-400 group-hover:text-amber-500' :
                      'text-blue-400 group-hover:text-blue-500'
                    }`} />
                </div>

                <AnimatePresence mode="wait">
                  {isDropdownOpen && (
                    <motion.div
                      key="desktop-dropdown"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 bg-[var(--surface)]/90 border border-white/10 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.3)] z-[100] overflow-hidden backdrop-blur-2xl"
                    >
                      <div className="p-2 space-y-1">
                        <div className="px-3 py-1.5 mb-2 text-[10px] font-bold text-[var(--muted)] opacity-50 uppercase tracking-widest border-b border-white/5">
                          Switch Assistant
                        </div>
                        <button
                          onClick={() => switchAssistant('permit')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'permit' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500'}`} />
                            {assistantType === 'permit' && <div className="absolute inset-0 bg-blue-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_permit')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('student')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500'}`} />
                            {assistantType === 'student' && <div className="absolute inset-0 bg-emerald-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_student')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('lawyer')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'lawyer' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500'}`} />
                            {assistantType === 'lawyer' && <div className="absolute inset-0 bg-amber-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_lawyer')}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </div>

        {/* Mobile Top Bar — Ultra-clean agent selection overlay */}
        <div className="flex md:hidden items-center justify-between px-5 h-16 shrink-0 bg-[var(--bg)]/80 backdrop-blur-xl border-b border-white/5 z-[60]">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[var(--text)] active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>

          <div
            className="flex flex-col items-center justify-center cursor-pointer group"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border active:scale-95 transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
              assistantType === 'lawyer' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                'bg-blue-500/10 border-blue-500/20 text-blue-500'
              }`}>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
              </span>
              <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {isEmpty && (
              <span className="text-[13px] font-bold text-[var(--text)]/40 mt-0.5 tracking-tight">
                {t('chat_new')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[13px] font-bold shadow-lg shadow-indigo-500/20">
                {(user.fullName || user.email || 'U')[0].toUpperCase()}
              </div>
            ) : (
              <Link href="/login" className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                <User size={16} className="text-[var(--text)]" />
              </Link>
            )}
          </div>
        </div>

        <div className="hidden md:block h-4 shrink-0" />

        {/* Gemini-Style Content Header - Desktop only */}
        <div className="hidden md:flex flex-col items-center justify-center pt-2 pb-4 shrink-0 z-30 relative">
          <span className="text-2xl font-bold text-[var(--text)] opacity-95 tracking-tight leading-none">
            {(() => {
              if (!sessionTitle || msgs.length === 0 || sessionTitle === t('chat_new')) return t('chat_new');
              const match = sessionTitle.toLowerCase().match(/^(.+?)\s+in\s+(.+)$/);
              if (match) {
                const bizKey = `biz_${match[1].trim()}`;
                const distKey = `dist_${match[2].trim().replace(/\s/g, '').toLowerCase()}`;
                const lb = t(bizKey), ld = t(distKey);
                if (lb !== bizKey && ld !== distKey) return `${lb} ${t('connect_in')} ${ld}`;
              }
              return sessionTitle;
            })()}
          </span>
        </div>

        {/* Agent Selection Dropdown — renders on both mobile & desktop */}
        <AnimatePresence mode="wait">
          {isDropdownOpen && (
            <motion.div key="mobile-dropdown-wrapper">
              {/* Backdrop Blur */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-md z-[90]"
                onClick={() => setIsDropdownOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: 20 }}
                className="fixed top-24 md:top-32 left-1/2 -translate-x-1/2 bg-[var(--surface-1)]/98 border border-white/10 rounded-[40px] md:rounded-[48px] shadow-[0_40px_100px_rgba(0,0,0,0.7)] p-4 md:p-6 w-[90vw] max-w-[440px] z-[100] flex flex-col gap-3 md:gap-4 overflow-hidden backdrop-blur-3xl"
              >
                <div className="px-5 py-2.5 border-b border-white/5 mb-2 text-center font-black uppercase tracking-[0.2em] text-[12px] text-[var(--text)] opacity-40">
                  {t('chat_switch_assistant')}
                </div>

                <div className="flex flex-col gap-2.5 md:gap-3 px-2">
                  <button
                    onClick={() => switchAssistant('permit')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'permit' ? 'bg-blue-500/10 border border-blue-500/30 shadow-[0_8px_30px_rgba(59,130,246,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-blue-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500 group-hover:border-blue-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500 group-hover:text-white'}`} />
                      {(assistantType === 'permit' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'permit' ? 'bg-blue-400' : 'bg-blue-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_permit')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_permit_desc')}</span>
                    </div>
                    {assistantType === 'permit' && <div className="ml-auto w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'student' ? 'bg-emerald-500/10 border border-emerald-500/30 shadow-[0_8px_30px_rgba(16,185,129,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-emerald-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:border-emerald-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500 group-hover:text-white'}`} />
                      {(assistantType === 'student' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'student' ? 'bg-emerald-400' : 'bg-emerald-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_student')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'lawyer' ? 'bg-amber-500/10 border border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-amber-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500 group-hover:border-amber-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500 group-hover:text-white'}`} />
                      {(assistantType === 'lawyer' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'lawyer' ? 'bg-amber-400' : 'bg-amber-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_lawyer')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_lawyer_desc')}</span>
                    </div>
                    {assistantType === 'lawyer' && <div className="ml-auto w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_#f59e0b]" />}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">

          {isEmpty ? (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-5 md:px-6 overflow-y-auto no-scrollbar">
              {/* Welcome Message — Cinematic AI Entrance */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="flex flex-col items-center justify-center text-center px-4 pt-8 md:pt-16 mb-8 md:mb-12"
              >
                <div className="relative mb-12 md:mb-20">
                  {/* Holographic scanning grid area */}
                  <div className="absolute inset-[-60px] rounded-full overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute inset-0" style={{
                      backgroundImage: `radial-gradient(circle, ${assistantType === 'student' ? 'rgba(16,185,129,0.4)' :
                        assistantType === 'lawyer' ? 'rgba(245,158,11,0.4)' :
                          'rgba(59,130,246,0.4)'
                        } 1px, transparent 1px)`,
                      backgroundSize: '16px 16px'
                    }} />
                  </div>

                  {/* Primary holographic ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      rotate: { duration: 12, repeat: Infinity, ease: "linear" },
                      scale: { duration: 4, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-15px] md:inset-[-25px] rounded-[35%] border-[1.5px] border-dashed border-red-500/40 blur-[1px]"
                  />

                  {/* Counter-rotating technical ring */}
                  <motion.div
                    animate={{
                      rotate: -360,
                      scale: [1.1, 1, 1.1],
                    }}
                    transition={{
                      rotate: { duration: 18, repeat: Infinity, ease: "linear" },
                      scale: { duration: 5, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-25px] md:inset-[-40px] rounded-full border-t border-b border-red-500/20"
                  />

                  {/* Floating technical particles (Orbital Swarm) */}
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        x: [
                          Math.cos(i * 30) * 50,
                          Math.cos(i * 30 + 120) * 70,
                          Math.cos(i * 30 + 240) * 50,
                          Math.cos(i * 30) * 50
                        ],
                        y: [
                          Math.sin(i * 30) * 50,
                          Math.sin(i * 30 + 120) * 70,
                          Math.sin(i * 30 + 240) * 50,
                          Math.sin(i * 30) * 50
                        ],
                        opacity: [0, 0.7, 0.3, 0.7, 0],
                        scale: [0, 1.2, 0.8, 1.2, 0]
                      }}
                      transition={{
                        duration: 5 + Math.random() * 8,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className={`absolute rounded-full blur-[0.4px] pointer-events-none ${i % 4 === 0 ? 'bg-white w-0.5 h-0.5' :
                        assistantType === 'student' ? 'bg-emerald-400/60 w-1 h-1 shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                          assistantType === 'lawyer' ? 'bg-amber-400/60 w-1 h-1 shadow-[0_0_5px_rgba(245,158,11,0.5)]' :
                            'bg-blue-400/60 w-1 h-1 shadow-[0_0_5px_rgba(59,130,246,0.5)]'
                        }`}
                    />
                  ))}

                  {/* Outer breathing aura */}
                  <motion.div
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 0.6, 0.3]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    className={`absolute inset-[-60px] rounded-full blur-[80px] ${assistantType === 'student' ? 'bg-emerald-600/10' :
                      assistantType === 'lawyer' ? 'bg-amber-600/10' :
                        'bg-blue-600/10'
                      }`}
                  />



                  {/* The Chip Unit */}
                  <motion.div
                    whileHover={{
                      scale: 1.05,
                      rotateY: 10,
                      rotateX: -10,
                      boxShadow: assistantType === 'student' ? '0 0 70px rgba(16,185,129,0.7)' :
                        assistantType === 'lawyer' ? '0 0 70px rgba(245,158,11,0.7)' :
                          '0 0 70px rgba(59,130,246,0.7)'
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className={`relative h-20 w-20 md:h-28 md:w-28 rounded-2xl md:rounded-3xl flex items-center justify-center overflow-hidden border ${assistantType === 'student' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-[0_0_50px_rgba(16,185,129,0.5)] border-emerald-400/40' :
                      assistantType === 'lawyer' ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_0_50px_rgba(245,158,11,0.5)] border-amber-400/40' :
                        'bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_0_50px_rgba(59,130,246,0.5)] border-blue-400/40'
                      }`}
                    style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
                  >
                    {/* Active Interior Scanning Bar */}
                    <motion.div
                      animate={{ y: ['-140%', '140%'] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-[3px] bg-white/30 blur-[1px] shadow-[0_0_15px_white] z-20"
                    />

                    <motion.div
                      animate={{
                        filter: ['drop-shadow(0 0 8px rgba(255,255,255,0.4))', 'drop-shadow(0 0 20px rgba(255,255,255,0.9))', 'drop-shadow(0 0 8px rgba(255,255,255,0.4))']
                      }}
                      style={{ transform: 'translateZ(20px)' }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Cpu size={isMobile ? 32 : 48} className="text-white" />
                    </motion.div>

                    {/* Scanning light streak */}
                    <motion.div
                      animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-24"
                    />
                  </motion.div>
                </div>

                <div className="flex flex-col items-center gap-2 mb-4">
                  <motion.span
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="text-3xl md:text-7xl font-bold text-gradient-premium tracking-tighter py-1 md:py-2"
                  >
                    {t('chat_greeting').replace('{name}', user?.fullName || (user?.email ? user.email.split('@')[0] : 'there'))}
                  </motion.span>
                  <motion.h1
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="text-2xl md:text-5xl font-bold tracking-tight text-[var(--muted)] opacity-50"
                  >
                    {t('chat_begin')}
                  </motion.h1>
                </div>
              </motion.div>

              {/* Suggestion Chips — Premium Grid */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                className="grid grid-cols-2 lg:flex lg:flex-row lg:flex-wrap lg:justify-center gap-3 md:gap-2.5 mt-8 md:mt-0 md:mb-8"
              >
                {(assistantType === 'student' ? [
                  { emoji: "🪪", label: t('chat_sug_renew'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                  { emoji: "🏛️", label: t('chat_sug_uni'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                  { emoji: "🗺️", label: t('chat_sug_roadmap'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                  { emoji: "📅", label: t('chat_sug_deadlines'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                  { emoji: "🛂", label: t('chat_sug_visas'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                  { emoji: "🆘", label: t('chat_sug_shelp'), mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' }
                ] : assistantType === 'lawyer' ? [
                  { emoji: "📑", label: t('chat_sug_contract'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                  { emoji: "🏗️", label: t('chat_sug_formation'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                  { emoji: "🤝", label: t('chat_sug_employ'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                  { emoji: "📊", label: t('chat_sug_times'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                  { emoji: "🏠", label: t('chat_sug_resid'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                  { emoji: "⚖️", label: t('chat_sug_dispute'), mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' }
                ] : [
                  { emoji: "🏢", label: t('chat_suggestion_business'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                  { emoji: "📜", label: t('chat_suggestion_permit'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                  { emoji: "📍", label: t('chat_suggestion_location'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                  { emoji: "⏳", label: t('chat_suggestion_duration'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                  { emoji: "💰", label: t('chat_suggestion_cost'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                  { emoji: "❓", label: t('chat_suggestion_help'), mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' }
                ]).map((chip, i) => (
                  <div
                    key={i}
                    onClick={() => send(chip.label)}
                    className={`lg:glass-mesh lg:${chip.mesh} text-[var(--text)] text-[13px] md:text-[16px] py-4 px-4 md:px-6 rounded-[24px] md:rounded-[28px] flex items-center gap-3 md:gap-4 font-bold select-none md:backdrop-blur-xl transition-all hover:scale-[1.02] md:hover:scale-105 active:scale-95 cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] lg:bg-[var(--surface)] lg:opacity-95 lg:shadow-[0_8px_30px_rgba(0,0,0,0.12)] group w-full lg:w-fit h-[68px] md:h-auto ${chip.border}`}
                  >
                    <div className={`w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0 group-hover:bg-[var(--surface)] transition-colors ${chip.color.replace('text', 'bg')}/10`}>
                      <span className="text-xl md:text-2xl filter drop-shadow-sm">{chip.emoji}</span>
                    </div>
                    <span className="leading-tight">{chip.label}</span>
                  </div>
                ))}
              </motion.div>

              {/* Spacer on mobile to push input down */}
              <div className="flex-1 md:hidden" />

              {/* Chat Input Pill (empty state) */}
              <div className="w-full max-w-3xl mx-auto mb-10 mt-auto px-4">
                <div className="relative flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] bg-[var(--surface-1)] shadow-sm focus-within:shadow-md transition-all">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files?.[0]) setFile(e.target.files[0]);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="hidden sm:flex p-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
                  >
                    <Plus size={22} />
                  </button>

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                    }}
                    placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything"}
                    className="flex-1 bg-transparent py-2.5 px-1 text-[16px] focus:outline-none resize-none overflow-y-auto min-h-[40px] max-h-[120px] slim-scroll"
                    rows={1}
                  />

                  <div className="flex items-center gap-1.5 pr-1">
                    {input.trim() ? (
                      <button
                        onClick={() => send()}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] hover:opacity-90 transition-all shrink-0"
                      >
                        <Send size={18} />
                      </button>
                    ) : (
                      <button
                        onClick={toggleVoice}
                        className={`relative flex items-center gap-2 px-4 py-2 rounded-full transition-all shrink-0 ${isListening
                          ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]'
                          }`}
                      >
                        {isListening && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0.5 }}
                            animate={{ scale: 1.5, opacity: 0 }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                            className="absolute inset-0 bg-red-500 rounded-full z-0"
                          />
                        )}
                        <div className="relative z-10 flex items-center gap-2">
                          {isListening ? (
                            <div className="flex items-center gap-1">
                              {[1, 2, 3].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ height: [8, 16, 8] }}
                                  transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                                  className="w-1 bg-white rounded-full"
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <div className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
                              <div className="w-0.5 h-2 bg-current rounded-full" />
                              <div className="w-0.5 h-3.5 bg-current rounded-full animate-pulse" />
                            </div>
                          )}
                          <Mic size={18} className={isListening ? 'animate-pulse' : ''} />
                          <span className="hidden sm:inline text-[13px] font-bold tracking-tight">
                            {isListening ? (t('chat_listening') || "Listening...") : (t('chat_voice') || "Voice")}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {file && (
                    <div className="absolute -top-12 left-4">
                      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                        <FileText size={12} className="text-indigo-400" />
                        <span className="truncate max-w-[120px]">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={12} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-12 pb-44 slim-scroll bg-[var(--bg)]/40 rounded-t-[40px]`} dir={isRTL ? 'rtl' : 'ltr'}>
              <AnimatePresence initial={false}>
                {msgs.map(m => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className={`group relative h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 mt-1 shadow-md border ${assistantType === 'student' ? 'from-emerald-500 to-emerald-600 shadow-emerald-500/30 border-emerald-400/30' :
                        assistantType === 'lawyer' ? 'from-amber-500 to-amber-600 shadow-amber-500/30 border-amber-400/30' :
                          'from-blue-500 to-blue-600 shadow-blue-500/30 border-blue-400/30'
                        } ${isRTL ? 'ml-4' : 'mr-4'} transition-all cursor-pointer`}
                        onClick={() => speak(translateHistory(m.content))}
                      >
                        <Cpu size={18} className="group-hover:opacity-0 transition-opacity" />
                        <Volume2 size={16} className="absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}

                    <div className={`flex flex-col max-w-[92%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[17px] leading-[1.8] whitespace-pre-wrap ${m.role === 'user'
                        ? 'px-6 py-4 rounded-3xl border border-[var(--border)] text-[var(--text)] bg-[var(--surface-1)] shadow-sm'
                        : `text-[var(--text)] px-6 py-4 rounded-3xl bg-[var(--surface-2)]/60 dark:bg-transparent border border-[var(--border)] dark:border-transparent md:border-none md:bg-transparent w-full font-normal`
                        }`}
                      >
                        {(() => {
                          const contentToRender = translateHistory(m.content);

                          if (m.role === 'assistant') {
                            // Support for custom [CTA: Label | URL] buttons
                            const parts = contentToRender.split(/(\[CTA: .+? \| .+?\])/g);

                            return (
                              <div className={`prose dark:prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
                                {parts.map((part, idx) => {
                                  const ctaMatch = part.match(/\[CTA: (.+?) \| (.+?)\]/);
                                  if (ctaMatch) {
                                    const [, label, url] = ctaMatch;
                                    return (
                                      <motion.div
                                        key={idx}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="my-6"
                                      >
                                        <Link
                                          href={url}
                                          target="_blank"
                                          className="inline-flex items-center gap-2 bg-[var(--surface-2)] hover:bg-[#3c4043] text-[var(--text)] px-8 py-3 rounded-full font-bold transition-all shadow-lg active:scale-95 border border-[var(--border)] group no-underline"
                                        >
                                          <span>{label}</span>
                                          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                        </Link>
                                      </motion.div>
                                    );
                                  }

                                  return (
                                    <ReactMarkdown
                                      key={idx}
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        p: ({ node, ...props }) => <p className="mb-6 last:mb-0" {...props} />,
                                        ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-6 space-y-2 marker:text-red-500" {...props} />,
                                        ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-6 space-y-2 marker:text-red-500" {...props} />,
                                        strong: ({ node, ...props }) => <strong className="font-bold text-[var(--text)]" {...props} />,
                                        a: ({ node, ...props }) => <a className="text-red-400 hover:underline transition-colors" {...props} />,
                                        code: ({ node, className, children, ...props }) => {
                                          const match = /language-(\w+)/.exec(className || '');
                                          const isInline = !match && !className?.includes('language-');
                                          return isInline
                                            ? <code className="bg-[var(--surface-2)] text-red-300 px-1.5 py-0.5 rounded text-[14px] font-mono" {...props}>{children}</code>
                                            : <div className="bg-[#0e0e0e] rounded-xl border border-white/10 overflow-hidden my-6"><div className="px-4 py-2 bg-white/5 text-[11px] text-white/40 font-mono uppercase tracking-widest border-b border-white/10">{match?.[1] || 'code'}</div><pre className="p-4 overflow-x-auto text-[14px] text-gray-300 font-mono leading-relaxed"><code {...props}>{children}</code></pre></div>
                                        }
                                      }}
                                    >
                                      {part}
                                    </ReactMarkdown>
                                  );
                                })}
                              </div>
                            );
                          }
                          return contentToRender;
                        })()}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {busy && (
                <motion.div
                  initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex w-full items-center justify-start py-4 ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`relative h-10 w-10 flex items-center justify-center shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing status ring */}
                    <div className={`absolute inset-0 rounded-xl border backdrop-blur-sm ${assistantType === 'student' ? 'border-emerald-500/20 bg-emerald-500/5' :
                      assistantType === 'lawyer' ? 'border-amber-500/20 bg-amber-500/5' :
                        'border-blue-500/20 bg-blue-500/5'
                      }`} />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`absolute inset-[-2px] rounded-xl border-t ${assistantType === 'student' ? 'border-emerald-500/60' :
                        assistantType === 'lawyer' ? 'border-amber-500/60' :
                          'border-blue-500/60'
                        }`}
                    />
                    <Cpu size={18} className={`${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      } animate-pulse relative z-10`} />

                    {/* Live processing blip */}
                    <motion.div
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className={`absolute -top-0.5 ${isRTL ? '-left-0.5' : '-right-0.5'} w-1.5 h-1.5 rounded-full z-20 ${assistantType === 'student' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,1)]' :
                        assistantType === 'lawyer' ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,1)]' :
                          'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,1)]'
                        }`}
                    />
                  </div>
                  <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'}`}>
                    <span className={`text-[14px] font-medium animate-pulse ${assistantType === 'student' ? 'text-emerald-500/80' :
                      assistantType === 'lawyer' ? 'text-amber-500/80' :
                        'text-blue-500/80'
                      }`}>
                      {t('agent_thinking')}
                    </span>
                  </div>
                  {isSpeaking && (
                    <button
                      onClick={() => window.speechSynthesis.cancel()}
                      className="ml-4 p-1.5 rounded-full bg-[var(--surface-2)] text-red-500 hover:text-white hover:bg-red-500 transition-all shadow-sm active:scale-95"
                      title="Stop Speaking"
                    >
                      <VolumeX size={18} />
                    </button>
                  )}
                </motion.div>
              )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}

          {/* Sticky Input Bar - Floating Gemini Pill */}
          {!isEmpty && (
            <div className="absolute bottom-0 left-0 w-full pt-16 pb-8 px-4 flex justify-center bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/90 to-transparent z-40">
              <div className="w-full max-w-3xl relative">
                <div className={`relative flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] transition-all duration-300 bg-[var(--surface-1)] shadow-sm ${busy ? 'opacity-70' : 'focus-within:shadow-md'}`}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="hidden sm:flex p-2 text-[var(--muted)] hover:text-[var(--accent)] transition-all shrink-0"
                  >
                    <Plus size={22} />
                  </button>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                    }}
                    disabled={busy}
                    placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything..."}
                    className="flex-1 bg-transparent py-2.5 px-1 text-[16px] text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:outline-none resize-none overflow-y-auto min-h-[40px] max-h-[120px] slim-scroll"
                    rows={1}
                  />
                  <div className="flex items-center gap-1.5 pr-1">
                    {input.trim() ? (
                      <button
                        onClick={() => { send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }}
                        disabled={busy}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] shadow-sm hover:opacity-90 transition-all shrink-0"
                      >
                        <Send size={18} />
                      </button>
                    ) : (
                      <button
                        onClick={toggleVoice}
                        className={`relative flex items-center gap-2 px-4 py-2 rounded-full transition-all shrink-0 ${isListening
                          ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]'
                          }`}
                      >
                        {isListening && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0.5 }}
                            animate={{ scale: 1.5, opacity: 0 }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                            className="absolute inset-0 bg-red-500 rounded-full z-0"
                          />
                        )}
                        <div className="relative z-10 flex items-center gap-2">
                          {isListening ? (
                            <div className="flex items-center gap-1">
                              {[1, 2, 3].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ height: [8, 16, 8] }}
                                  transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                                  className="w-1 bg-white rounded-full"
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <div className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
                              <div className="w-0.5 h-2 bg-current rounded-full" />
                              <div className="w-0.5 h-3.5 bg-current rounded-full animate-pulse" />
                            </div>
                          )}
                          <Mic size={18} className={isListening ? 'animate-pulse' : ''} />
                          <span className="hidden sm:inline text-[13px] font-bold tracking-tight">
                            {isListening ? (t('chat_listening') || "Listening...") : (t('chat_voice') || "Voice")}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {file && (
                    <div className="absolute -top-12 left-4">
                      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                        <FileText size={12} className="text-indigo-400" />
                        <span className="truncate max-w-[120px]">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={12} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ── ChatGPT-Style Voice Call Overlay ── */}
        <AnimatePresence>
          {isVoiceMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.35 }}
              className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
              style={{ background: 'radial-gradient(ellipse at 50% 60%, #0a0a14 0%, #05050a 100%)' }}
            >
              {/* ── Ambient background glow ── */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  animate={{ scale: isSpeaking ? [1, 1.3, 1] : [1, 1.08, 1], opacity: isSpeaking ? [0.25, 0.55, 0.25] : [0.12, 0.22, 0.12] }}
                  transition={{ duration: isSpeaking ? 1.2 : 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
                  style={{
                    background: assistantType === 'student'
                      ? 'radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%)'
                      : assistantType === 'lawyer'
                        ? 'radial-gradient(circle, rgba(245,158,11,0.4) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(96,165,250,0.45) 0%, transparent 70%)'
                  }}
                />
              </div>

              {/* ── Top bar: chip + hang up ── */}
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 pt-8 z-10">
                <div /> {/* Left flex spacer to keep chip centered and X on the right if needed, or chip left */}

                {/* Detected service chip */}
                <AnimatePresence>
                  {detectedService && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className={`flex items-center gap-2.5 px-4 py-2 rounded-full border backdrop-blur-xl shadow-lg transition-all ${
                        detectedService === 'student'
                          ? 'border-emerald-500/20 bg-emerald-500/10 shadow-emerald-500/10'
                          : detectedService === 'lawyer'
                            ? 'border-amber-500/20 bg-amber-500/10 shadow-amber-500/10'
                            : 'border-blue-500/20 bg-blue-500/10 shadow-blue-500/10'
                      }`}
                    >
                      {/* Cpu icon with animated glow — identical to navbar chip */}
                      <div className="relative flex items-center justify-center">
                        <Cpu
                          size={15}
                          className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${
                            detectedService === 'student' ? 'text-emerald-400'
                              : detectedService === 'lawyer' ? 'text-amber-400'
                                : 'text-blue-400'
                          }`}
                        />
                        <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${
                          detectedService === 'student' ? 'bg-emerald-500/30'
                            : detectedService === 'lawyer' ? 'bg-amber-500/30'
                              : 'bg-blue-500/30'
                        }`} />
                      </div>
                      <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${
                        detectedService === 'student' ? 'text-emerald-400'
                          : detectedService === 'lawyer' ? 'text-amber-400'
                            : 'text-blue-400'
                      }`}>
                        {detectedService === 'permit' ? 'Permit Agent' : detectedService === 'student' ? 'Student Agent' : 'Legal Agent'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Close / hang up */}
                <button
                  onClick={hangUpCall}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-white/8 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-white/60 hover:text-red-400 transition-all active:scale-90"
                >
                  <X size={20} />
                </button>
              </div>

              {/* ── ChatGPT-Exact Voice Orb ── */}
              <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>

                {/* The perfect circle container — clips everything inside */}
                <motion.div
                  animate={{ scale: isSpeaking ? [1, 1.04, 0.98, 1.03, 1] : isListening ? [1, 1.02, 0.99, 1.02, 1] : 1 }}
                  transition={{ duration: isSpeaking ? 1.0 : 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative overflow-hidden"
                  style={{
                    width: 220, height: 220,
                    borderRadius: '50%',
                    background: assistantType === 'student'
                      ? 'linear-gradient(160deg, #a7f3d0 0%, #34d399 40%, #059669 100%)'
                      : assistantType === 'lawyer'
                        ? 'linear-gradient(160deg, #fef3c7 0%, #fcd34d 40%, #d97706 100%)'
                        : 'linear-gradient(160deg, #e0f2fe 0%, #7dd3fc 40%, #3b82f6 100%)',
                    boxShadow: isSpeaking
                      ? assistantType === 'student'
                        ? '0 0 80px 30px rgba(52,211,153,0.45), 0 0 140px 60px rgba(16,185,129,0.2)'
                        : assistantType === 'lawyer'
                          ? '0 0 80px 30px rgba(252,211,77,0.45), 0 0 140px 60px rgba(245,158,11,0.2)'
                          : '0 0 80px 30px rgba(125,211,252,0.45), 0 0 140px 60px rgba(59,130,246,0.2)'
                      : assistantType === 'student'
                        ? '0 0 40px 10px rgba(52,211,153,0.2)'
                        : assistantType === 'lawyer'
                          ? '0 0 40px 10px rgba(252,211,77,0.2)'
                          : '0 0 40px 10px rgba(125,211,252,0.2)'
                  }}
                >
                  {/* Cloud blob 1 — large bright wisp, top-left */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['-10%', '8%', '-6%', '5%', '-10%'],
                      y: isSpeaking ? ['-15%', '10%', '-8%', '12%', '-15%'] : ['-15%', '5%', '-10%', '3%', '-15%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.8 : 8, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute"
                    style={{
                      width: '130%', height: '130%',
                      top: '-15%', left: '-15%',
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at 45% 42%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.4) 35%, transparent 65%)',
                      filter: 'blur(18px)',
                    }}
                  />
                  {/* Cloud blob 2 — medium, drifts bottom-right */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['20%', '-10%', '18%', '-5%', '20%'] : ['20%', '-5%', '12%', '-8%', '20%'],
                      y: isSpeaking ? ['20%', '-5%', '22%', '-2%', '20%'] : ['20%', '5%', '15%', '0%', '20%'],
                    }}
                    transition={{ duration: isSpeaking ? 3.2 : 10, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
                    className="absolute"
                    style={{
                      width: '110%', height: '110%',
                      top: '-5%', left: '-5%',
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(167,243,208,0.5) 30%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(254,243,199,0.5) 30%, transparent 60%)'
                          : 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(186,230,255,0.5) 30%, transparent 60%)',
                      filter: 'blur(22px)',
                    }}
                  />
                  {/* Cloud blob 3 — small bright accent, wanders freely */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-5%', '25%', '-8%', '20%', '-5%'] : ['5%', '-12%', '15%', '-5%', '5%'],
                      y: isSpeaking ? ['10%', '-12%', '18%', '-8%', '10%'] : ['-5%', '10%', '-8%', '6%', '-5%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.0 : 12, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
                    className="absolute"
                    style={{
                      width: '80%', height: '80%',
                      top: '10%', left: '10%',
                      borderRadius: '60% 40% 50% 50% / 40% 50% 50% 60%',
                      background: 'radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.85) 0%, transparent 55%)',
                      filter: 'blur(14px)',
                    }}
                  />
                  {/* Cloud blob 4 — subtle deep color layer for depth */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['15%', '-15%', '10%', '-10%', '15%'] : ['0%', '10%', '-5%', '8%', '0%'],
                      y: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['0%', '-8%', '5%', '-3%', '0%'],
                      scale: isSpeaking ? [1, 1.15, 0.9, 1.1, 1] : 1,
                    }}
                    transition={{ duration: isSpeaking ? 1.8 : 9, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
                    className="absolute inset-0"
                    style={{
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 70% 30%, rgba(16,185,129,0.45) 0%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 70% 30%, rgba(245,158,11,0.45) 0%, transparent 60%)'
                          : 'radial-gradient(ellipse at 70% 30%, rgba(59,130,246,0.5) 0%, transparent 60%)',
                      filter: 'blur(20px)',
                    }}
                  />
                </motion.div>

                {/* Soft outer glow ring — pulses on speak */}
                <motion.div
                  animate={{ opacity: isSpeaking ? [0.4, 0.8, 0.4] : isListening ? [0.2, 0.4, 0.2] : [0.1, 0.2, 0.1], scale: isSpeaking ? [1, 1.12, 1] : [1, 1.04, 1] }}
                  transition={{ duration: isSpeaking ? 1.0 : 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    width: 240, height: 240,
                    background: assistantType === 'student'
                      ? 'radial-gradient(circle, rgba(52,211,153,0.35) 0%, transparent 70%)'
                      : assistantType === 'lawyer'
                        ? 'radial-gradient(circle, rgba(252,211,77,0.35) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(125,211,252,0.4) 0%, transparent 70%)',
                    filter: 'blur(20px)',
                  }}
                />

                {/* Busy processing dots overlay */}
                {busy && !isSpeaking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex items-center justify-center z-[100]"
                  >
                    <div className="flex gap-2.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ y: [0, -15, 0], scale: [1, 1.25, 1] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                          className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.6)]"
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ── Status text + transcript ── */}
              <div className="mt-20 text-center max-w-lg px-6 z-10">
                <AnimatePresence mode="wait">
                  {callEnded ? (
                    <motion.div key="ended" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                      <p className="text-white/90 text-xl font-bold">Call Summary Saved</p>
                      <p className="text-white/40 text-sm">Your dashboard has been updated with the conversation roadmap.</p>
                    </motion.div>
                  ) : (
                    <motion.div key="active" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                      <p className="text-white/35 text-[11px] font-black uppercase tracking-[0.35em] mb-3">
                        {isSpeaking ? 'Assistant Speaking…' : isListening ? 'Listening…' : 'Connecting…'}
                      </p>
                      <motion.div
                        key={voiceTranscript}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-white/80 text-lg font-semibold leading-relaxed min-h-[32px]"
                      >
                        {isListening ? (
                          voiceTranscript ? voiceTranscript : (
                            <div className="flex items-center justify-center h-[32px] gap-2 mt-2">
                              {[0, 1, 2].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ y: [0, -6, 0], scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                                  className={`w-2.5 h-2.5 rounded-full ${assistantType === 'student' ? 'bg-emerald-400/80' : assistantType === 'lawyer' ? 'bg-amber-400/80' : 'bg-blue-400/80'}`}
                                />
                              ))}
                            </div>
                          )
                        ) : isSpeaking ? (
                          fullCleanText.split(' ').slice(0, 12).map((w, i) => (
                            <motion.span key={i} animate={{ opacity: i < spokenWordIndex ? 1 : 0.2 }} transition={{ duration: 0.08 }} className="inline-block mr-1">{w}</motion.span>
                          ))
                        ) : null}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Hang-up button ── */}
              {!callEnded && (
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  onClick={hangUpCall}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.93 }}
                  className="absolute bottom-12 w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.5)] transition-colors z-10"
                >
                  {/* Phone hang-up icon */}
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                  </svg>
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <style dangerouslySetInnerHTML={{
          __html: `
          .slim-scroll::-webkit-scrollbar { width: 6px; }
          .slim-scroll::-webkit-scrollbar-track { background: transparent; }
          .slim-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
          .slim-scroll::-webkit-scrollbar-thumb:hover { background: var(--border); }
        `}} />
      </main>
    </div>
  );
}
