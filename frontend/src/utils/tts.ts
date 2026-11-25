import { LANGUAGES } from "../config";
import { LanguageCode, TimeSlotKey, VerifiedMedicine } from "../types/api";

let activeSpeechSession = 0;

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopSpeaking(): void {
  activeSpeechSession += 1;
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
}

function getVoicesWithWait(timeoutMs = 500): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisSupported()) return Promise.resolve([]);
  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    const onVoicesChanged = () => finish();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoicesChanged);
    setTimeout(finish, timeoutMs);
  });
}

function pickBestVoice(
  locale: string,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const langPrefix = locale.split("-")[0].toLowerCase();

  return (
    voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(`${langPrefix}-`)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix)) ||
    null
  );
}

function dispatchUtterance(
  text: string,
  language: LanguageCode,
  voices: SpeechSynthesisVoice[],
  sessionId: number,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }
): boolean {
  if (sessionId !== activeSpeechSession) return false;

  if (voices.length === 0) {
    callbacks?.onError?.(
      "No speech voices found in this browser/OS. Install OS text-to-speech voices (or speech-dispatcher + espeak-ng on Linux)."
    );
    return false;
  }

  const locale = LANGUAGES[language].speechLocale;
  const voice = pickBestVoice(locale, voices);
  if (!voice) {
    callbacks?.onError?.(
      `No ${LANGUAGES[language].label} (${locale}) voice is installed in this browser/OS. Install that language voice or switch to English.`
    );
    return false;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.voice = voice;
  utterance.rate = 0.88;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onstart = () => {
    if (sessionId === activeSpeechSession) {
      callbacks?.onStart?.();
    }
  };
  utterance.onend = () => {
    if (sessionId === activeSpeechSession) {
      callbacks?.onEnd?.();
    }
  };
  utterance.onerror = (event) => {
    if (sessionId !== activeSpeechSession) return;
    if (event.error === "canceled" || event.error === "interrupted") {
      callbacks?.onEnd?.();
      return;
    }
    callbacks?.onError?.(
      `Audio playback failed (${event.error || "unknown error"}). Check your browser or OS audio output.`
    );
  };

  window.speechSynthesis.speak(utterance);
  return true;
}

export function speakText(
  text: string,
  language: LanguageCode,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }
): boolean {
  if (!isSpeechSynthesisSupported()) {
    callbacks?.onError?.("Text-to-speech is not supported in this browser.");
    return false;
  }
  if (!text.trim()) {
    callbacks?.onError?.("No spoken instruction text is available for this medicine.");
    return false;
  }

  const sessionId = ++activeSpeechSession;
  const synth = window.speechSynthesis;
  const hadActiveSpeech = synth.speaking || synth.pending;
  if (hadActiveSpeech) {
    synth.cancel();
  }

  const immediateVoices = synth.getVoices();
  if (!hadActiveSpeech && immediateVoices.length > 0) {
    return dispatchUtterance(text, language, immediateVoices, sessionId, callbacks);
  }

  const startSpeech = async () => {
    // Brief delay after cancel() avoids a Chromium race that drops the new utterance
    if (hadActiveSpeech) {
      await new Promise((r) => setTimeout(r, 60));
    }
    if (sessionId !== activeSpeechSession) return;

    const voices = await getVoicesWithWait();
    dispatchUtterance(text, language, voices, sessionId, callbacks);
  };

  void startSpeech();
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
