import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound,
  MessageCircle,
  Mic,
  MicOff,
  PhoneCall,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { NaniMedicineCard } from "../../components/NaniMedicineCard";
import { LANGUAGES } from "../../config";
import {
  EmergencyContact,
  LanguageCode,
  TimeSlotKey,
  VerifiedMedicine,
} from "../../types/api";
import { getCurrentTimeSlot, SLOT_LOCALIZED_LABELS } from "../../utils/scheduler";
import {
  buildVerifiedSlotSpeech,
  getMedicineSpokenText,
  speakText,
  stopSpeaking,
} from "../../utils/tts";
import { buildEmergencyWhatsAppUrl } from "../../utils/whatsapp";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

interface NaniPageProps {
  shareCode: string;
  onChangeShareCode: (code: string) => void;
  verifiedMedicines: VerifiedMedicine[];
  emergencyContact: EmergencyContact;
  language: LanguageCode;
  onChangeLanguage: (lang: LanguageCode) => void;
  onMarkDose: (medicineId: string, slot: TimeSlotKey, taken: boolean) => Promise<void>;
  onSwitchToCaregiver: () => void;
}

const UI_COPY: Record<
  LanguageCode,
  {
    safetyTitle: string;
    heading: string;
    readAll: string;
    stopVoice: string;
    tapSpeak: string;
    listeningNow: string;
    allToday: string;
    listenOne: string;
    takeAction: string;
    takenDone: string;
    emergencyButton: string;
    noVerified: string;
  }
> = {
  en: {
    safetyTitle: "Caregiver-Verified Voiceover Only",
    heading: "My Verified Medicines",
    readAll: "Read My Medicines Aloud",
    stopVoice: "Stop Voice",
    tapSpeak: "Tap & Speak Command",
    listeningNow: "Listening... Say Morning, Night, Taken, or Help",
    allToday: "All Today",
    listenOne: "Listen",
    takeAction: "I Took This",
    takenDone: "Taken",
    emergencyButton: "Emergency Call",
    noVerified:
      "No caregiver-verified prescriptions found for this share code yet. Ask your caregiver to confirm your schedule first.",
  },
  hi: {
    safetyTitle: "केवल देखभालकर्ता द्वारा सत्यापित दवाइयाँ",
    heading: "मेरी सत्यापित दवाइयाँ",
    readAll: "मेरी दवाइयाँ बोलकर सुनाएँ",
    stopVoice: "आवाज़ बंद करें",
    tapSpeak: "दबाकर बोलें",
    listeningNow: "सुन रहा हूँ... बोलें: सुबह, रात, दवाई ली, या मदद",
    allToday: "आज की सभी",
    listenOne: "सुनें",
    takeAction: "मैंने ले ली",
    takenDone: "ले ली गई",
    emergencyButton: "आपातकालीन कॉल",
    noVerified:
      "इस शेयर कोड के लिए अभी कोई सत्यापित दवाई नहीं मिली है। कृपया देखभालकर्ता से पहले सत्यापन करवाएँ।",
  },
  mr: {
    safetyTitle: "फक्त काळजीवाहकांनी प्रमाणित केलेली औषधे",
    heading: "माझी प्रमाणित औषधे",
    readAll: "माझी औषधे वाचून दाखवा",
    stopVoice: "आवाज थांबवा",
    tapSpeak: "दाबून बोला",
    listeningNow: "ऐकत आहे... बोला: सकाळ, रात्र, औषध घेतले, किंवा मदत",
    allToday: "आजची सर्व",
    listenOne: "ऐका",
    takeAction: "मी घेतले",
    takenDone: "घेतले आहे",
    emergencyButton: "तातडीचा कॉल",
    noVerified:
      "या शेअर कोडसाठी अजून कोणतेही प्रमाणित औषध नाही. कृपया काळजीवाहकांना आधी प्रमाणित करण्यास सांगा.",
  },
};

export function NaniPage({
  shareCode,
  onChangeShareCode,
  verifiedMedicines,
  emergencyContact,
  language,
  onChangeLanguage,
  onMarkDose,
  onSwitchToCaregiver,
}: NaniPageProps) {
  // Strictly allow ONLY caregiver-verified medicines to appear or be spoken
  const strictlyVerified = useMemo(
    () => verifiedMedicines.filter((med) => med.caregiver_verified === true),
    [verifiedMedicines]
  );

  const [selectedSlot, setSelectedSlot] = useState<TimeSlotKey | "All">(() =>
    getCurrentTimeSlot()
  );
  const [codeDraft, setCodeDraft] = useState(shareCode);
  const [showCodeSwitcher, setShowCodeSwitcher] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMedId, setSpeakingMedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [ttsError, setTtsError] = useState("");
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const copy = UI_COPY[language];

  useEffect(() => {
    setCodeDraft(shareCode);
  }, [shareCode]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      recognitionRef.current?.stop();
    };
  }, []);

  const visibleMedicines = useMemo(() => {
    if (selectedSlot === "All") return strictlyVerified;
    return strictlyVerified.filter((med) =>
      med.slots.some((slotObj) => slotObj.slot === selectedSlot)
    );
  }, [strictlyVerified, selectedSlot]);

  useEffect(() => {
    setTtsError("");
  }, [language]);

  function handleSpeakSlot(slotToRead: TimeSlotKey | "All") {
    if (isSpeaking && !speakingMedId) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }

    setTtsError("");
    const script = buildVerifiedSlotSpeech(strictlyVerified, slotToRead, language);
    speakText(script, language, {
      onStart: () => {
        setTtsError("");
        setIsSpeaking(true);
        setSpeakingMedId(null);
      },
      onEnd: () => {
        setIsSpeaking(false);
        setSpeakingMedId(null);
      },
      onError: (message) => {
        setIsSpeaking(false);
        setSpeakingMedId(null);
        setTtsError(message);
      },
    });
  }

  function handleSpeakSingle(med: VerifiedMedicine) {
    if (!med.caregiver_verified) return;

    if (isSpeaking && speakingMedId === med.id) {
      stopSpeaking();
      setIsSpeaking(false);
      setSpeakingMedId(null);
      return;
    }

    setTtsError("");
    const text = getMedicineSpokenText(med, language);
    speakText(text, language, {
      onStart: () => {
        setTtsError("");
        setIsSpeaking(true);
        setSpeakingMedId(med.id);
      },
      onEnd: () => {
        setIsSpeaking(false);
        setSpeakingMedId(null);
      },
      onError: (message) => {
        setIsSpeaking(false);
        setSpeakingMedId(null);
        setTtsError(message);
      },
    });
  }

  async function handleToggleTakenWithVoice(med: VerifiedMedicine, slot: TimeSlotKey) {
    const alreadyTaken = med.taken_slots_today.includes(slot);
    await onMarkDose(med.id, slot, !alreadyTaken);

    if (!alreadyTaken) {
      const confirmMsg =
        language === "hi"
          ? `${med.medicine_name} को ले लिया गया चिह्नित किया गया है। बहुत बढ़िया।`
          : language === "mr"
          ? `${med.medicine_name} घेतले म्हणून नोंदवले आहे. छान.`
          : `Marked ${med.medicine_name} as taken. Well done.`;
      speakText(confirmMsg, language, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    }
  }

  function processVoiceCommand(rawTranscript: string) {
    const text = rawTranscript.toLowerCase().trim();
    setVoiceFeedback(`Heard: "${rawTranscript}"`);

    if (
      text.includes("help") ||
      text.includes("emergency") ||
      text.includes("call") ||
      text.includes("मदद") ||
      text.includes("मदत") ||
      text.includes("कॉल")
    ) {
      setShowEmergencyModal(true);
      const sosMsg =
        language === "hi"
          ? `आपातकालीन कॉल खोली जा रही है। ${emergencyContact.name} को कॉल करने के लिए लाल बटन दबाएँ।`
          : language === "mr"
          ? `तातडीचा कॉल उघडला आहे. ${emergencyContact.name} यांना कॉल करण्यासाठी लाल बटण दाबा.`
          : `Opening emergency call screen for ${emergencyContact.name}.`;
      speakText(sosMsg, language);
      return;
    }

    if (
      text.includes("morning") ||
      text.includes("breakfast") ||
      text.includes("सुबह") ||
      text.includes("subah") ||
      text.includes("सकाळ") ||
      text.includes("sakal")
    ) {
      setSelectedSlot("Morning");
      handleSpeakSlot("Morning");
      return;
    }

    if (
      text.includes("afternoon") ||
      text.includes("lunch") ||
      text.includes("दोपहर") ||
      text.includes("dopahar") ||
      text.includes("दुपार") ||
      text.includes("dupar")
    ) {
      setSelectedSlot("Afternoon");
      handleSpeakSlot("Afternoon");
      return;
    }

    if (
      text.includes("night") ||
      text.includes("dinner") ||
      text.includes("evening") ||
      text.includes("रात") ||
      text.includes("raat") ||
      text.includes("रात्र")
    ) {
      setSelectedSlot("Night");
      handleSpeakSlot("Night");
      return;
    }

    if (
      text.includes("taken") ||
      text.includes("done") ||
      text.includes("liya") ||
      text.includes("लिया") ||
      text.includes("ली") ||
      text.includes("घेतले")
    ) {
      const targetSlot: TimeSlotKey =
        selectedSlot === "All" ? getCurrentTimeSlot() : selectedSlot;
      const nextPending = strictlyVerified.find(
        (m) =>
          m.slots.some((s) => s.slot === targetSlot) &&
          !m.taken_slots_today.includes(targetSlot)
      );
      if (nextPending) {
        void handleToggleTakenWithVoice(nextPending, targetSlot);
      } else {
        const doneMsg =
          language === "hi"
            ? "इस समय की सभी सत्यापित दवाइयाँ पहले ही ली जा चुकी हैं।"
            : language === "mr"
            ? "या वेळेची सर्व प्रमाणित औषधे आधीच घेतली आहेत."
            : "All caregiver-verified medicines for this time are already marked as taken.";
        speakText(doneMsg, language);
      }
      return;
    }

    const slotNow = getCurrentTimeSlot();
    setSelectedSlot(slotNow);
    handleSpeakSlot(slotNow);
  }

  function handleToggleVoiceRecognition() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as WindowWithSpeech;
    const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!RecognitionCtor) {
      setVoiceFeedback(
        "Voice microphone is not supported in this browser. Tap any quick voice button below."
      );
      return;
    }

    stopSpeaking();
    setIsSpeaking(false);

    try {
      const recognition = new RecognitionCtor();
      recognition.lang = LANGUAGES[language].recognitionLocale;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceFeedback(copy.listeningNow);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => {
        setIsListening(false);
        setVoiceFeedback(
          "Could not access microphone. Tap any large quick voice prompt below."
        );
      };
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript || "";
        if (transcript) {
          processVoiceCommand(transcript);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceFeedback("Microphone unavailable. Use the large voice buttons below.");
    }
  }

  function handleApplyShareCode(event: FormEvent) {
    event.preventDefault();
    const normalized = codeDraft.trim().toUpperCase();
    if (normalized) {
      onChangeShareCode(normalized);
      setShowCodeSwitcher(false);
    }
  }

  const slotButtons: Array<{ key: TimeSlotKey | "All"; label: string }> = [
    { key: "All", label: copy.allToday },
    { key: "Morning", label: SLOT_LOCALIZED_LABELS[language].Morning },
    { key: "Afternoon", label: SLOT_LOCALIZED_LABELS[language].Afternoon },
    { key: "Night", label: SLOT_LOCALIZED_LABELS[language].Night },
  ];

  const cleanTelHref = `tel:${emergencyContact.phone.replace(/[^\d+]/g, "")}`;
  const emergencyWhatsAppHref = buildEmergencyWhatsAppUrl(emergencyContact);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20 space-y-8">
      {/* High-Contrast Header + Share Code + Emergency Button */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 border-b-2 border-slate-900 dark:border-slate-200 pb-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold text-teal-800 dark:text-teal-300">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{copy.safetyTitle}</span>
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setShowCodeSwitcher((prev) => !prev)}
              className="inline-flex items-center gap-1.5 underline underline-offset-4 cursor-pointer font-mono-data"
            >
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>Code: {shareCode}</span>
            </button>
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-950 dark:text-white">
            {copy.heading}
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setShowEmergencyModal(true)}
          className="inline-flex items-center justify-center gap-3 min-h-[68px] px-7 py-4 rounded-2xl bg-red-700 hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500 text-white font-display text-xl font-extrabold border-2 border-red-900 dark:border-red-300 transition-colors cursor-pointer shrink-0"
        >
          <PhoneCall className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>
            {copy.emergencyButton} · {emergencyContact.name}
          </span>
        </button>
      </section>

      {/* Optional Login-Free Share Code Switcher */}
      {showCodeSwitcher && (
        <form
          onSubmit={handleApplyShareCode}
          className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900 p-4"
        >
          <label className="text-base font-bold text-slate-950 dark:text-white">
            Family Share Code (Login-Free):
          </label>
          <input
            type="text"
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
            placeholder="DEMO01"
            className="min-h-[48px] w-40 px-4 py-2 rounded-xl border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-950 text-slate-950 dark:text-white font-mono-data text-lg font-bold uppercase"
          />
          <button
            type="submit"
            className="min-h-[48px] px-5 py-2 rounded-xl bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 font-bold text-base cursor-pointer"
          >
            Load Schedule
          </button>
        </form>
      )}

      {/* Huge Language Selector */}
      <section aria-label="Choose voice language" className="grid grid-cols-3 gap-3 sm:gap-4">
        {(Object.keys(LANGUAGES) as LanguageCode[]).map((langCode) => {
          const item = LANGUAGES[langCode];
          const active = language === langCode;
          return (
            <button
              key={langCode}
              type="button"
              onClick={() => {
                stopSpeaking();
                setIsSpeaking(false);
                onChangeLanguage(langCode);
              }}
              className={`min-h-[60px] px-4 py-3 rounded-2xl border-2 font-display text-lg sm:text-xl font-extrabold transition-colors cursor-pointer ${
                active
                  ? "bg-slate-950 dark:bg-white text-white dark:text-slate-950 border-slate-950 dark:border-white"
                  : "bg-white dark:bg-slate-900 text-slate-950 dark:text-white border-slate-400 dark:border-slate-600 hover:border-slate-950 dark:hover:border-white"
              }`}
            >
              {item.nativeLabel}
            </button>
          );
        })}
      </section>

      {/* Voice Assistant + Voice Recognition Command Deck */}
      <section
        aria-label="Voice assistant and voice commands"
        className="rounded-3xl border-2 border-slate-900 dark:border-slate-200 bg-white dark:bg-slate-900 p-5 sm:p-7 space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => handleSpeakSlot(selectedSlot)}
            className={`min-h-[80px] px-6 py-5 rounded-2xl border-2 font-display text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-3.5 transition-colors cursor-pointer ${
              isSpeaking && !speakingMedId
                ? "bg-amber-500 hover:bg-amber-600 text-slate-950 border-slate-950"
                : "bg-teal-700 hover:bg-teal-800 dark:bg-teal-400 dark:hover:bg-teal-300 text-white dark:text-slate-950 border-teal-900 dark:border-teal-200"
            }`}
          >
            {isSpeaking && !speakingMedId ? (
              <>
                <VolumeX className="w-7 h-7 shrink-0" aria-hidden="true" />
                <span>{copy.stopVoice}</span>
              </>
            ) : (
              <>
                <Volume2 className="w-7 h-7 shrink-0" aria-hidden="true" />
                <span>{copy.readAll}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleVoiceRecognition}
            className={`min-h-[80px] px-6 py-5 rounded-2xl border-2 font-display text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-3.5 transition-colors cursor-pointer ${
              isListening
                ? "bg-red-700 text-white border-red-950 dark:border-red-300"
                : "bg-slate-950 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-950 border-slate-950 dark:border-white"
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-7 h-7 shrink-0" aria-hidden="true" />
                <span>Stop Listening</span>
              </>
            ) : (
              <>
                <Mic className="w-7 h-7 shrink-0" aria-hidden="true" />
                <span>{copy.tapSpeak}</span>
              </>
            )}
          </button>
        </div>

        <div className="space-y-3 pt-1">
          {ttsError && (
            <p
              role="alert"
              className="rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm sm:text-base font-bold text-red-800 dark:text-red-200"
            >
              {ttsError}
            </p>
          )}
          {voiceFeedback && (
            <p
              role="status"
              className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {voiceFeedback}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Quick Voice Prompts:
            </span>
            <button
              type="button"
              onClick={() => processVoiceCommand("what medicine now")}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-bold hover:border-teal-700 dark:hover:border-teal-400 cursor-pointer"
            >
              &ldquo;What medicine now?&rdquo;
            </button>
            <button
              type="button"
              onClick={() => processVoiceCommand("morning")}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-bold hover:border-teal-700 dark:hover:border-teal-400 cursor-pointer"
            >
              &ldquo;Morning medicines&rdquo;
            </button>
            <button
              type="button"
              onClick={() => processVoiceCommand("night")}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-bold hover:border-teal-700 dark:hover:border-teal-400 cursor-pointer"
            >
              &ldquo;Night medicines&rdquo;
            </button>
            <button
              type="button"
              onClick={() => processVoiceCommand("taken")}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-bold hover:border-teal-700 dark:hover:border-teal-400 cursor-pointer"
            >
              &ldquo;Mark next taken&rdquo;
            </button>
          </div>
        </div>
      </section>

      {/* Time-of-Day Filter Buttons */}
      <section aria-label="Time of day schedule" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {slotButtons.map((btn) => {
          const active = selectedSlot === btn.key;
          return (
            <button
              key={btn.key}
              type="button"
              onClick={() => setSelectedSlot(btn.key)}
              className={`min-h-[60px] px-4 py-3 rounded-2xl border-2 text-base sm:text-lg font-extrabold transition-colors cursor-pointer ${
                active
                  ? "bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 border-teal-900 dark:border-teal-200"
                  : "bg-white dark:bg-slate-900 text-slate-950 dark:text-white border-slate-400 dark:border-slate-600 hover:border-slate-950 dark:hover:border-white"
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </section>

      {/* Verified Pill-Strip Cards */}
      {strictlyVerified.length === 0 ? (
        <section className="rounded-3xl border-2 border-slate-900 dark:border-slate-200 bg-white dark:bg-slate-900 p-8 sm:p-10 text-center space-y-5">
          <p className="font-display text-2xl font-extrabold text-slate-950 dark:text-white">
            {copy.noVerified}
          </p>
          <button
            type="button"
            onClick={onSwitchToCaregiver}
            className="min-h-[60px] px-7 py-4 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 font-display text-lg font-extrabold cursor-pointer"
          >
            Go to Caregiver Mode
          </button>
        </section>
      ) : visibleMedicines.length === 0 ? (
        <section className="rounded-3xl border-2 border-slate-900 dark:border-slate-200 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
          <p className="font-display text-2xl font-extrabold text-slate-950 dark:text-white">
            No medicines scheduled for {selectedSlot}
          </p>
          <button
            type="button"
            onClick={() => setSelectedSlot("All")}
            className="min-h-[56px] px-6 py-3 rounded-2xl bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 font-display text-lg font-extrabold cursor-pointer"
          >
            Show All Today&apos;s Verified Medicines
          </button>
        </section>
      ) : (
        <section aria-label="Verified medicines list" className="space-y-6">
          {visibleMedicines.map((med) => {
            const activeSlotForCard: TimeSlotKey =
              selectedSlot !== "All"
                ? selectedSlot
                : med.slots.find((s) => !med.taken_slots_today.includes(s.slot))?.slot ||
                  med.slots[0]?.slot ||
                  "Morning";

            return (
              <NaniMedicineCard
                key={med.id}
                medicine={med}
                activeSlot={activeSlotForCard}
                language={language}
                isSpeakingThis={isSpeaking && speakingMedId === med.id}
                labels={{
                  listenOne: copy.listenOne,
                  stopVoice: copy.stopVoice,
                  takeAction: copy.takeAction,
                  takenDone: copy.takenDone,
                }}
                onSpeak={handleSpeakSingle}
                onToggleTaken={(m, slot) => void handleToggleTakenWithVoice(m, slot)}
              />
            );
          })}
        </section>
      )}

      {/* High-Contrast Emergency Call Modal */}
      {showEmergencyModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="emergency-dialog-title"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-3xl border-4 border-red-700 dark:border-red-400 bg-white dark:bg-slate-950 p-6 sm:p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-base font-extrabold text-red-700 dark:text-red-400">
                  Emergency Contact
                </p>
                <h2
                  id="emergency-dialog-title"
                  className="font-display text-3xl font-extrabold text-slate-950 dark:text-white"
                >
                  {emergencyContact.name}
                </h2>
                <p className="text-lg font-bold text-slate-700 dark:text-slate-300">
                  {emergencyContact.relation} · {emergencyContact.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmergencyModal(false)}
                aria-label="Close emergency dialog"
                className="min-h-[48px] min-w-[48px] rounded-xl border-2 border-slate-900 dark:border-slate-300 flex items-center justify-center text-slate-950 dark:text-white cursor-pointer"
              >
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4">
              <a
                href={cleanTelHref}
                className="w-full min-h-[72px] px-6 py-4 rounded-2xl bg-red-700 hover:bg-red-800 text-white font-display text-2xl font-extrabold flex items-center justify-center gap-3 transition-colors"
              >
                <PhoneCall className="w-7 h-7 shrink-0" aria-hidden="true" />
                <span>Call Now · {emergencyContact.phone}</span>
              </a>

              <a
                href={emergencyWhatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[68px] px-6 py-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-display text-xl font-extrabold flex items-center justify-center gap-3 transition-colors"
              >
                <MessageCircle className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>Send Urgent WhatsApp SOS</span>
              </a>

              <button
                type="button"
                onClick={() => setShowEmergencyModal(false)}
                className="w-full min-h-[56px] px-6 py-3 rounded-2xl border-2 border-slate-900 dark:border-slate-300 text-slate-950 dark:text-white font-display text-lg font-bold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
