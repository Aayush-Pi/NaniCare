import { LANGUAGES } from "../config";
import { LanguageCode, TimeSlotKey, VerifiedMedicine } from "../types/api";

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
}

function pickBestVoice(locale: string): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const langPrefix = locale.split("-")[0].toLowerCase();

  return (
    voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(`${langPrefix}-`)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix)) ||
    null
  );
}

export function speakText(
  text: string,
  language: LanguageCode,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: () => void;
  }
): boolean {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    callbacks?.onError?.();
    return false;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const locale = LANGUAGES[language].speechLocale;
  utterance.lang = locale;
  utterance.rate = 0.88;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voice = pickBestVoice(locale);
  if (voice) {
    utterance.voice = voice;
  }

  utterance.onstart = () => callbacks?.onStart?.();
  utterance.onend = () => callbacks?.onEnd?.();
  utterance.onerror = () => callbacks?.onEnd?.();

  window.speechSynthesis.speak(utterance);
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
