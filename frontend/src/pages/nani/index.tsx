import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  Camera,
  Check,
  CheckCircle2,
  Contrast,
  KeyRound,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  PhoneCall,
  ShieldCheck,
  Type,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { NaniMedicineCard } from "../../components/NaniMedicineCard";
import { LANGUAGES } from "../../config";
import { verifyMedicineStrip } from "../../lib/api";
import {
  EmergencyContact,
  LanguageCode,
  StripVerifyResult,
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

type ElderTextScale = "normal" | "lg" | "xl";

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
    pendingLabel: string;
    tableHeading: string;
    checkStrip: string;
    emergencyButton: string;
    noVerified: string;
  }
> = {
  en: {
    safetyTitle: "Caregiver-Verified Voiceover Only",
    heading: "My Medicines Today",
    readAll: "Read My Medicines Aloud",
    stopVoice: "Stop Voice",
    tapSpeak: "Tap & Speak Command",
    listeningNow: "Listening... Say Morning, Night, Taken, or Help",
    allToday: "All Today",
    listenOne: "Listen",
    takeAction: "I Took This",
    takenDone: "Done · Taken",
    pendingLabel: "Pending",
    tableHeading: "Today's Dose Checklist",
    checkStrip: "Check Pill Strip (Camera)",
    emergencyButton: "Emergency Call",
    noVerified:
      "No caregiver-verified prescriptions found for this share code yet. Ask your caregiver to confirm your schedule first.",
  },
  hi: {
    safetyTitle: "केवल देखभालकर्ता द्वारा सत्यापित दवाइयाँ",
    heading: "आज की मेरी दवाइयाँ",
    readAll: "दवाइयाँ बोलकर सुनाएँ",
    stopVoice: "आवाज़ बंद करें",
    tapSpeak: "दबाकर बोलें",
    listeningNow: "सुन रहा हूँ... बोलें: सुबह, रात, दवाई ली, या मदद",
    allToday: "आज की सभी",
    listenOne: "सुनें",
    takeAction: "दवाई ले ली",
    takenDone: "ले ली गई",
    pendingLabel: "बाकी है",
    tableHeading: "आज की दवाई तालिका",
    checkStrip: "पट्टी की फोटो से जांचें",
    emergencyButton: "आपातकालीन कॉल",
    noVerified:
      "इस शेयर कोड के लिए अभी कोई सत्यापित दवाई नहीं मिली है। कृपया देखभालकर्ता से पहले सत्यापन करवाएँ।",
  },
  mr: {
    safetyTitle: "फक्त काळजीवाहकांनी प्रमाणित केलेली औषधे",
    heading: "आजची माझी औषधे",
    readAll: "औषधे वाचून दाखवा",
    stopVoice: "आवाज थांबवा",
    tapSpeak: "दाबून बोला",
    listeningNow: "ऐकत आहे... बोला: सकाळ, रात्र, औषध घेतले, किंवा मदत",
    allToday: "आजची सर्व",
    listenOne: "ऐका",
    takeAction: "औषध घेतले",
    takenDone: "घेतले आहे",
    pendingLabel: "शिल्लक",
    tableHeading: "आजची औषध यादी",
    checkStrip: "पट्टीचा फोटो तपासा",
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
  const strictlyVerified = useMemo(
    () => verifiedMedicines.filter((med) => med.caregiver_verified === true),
    [verifiedMedicines]
  );

  const [selectedSlot, setSelectedSlot] = useState<TimeSlotKey | "All">(() =>
    getCurrentTimeSlot()
  );
  const [textScale, setTextScale] = useState<ElderTextScale>(() => {
    try {
      const saved = window.localStorage.getItem("nanicare_elder_scale");
      if (saved === "lg" || saved === "xl") return saved;
    } catch {
      // Ignore storage access errors
    }
    return "lg";
  });
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("nanicare_elder_hc") === "true";
    } catch {
      return false;
    }
  });
  const [codeDraft, setCodeDraft] = useState(shareCode);
  const [showCodeSwitcher, setShowCodeSwitcher] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMedId, setSpeakingMedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [ttsError, setTtsError] = useState("");
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  const [isVerifyingStrip, setIsVerifyingStrip] = useState(false);
  const [stripResult, setStripResult] = useState<StripVerifyResult | null>(null);
  const stripInputRef = useRef<HTMLInputElement | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const copy = UI_COPY[language];

  useEffect(() => {
    setCodeDraft(shareCode);
  }, [shareCode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("nanicare_elder_scale", textScale);
    } catch {
      // Ignore storage errors
    }
  }, [textScale]);

  useEffect(() => {
    try {
      window.localStorage.setItem("nanicare_elder_hc", String(highContrast));
    } catch {
      // Ignore storage errors
    }
  }, [highContrast]);

  useEffect(() => {
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape" && showEmergencyModal) {
        setShowEmergencyModal(false);
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showEmergencyModal]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      recognitionRef.current?.stop();
    };
  }, []);

  // Build flat checklist rows (one row per scheduled medicine + slot) for the live dose table
  const doseRows = useMemo(() => {
    const slotOrder: Record<TimeSlotKey, number> = { Morning: 0, Afternoon: 1, Night: 2 };
    const rows: Array<{
      key: string;
      medicine: VerifiedMedicine;
      slot: TimeSlotKey;
      timeLabel: string;
      taken: boolean;
    }> = [];
    for (const med of strictlyVerified) {
      for (const s of med.slots) {
        rows.push({
          key: `${med.id}-${s.slot}`,
          medicine: med,
          slot: s.slot,
          timeLabel: s.time_label,
          taken: med.taken_slots_today.includes(s.slot),
        });
      }
    }
    rows.sort((a, b) => slotOrder[a.slot] - slotOrder[b.slot]);
    return rows;
  }, [strictlyVerified]);

  const totalDosesToday = doseRows.length;
  const takenDosesToday = doseRows.filter((r) => r.taken).length;
  const progressPercent =
    totalDosesToday > 0 ? Math.round((takenDosesToday / totalDosesToday) * 100) : 0;

  const visibleMedicines = useMemo(() => {
    if (selectedSlot === "All") return strictlyVerified;
    return strictlyVerified.filter((med) =>
      med.slots.some((s) => s.slot === selectedSlot)
    );
  }, [selectedSlot, strictlyVerified]);

  const visibleTableRows = useMemo(() => {
    if (selectedSlot === "All") return doseRows;
    return doseRows.filter((r) => r.slot === selectedSlot);
  }, [doseRows, selectedSlot]);

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
      setVoiceFeedback(confirmMsg);
      speakText(confirmMsg, language, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    }
  }

  async function handleStripVerifyFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsVerifyingStrip(true);
    setStripResult(null);
    setTtsError("");
    try {
      const result = await verifyMedicineStrip({ shareCode, file });
      setStripResult(result);
      const spoken =
        language === "hi"
          ? result.spoken_hi
          : language === "mr"
          ? result.spoken_mr
          : result.spoken_en;
      if (spoken) {
        speakText(spoken, language, {
          onStart: () => setIsSpeaking(true),
          onEnd: () => setIsSpeaking(false),
        });
      }
    } catch (err: unknown) {
      setTtsError(err instanceof Error ? err.message : "Could not check pill strip.");
    } finally {
      setIsVerifyingStrip(false);
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
        "Voice microphone is not supported in this browser. Use the large buttons below."
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
        setVoiceFeedback("Could not access microphone. Use the large buttons below.");
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
      setVoiceFeedback("Microphone unavailable. Use the large buttons below.");
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

  const scaleClass =
    textScale === "xl" ? "elder-scale-xl" : textScale === "lg" ? "elder-scale-lg" : "";

  return (
    <main
      id="main-content"
      className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 md:pb-16 space-y-6 ${scaleClass} ${
        highContrast ? "elder-high-contrast" : ""
      }`}
    >
      {/* Elder Accessibility Toolbar: Text Size + AAA High Contrast + Share Code */}
      <section
        aria-label="Accessibility display controls"
        className={`rounded-lg border-2 p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 ${
          highContrast
            ? "border-black dark:border-yellow-300 bg-white dark:bg-black"
            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mr-1">
            <Type className="w-4 h-4" aria-hidden="true" />
            <span>Text Size:</span>
          </span>
          {(
            [
              { key: "normal", label: "A" },
              { key: "lg", label: "A+" },
              { key: "xl", label: "A++" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={textScale === opt.key}
              onClick={() => setTextScale(opt.key)}
              className={`min-h-[44px] min-w-[48px] px-3 py-1.5 rounded-md border-2 font-display text-sm font-extrabold cursor-pointer transition-colors ${
                textScale === opt.key
                  ? "bg-slate-950 dark:bg-white text-white dark:text-slate-950 border-slate-950 dark:border-white"
                  : "bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white border-slate-400 dark:border-slate-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={highContrast}
            onClick={() => setHighContrast((v) => !v)}
            className={`inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-md border-2 text-xs sm:text-sm font-extrabold cursor-pointer transition-colors ${
              highContrast
                ? "bg-yellow-300 text-black border-black"
                : "bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white border-slate-400 dark:border-slate-600"
            }`}
          >
            <Contrast className="w-4 h-4" aria-hidden="true" />
            <span>High Contrast: {highContrast ? "ON" : "OFF"}</span>
          </button>

          <button
            type="button"
            aria-expanded={showCodeSwitcher}
            onClick={() => setShowCodeSwitcher((prev) => !prev)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-md border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-950 dark:text-white font-mono-data text-xs sm:text-sm font-bold cursor-pointer"
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span>{shareCode}</span>
          </button>
        </div>
      </section>

      {/* Optional Share Code Switcher */}
      {showCodeSwitcher && (
        <form
          onSubmit={handleApplyShareCode}
          className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900 p-4"
        >
          <label
            htmlFor="nani-share-code"
            className="text-sm sm:text-base font-bold text-slate-950 dark:text-white"
          >
            Family Share Code:
          </label>
          <input
            id="nani-share-code"
            type="text"
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
            placeholder="DEMO01"
            className="min-h-[48px] w-36 px-3.5 py-2 rounded-md border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-950 text-slate-950 dark:text-white font-mono-data text-base font-bold uppercase"
          />
          <button
            type="submit"
            className="min-h-[48px] px-5 py-2 rounded-md bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 font-bold text-sm sm:text-base cursor-pointer"
          >
            Load Schedule
          </button>
        </form>
      )}

      {/* High-Contrast Header + Emergency Call Button */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b-2 border-slate-900 dark:border-slate-300 pb-5">
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-1.5 text-sm sm:text-base font-bold text-teal-800 dark:text-teal-300">
            <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{copy.safetyTitle}</span>
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white">
            {copy.heading}
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setShowEmergencyModal(true)}
          className="inline-flex items-center justify-center gap-2.5 min-h-[60px] px-6 py-3.5 rounded-md bg-red-700 hover:bg-red-800 text-white font-display text-lg sm:text-xl font-extrabold border-2 border-red-950 dark:border-red-300 transition-colors cursor-pointer shrink-0"
        >
          <PhoneCall className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>
            {copy.emergencyButton} · {emergencyContact.name}
          </span>
        </button>
      </section>

      {/* Large Language Selector */}
      <section aria-label="Choose voice language" className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {(Object.keys(LANGUAGES) as LanguageCode[]).map((langCode) => {
          const item = LANGUAGES[langCode];
          const active = language === langCode;
          return (
            <button
              key={langCode}
              type="button"
              aria-pressed={active}
              onClick={() => {
                stopSpeaking();
                setIsSpeaking(false);
                onChangeLanguage(langCode);
              }}
              className={`min-h-[56px] px-3 py-3 rounded-md border-2 font-display text-base sm:text-xl font-extrabold transition-colors cursor-pointer ${
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

      {/* Voice Deck + Camera Pill-Strip Verifier */}
      <section
        aria-label="Voice assistant and strip verification"
        className={`rounded-lg border-2 p-4 sm:p-6 space-y-4 ${
          highContrast
            ? "border-black dark:border-yellow-300 bg-white dark:bg-black"
            : "border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900"
        }`}
      >
        <input
          ref={stripInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void handleStripVerifyFile(e)}
          className="hidden"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            aria-pressed={isSpeaking && !speakingMedId}
            onClick={() => handleSpeakSlot(selectedSlot)}
            className={`min-h-[72px] px-5 py-4 rounded-md border-2 font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-3 transition-colors cursor-pointer ${
              isSpeaking && !speakingMedId
                ? "bg-amber-400 hover:bg-amber-500 text-slate-950 border-slate-950"
                : "bg-teal-700 hover:bg-teal-800 dark:bg-teal-400 dark:hover:bg-teal-300 text-white dark:text-slate-950 border-teal-950 dark:border-teal-200"
            }`}
          >
            {isSpeaking && !speakingMedId ? (
              <>
                <VolumeX className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{copy.stopVoice}</span>
              </>
            ) : (
              <>
                <Volume2 className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{copy.readAll}</span>
              </>
            )}
          </button>

          <button
            type="button"
            aria-pressed={isListening}
            onClick={handleToggleVoiceRecognition}
            className={`min-h-[72px] px-5 py-4 rounded-md border-2 font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-3 transition-colors cursor-pointer ${
              isListening
                ? "bg-red-700 text-white border-red-950 dark:border-red-300"
                : "bg-slate-950 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-950 border-slate-950 dark:border-white"
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>Stop Listening</span>
              </>
            ) : (
              <>
                <Mic className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{copy.tapSpeak}</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isVerifyingStrip}
            onClick={() => stripInputRef.current?.click()}
            className="min-h-[72px] px-5 py-4 rounded-md border-2 border-slate-900 dark:border-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-950 dark:text-white font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-3 transition-colors cursor-pointer disabled:opacity-60"
          >
            {isVerifyingStrip ? (
              <Loader2 className="w-6 h-6 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Camera className="w-6 h-6 shrink-0" aria-hidden="true" />
            )}
            <span>{isVerifyingStrip ? "Checking Strip..." : copy.checkStrip}</span>
          </button>
        </div>

        {/* Camera Pill-Strip Verification Result Banner */}
        {stripResult && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-md border-2 p-4 flex items-start justify-between gap-3 ${
              stripResult.matched
                ? "border-green-800 bg-green-50 dark:bg-green-950/50 text-green-950 dark:text-green-100"
                : "border-red-800 bg-red-50 dark:bg-red-950/50 text-red-950 dark:text-red-100"
            }`}
          >
            <div className="flex items-start gap-3">
              {stripResult.matched ? (
                <CheckCircle2 className="w-7 h-7 text-green-700 dark:text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertOctagon className="w-7 h-7 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="space-y-1">
                <p className="font-display text-lg font-extrabold">
                  {stripResult.matched
                    ? `YES — Verified Medicine (${stripResult.detected_brand || ""})`
                    : `STOP — Not In Your Verified Schedule (${stripResult.detected_brand || "Unknown"})`}
                </p>
                <p className="text-base font-semibold">
                  {language === "hi"
                    ? stripResult.spoken_hi
                    : language === "mr"
                    ? stripResult.spoken_mr
                    : stripResult.spoken_en}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStripResult(null)}
              aria-label="Dismiss strip check result"
              className="min-h-[40px] min-w-[40px] rounded-md border border-current flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {ttsError && (
          <p
            role="alert"
            className="rounded-md border-2 border-red-700 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm sm:text-base font-bold text-red-900 dark:text-red-200"
          >
            {ttsError}
          </p>
        )}

        {voiceFeedback && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100"
          >
            {voiceFeedback}
          </p>
        )}
      </section>

      {/* Time-of-Day Filter Buttons */}
      <section aria-label="Time of day filter" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {slotButtons.map((btn) => {
          const active = selectedSlot === btn.key;
          return (
            <button
              key={btn.key}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedSlot(btn.key)}
              className={`min-h-[56px] px-4 py-3 rounded-md border-2 text-base sm:text-lg font-extrabold transition-colors cursor-pointer ${
                active
                  ? "bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 border-teal-950 dark:border-teal-200"
                  : "bg-white dark:bg-slate-900 text-slate-950 dark:text-white border-slate-400 dark:border-slate-600 hover:border-slate-950 dark:hover:border-white"
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </section>

      {/* LIVE Interactive Today's Dose Table with Big GREEN Taken Buttons */}
      {strictlyVerified.length > 0 && (
        <section
          aria-labelledby="dose-table-heading"
          className={`rounded-lg border-2 overflow-hidden ${
            highContrast
              ? "border-black dark:border-yellow-300 bg-white dark:bg-black"
              : "border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900"
          }`}
        >
          <div className="p-4 sm:p-5 border-b-2 border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="dose-table-heading"
                className="font-display text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white"
              >
                {copy.tableHeading}
              </h2>
              <p className="font-display text-base sm:text-lg font-extrabold text-green-800 dark:text-green-300 tabular-nums">
                {takenDosesToday} / {totalDosesToday} ({progressPercent}%)
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Daily doses completed"
              className="w-full h-3.5 rounded-sm bg-slate-200 dark:bg-slate-800 overflow-hidden border border-slate-400 dark:border-slate-600"
            >
              <div
                className="h-full bg-green-700 dark:bg-green-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 text-xs sm:text-sm font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-200">
                  <th className="py-3 px-4">Medicine</th>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Confirm Pill Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleTableRows.map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.taken
                        ? "bg-green-50 dark:bg-green-950/30"
                        : "bg-white dark:bg-slate-900"
                    }
                  >
                    <td className="py-3.5 px-4">
                      <p className="font-display text-base sm:text-lg font-extrabold text-slate-950 dark:text-white">
                        {row.medicine.medicine_name}
                      </p>
                      <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {row.medicine.dosage} · {row.medicine.meal_relation}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono-data text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                      {SLOT_LOCALIZED_LABELS[language][row.slot]} ({row.timeLabel})
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {row.taken ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-green-700 text-white text-xs sm:text-sm font-extrabold">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>{copy.takenDone}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-sm bg-amber-100 dark:bg-amber-950 border border-amber-500 text-amber-950 dark:text-amber-200 text-xs sm:text-sm font-extrabold">
                          {copy.pendingLabel}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        aria-pressed={row.taken}
                        onClick={() => void handleToggleTakenWithVoice(row.medicine, row.slot)}
                        className={`inline-flex items-center justify-center gap-2 min-h-[52px] px-4 sm:px-5 py-2.5 rounded-md border-2 font-display text-sm sm:text-base font-extrabold transition-colors cursor-pointer ${
                          row.taken
                            ? "bg-white dark:bg-slate-950 text-green-900 dark:text-green-300 border-green-700 dark:border-green-400 hover:bg-green-50"
                            : "bg-green-700 hover:bg-green-800 text-white border-green-950 dark:border-green-300"
                        }`}
                      >
                        {row.taken ? (
                          <>
                            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>{copy.takenDone}</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-5 h-5 shrink-0 stroke-[3]" aria-hidden="true" />
                            <span>{copy.takeAction}</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Detailed Visual Medicine Cards */}
      {strictlyVerified.length === 0 ? (
        <section className="rounded-lg border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900 p-8 text-center space-y-5">
          <p className="font-display text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white">
            {copy.noVerified}
          </p>
          <button
            type="button"
            onClick={onSwitchToCaregiver}
            className="min-h-[56px] px-6 py-3.5 rounded-md bg-slate-950 dark:bg-white text-white dark:text-slate-950 font-display text-lg font-extrabold cursor-pointer"
          >
            Go to Caregiver Mode
          </button>
        </section>
      ) : visibleMedicines.length === 0 ? (
        <section className="rounded-lg border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
          <p className="font-display text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white">
            No medicines scheduled for {selectedSlot}
          </p>
          <button
            type="button"
            onClick={() => setSelectedSlot("All")}
            className="min-h-[52px] px-6 py-3 rounded-md bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950 font-display text-base sm:text-lg font-extrabold cursor-pointer"
          >
            Show All Today&apos;s Verified Medicines
          </button>
        </section>
      ) : (
        <section aria-label="Detailed medicine cards" className="space-y-5">
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
                highContrast={highContrast}
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
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-lg border-4 border-red-700 dark:border-red-400 bg-white dark:bg-slate-950 p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-extrabold uppercase tracking-wide text-red-700 dark:text-red-400">
                  Emergency Contact
                </p>
                <h2
                  id="emergency-dialog-title"
                  className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white"
                >
                  {emergencyContact.name}
                </h2>
                <p className="text-base sm:text-lg font-bold text-slate-700 dark:text-slate-300">
                  {emergencyContact.relation} · {emergencyContact.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmergencyModal(false)}
                aria-label="Close emergency dialog"
                className="min-h-[48px] min-w-[48px] rounded-md border-2 border-slate-900 dark:border-slate-300 flex items-center justify-center text-slate-950 dark:text-white cursor-pointer"
              >
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <a
                href={cleanTelHref}
                className="w-full min-h-[68px] px-5 py-4 rounded-md bg-red-700 hover:bg-red-800 text-white font-display text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-3 transition-colors"
              >
                <PhoneCall className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>Call Now · {emergencyContact.phone}</span>
              </a>

              <a
                href={emergencyWhatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[64px] px-5 py-4 rounded-md bg-green-700 hover:bg-green-800 text-white font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-3 transition-colors"
              >
                <MessageCircle className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>Send Urgent WhatsApp SOS</span>
              </a>

              <button
                type="button"
                onClick={() => setShowEmergencyModal(false)}
                className="w-full min-h-[52px] px-5 py-3 rounded-md border-2 border-slate-900 dark:border-slate-300 text-slate-950 dark:text-white font-display text-lg font-bold cursor-pointer"
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
