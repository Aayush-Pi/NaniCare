import { LANGUAGES } from "../config";
import { LanguageCode, TimeSlotKey, VerifiedMedicine } from "../types/api";

const FASTAPI_BASE_URL = (import.meta.env?.VITE_API_URL || "").trim().replace(/\/+$/, "");

const AUDIO_CACHE_MAX = 64;
const TTS_FETCH_TIMEOUT_MS = 2800;
const audioUrlCache = new Map<string, string>();
const inFlightFetches = new Map<string, Promise<string>>();

let activeAudio: HTMLAudioElement | null = null;
let activeAbortController: AbortController | null = null;
let playbackGeneration = 0;

// Pre-warm browser speechSynthesis voices so fallback doesn't block on voiceschanged.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    FASTAPI_BASE_URL.length > 0 ||
    (typeof window !== "undefined" && "speechSynthesis" in window)
  );
}

export function stopSpeaking(): void {
  playbackGeneration += 1;

  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function scoreVoice(voice: SpeechSynthesisVoice, targetLang: string): number {
  const vLang = voice.lang.toLowerCase();
  const target = targetLang.toLowerCase();
  const prefix = target.split("-")[0];

  let score = 0;
  if (vLang === target) score += 100;
  else if (vLang.startsWith(`${prefix}-`)) score += 70;
  else if (vLang.startsWith(prefix)) score += 50;
  else return -1;

  const name = voice.name.toLowerCase();
  if (name.includes("natural") || name.includes("neural") || name.includes("online")) score += 30;
  if (name.includes("google")) score += 20;
  if (name.includes("siri") || name.includes("enhanced") || name.includes("premium")) score += 15;
  if (!voice.localService) score += 5;

  return score;
}

async function getVoicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return existing;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onReady);
      resolve(window.speechSynthesis.getVoices());
    }, 350);

    function onReady() {
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", onReady);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", onReady);
  });
}

async function pickBestBrowserVoice(
  language: LanguageCode
): Promise<{ voice: SpeechSynthesisVoice | null; resolvedLocale: string }> {
  const voices = await getVoicesReady();
  const primaryLocale = LANGUAGES[language].speechLocale;

  // Marathi voices are often missing on macOS/Chrome; fall back to Hindi (Devanagari)
  // before falling back to an English voice that cannot pronounce Devanagari script.
  const candidateLocales =
    language === "mr" ? [primaryLocale, "hi-IN"] : [primaryLocale];

  for (const locale of candidateLocales) {
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -1;
    for (const voice of voices) {
      const s = scoreVoice(voice, locale);
      if (s > bestScore) {
        bestScore = s;
        best = voice;
      }
    }
    if (best) {
      return { voice: best, resolvedLocale: best.lang || locale };
    }
  }

  return { voice: null, resolvedLocale: primaryLocale };
}

export interface SpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

async function speakWithBrowserFallback(
  text: string,
  language: LanguageCode,
  gen: number,
  alreadyStarted: boolean,
  callbacks?: SpeechCallbacks
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    if (gen === playbackGeneration) {
      callbacks?.onError?.("Browser speech synthesis is not supported in this browser.");
    }
    return;
  }

  const { voice, resolvedLocale } = await pickBestBrowserVoice(language);
  if (gen !== playbackGeneration) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = resolvedLocale;
  utterance.rate = 0.92;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  if (voice) {
    utterance.voice = voice;
  }

  utterance.onstart = () => {
    if (gen === playbackGeneration && !alreadyStarted) {
      callbacks?.onStart?.();
    }
  };
  utterance.onend = () => {
    if (gen === playbackGeneration) callbacks?.onEnd?.();
  };
  utterance.onerror = () => {
    if (gen === playbackGeneration) callbacks?.onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
}

function cacheAudioUrl(key: string, url: string): void {
  if (audioUrlCache.has(key)) {
    audioUrlCache.delete(key);
  }
  audioUrlCache.set(key, url);
  if (audioUrlCache.size > AUDIO_CACHE_MAX) {
    const oldestKey = audioUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestUrl = audioUrlCache.get(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      audioUrlCache.delete(oldestKey);
    }
  }
}

function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function fetchAndCacheTts(
  text: string,
  language: LanguageCode,
  externalSignal?: AbortSignal
): Promise<string> {
  const cleaned = normalizeTtsText(text);
  const cacheKey = `${language}::${cleaned}`;

  const cached = audioUrlCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = inFlightFetches.get(cacheKey);
  if (existing) {
    return existing;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const promise = (async () => {
    try {
      const res = await fetch(`${FASTAPI_BASE_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleaned, language }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`TTS HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      cacheAudioUrl(cacheKey, objectUrl);
      return objectUrl;
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      inFlightFetches.delete(cacheKey);
    }
  })();

  inFlightFetches.set(cacheKey, promise);
  return promise;
}

export function prefetchSpeech(text: string, language: LanguageCode): void {
  if (!FASTAPI_BASE_URL) return;
  const cleaned = normalizeTtsText(text);
  if (!cleaned) return;
  void fetchAndCacheTts(cleaned, language).catch(() => {
    // Ignore background prefetch errors; live playback will retry or fall back.
  });
}

async function playNeuralAudio(
  text: string,
  language: LanguageCode,
  gen: number,
  callbacks?: SpeechCallbacks
): Promise<void> {
  const cleaned = normalizeTtsText(text);
  const cacheKey = `${language}::${cleaned}`;
  let objectUrl = audioUrlCache.get(cacheKey);

  if (!objectUrl) {
    const controller = new AbortController();
    activeAbortController = controller;

    try {
      objectUrl = await fetchAndCacheTts(cleaned, language, controller.signal);
      if (gen !== playbackGeneration) return;
    } catch (err) {
      if (gen !== playbackGeneration) {
        return;
      }
      // If aborted by stopSpeaking(), do not fall back; if aborted by timeout or network error, fall back.
      if ((err as Error)?.name === "AbortError" && activeAbortController !== controller) {
        return;
      }
      await speakWithBrowserFallback(cleaned, language, gen, true, callbacks);
      return;
    } finally {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  }

  if (gen !== playbackGeneration || !objectUrl) return;

  const audio = new Audio(objectUrl);
  activeAudio = audio;

  audio.onended = () => {
    if (activeAudio === audio) activeAudio = null;
    if (gen === playbackGeneration) callbacks?.onEnd?.();
  };

  audio.onerror = () => {
    if (activeAudio === audio) activeAudio = null;
    if (gen === playbackGeneration) {
      void speakWithBrowserFallback(text, language, gen, true, callbacks);
    }
  };

  try {
    await audio.play();
  } catch {
    if (activeAudio === audio) activeAudio = null;
    if (gen === playbackGeneration) {
      await speakWithBrowserFallback(text, language, gen, true, callbacks);
    }
  }
}

export function speakText(
  text: string,
  language: LanguageCode,
  callbacks?: SpeechCallbacks
): boolean {
  stopSpeaking();

  const cleaned = text.trim();
  if (!cleaned) {
    callbacks?.onError?.("No spoken instruction available for this medicine.");
    return false;
  }

  const gen = playbackGeneration;

  if (FASTAPI_BASE_URL.length > 0) {
    callbacks?.onStart?.();
    void playNeuralAudio(cleaned, language, gen, callbacks);
    return true;
  }

  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    callbacks?.onError?.("Browser speech synthesis is not supported in this browser.");
    return false;
  }

  callbacks?.onStart?.();
  void speakWithBrowserFallback(cleaned, language, gen, true, callbacks);
  return true;
}

export function getMedicineSpokenText(
  medicine: VerifiedMedicine,
  language: LanguageCode
): string {
  // Strictly enforce voiceover ONLY on caregiver-verified prescriptions
  if (!medicine.caregiver_verified) {
    return "";
  }

  if (language === "hi" && medicine.simple_explanation_hi.trim()) {
    return medicine.simple_explanation_hi.trim();
  }
  if (language === "mr" && medicine.simple_explanation_mr.trim()) {
    return medicine.simple_explanation_mr.trim();
  }
  if (medicine.simple_explanation_en.trim()) {
    return medicine.simple_explanation_en.trim();
  }

  return `Take ${medicine.dosage} of ${medicine.medicine_name}, ${medicine.meal_relation.toLowerCase()}.`;
}

export function buildVerifiedSlotSpeech(
  medicines: VerifiedMedicine[],
  slot: TimeSlotKey | "All",
  language: LanguageCode
): string {
  const verifiedOnly = medicines.filter((m) => m.caregiver_verified === true);
  const matching =
    slot === "All"
      ? verifiedOnly
      : verifiedOnly.filter((m) => m.slots.some((s) => s.slot === slot));

  if (matching.length === 0) {
    if (language === "hi") {
      return "इस समय के लिए कोई सत्यापित दवाई नहीं है। कृपया आराम करें।";
    }
    if (language === "mr") {
      return "या वेळेसाठी कोणतेही प्रमाणित औषध नाही. कृपया विश्रांती घ्या.";
    }
    return "There are no caregiver-verified medicines scheduled for this time.";
  }

  const intro =
    language === "hi"
      ? slot === "All"
        ? `आज के लिए आपकी ${matching.length} सत्यापित दवाइयाँ हैं। `
        : `${slot === "Morning" ? "सुबह" : slot === "Afternoon" ? "दोपहर" : "रात"} की सत्यापित दवाइयाँ। `
      : language === "mr"
      ? slot === "All"
        ? `आजसाठी तुमची ${matching.length} प्रमाणित औषधे आहेत. `
        : `${slot === "Morning" ? "सकाळची" : slot === "Afternoon" ? "दुपारची" : "रात्रीची"} प्रमाणित औषधे. `
      : slot === "All"
      ? `Here are your ${matching.length} caregiver-verified medicines for today. `
      : `Here is your caregiver-verified ${slot.toLowerCase()} medicine schedule. `;

  const itemsText = matching
    .map((med, idx) => {
      const sentence = getMedicineSpokenText(med, language);
      const takenNow = slot !== "All" && med.taken_slots_today.includes(slot);
      const takenSuffix = takenNow
        ? language === "hi"
          ? " यह दवाई आप पहले ही ले चुके हैं।"
          : language === "mr"
          ? " हे औषध तुम्ही आधीच घेतले आहे."
          : " You have already marked this dose as taken."
        : "";
      return `${idx + 1}. ${sentence}${takenSuffix}`;
    })
    .join(" ");

  return `${intro}${itemsText}`;
}
