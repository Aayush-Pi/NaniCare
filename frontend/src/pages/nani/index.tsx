import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleX,
  Contrast,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Loader2,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  Pill,
  RotateCcw,
  Rows3,
  Settings,
  ShieldCheck,
  Type,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  MealCue,
  MedicineFocusCard,
  SlotIcon,
  slotName,
} from "../../components/NaniMedicineCard";
import { StripImage } from "../../components/StripImage";
import { LANGUAGES } from "../../config";
import { verifyMedicineStrip } from "../../lib/api";
import {
  EmergencyContact,
  LanguageCode,
  StripVerifyResult,
  TimeSlotKey,
  VerifiedMedicine,
} from "../../types/api";
import { getCurrentTimeSlot } from "../../utils/scheduler";
import {
  buildVerifiedSlotSpeech,
  getMedicineSpokenText,
  speakText,
  stopSpeaking,
} from "../../utils/tts";
import { buildEmergencyWhatsAppUrl } from "../../utils/whatsapp";

/* ------------------------------------------------------------------ */
/* Browser speech recognition typings                                  */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Types & copy                                                        */
/* ------------------------------------------------------------------ */

type ElderScreen = "home" | "now" | "list" | "camera" | "call" | "settings";
type ElderTextScale = "normal" | "lg" | "xl";
type ElderLayout = "grid" | "rows";
type TileTone = "blue" | "teal" | "violet" | "amber" | "slate" | "red" | "green";

const SLOT_ORDER: TimeSlotKey[] = ["Morning", "Afternoon", "Night"];

const TONE_CLASS: Record<TileTone, string> = {
  blue: "bg-blue-700 hover:bg-blue-800 text-white",
  teal: "bg-teal-700 hover:bg-teal-800 text-white",
  violet: "bg-violet-700 hover:bg-violet-800 text-white",
  amber: "bg-amber-400 hover:bg-amber-300 text-slate-950",
  slate: "bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-700 dark:hover:bg-slate-600",
  red: "bg-red-700 hover:bg-red-800 text-white",
  green: "bg-green-700 hover:bg-green-800 text-white",
};

interface ElderCopy {
  greeting: string;
  back: string;
  medsNow: string;
  checklist: string;
  hearAll: string;
  stop: string;
  checkPill: string;
  talk: string;
  listening: string;
  call: string;
  settings: string;
  doneOf: (taken: number, total: number) => string;
  allDone: string;
  tookIt: string;
  taken: string;
  undo: string;
  hear: string;
  next: string;
  prev: string;
  ofCount: (i: number, n: number) => string;
  nothingNow: string;
  safety: string;
  takePhoto: string;
  checking: string;
  photoHint: string;
  yesMatch: string;
  noMatch: string;
  checkAnother: string;
  callNow: string;
  sos: string;
  language: string;
  textSize: string;
  contrast: string;
  layout: string;
  grid: string;
  rows: string;
  on: string;
  off: string;
  familyCode: string;
  load: string;
  caregiverExit: string;
  noVerified: string;
  openCaregiver: string;
  markedTaken: (name: string) => string;
  alreadyDone: string;
  micUnsupported: string;
}

const COPY: Record<LanguageCode, ElderCopy> = {
  en: {
    greeting: "Namaste",
    back: "Back",
    medsNow: "Medicines Now",
    checklist: "Today's List",
    hearAll: "Hear Medicines",
    stop: "Stop",
    checkPill: "Check My Pill",
    talk: "Talk",
    listening: "Listening…",
    call: "Call Family",
    settings: "Settings",
    doneOf: (t, n) => `${t} of ${n} done today`,
    allDone: "All medicines taken today. Well done!",
    tookIt: "I Took It",
    taken: "Taken",
    undo: "Undo",
    hear: "Hear",
    next: "Next",
    prev: "Back",
    ofCount: (i, n) => `${i} of ${n}`,
    nothingNow: "No medicine at this time. Rest well.",
    safety: "Checked by your family",
    takePhoto: "Take Photo of Strip",
    checking: "Checking…",
    photoHint: "Hold the medicine strip in front of the camera.",
    yesMatch: "Yes — this is your medicine",
    noMatch: "Stop — do not take this",
    checkAnother: "Check Another",
    callNow: "Call",
    sos: "Send WhatsApp Help",
    language: "Language",
    textSize: "Text Size",
    contrast: "High Contrast",
    layout: "Home Layout",
    grid: "Grid",
    rows: "Rows",
    on: "On",
    off: "Off",
    familyCode: "Family Code",
    load: "Load",
    caregiverExit: "Open Caregiver Mode",
    noVerified: "No medicines yet. Ask your family to add them.",
    openCaregiver: "Caregiver Mode",
    markedTaken: (name) => `${name} marked as taken. Well done.`,
    alreadyDone: "All medicines for this time are already taken.",
    micUnsupported: "Voice is not available here. Please use the buttons.",
  },
  hi: {
    greeting: "नमस्ते",
    back: "वापस",
    medsNow: "अभी की दवाई",
    checklist: "आज की सूची",
    hearAll: "दवाई सुनें",
    stop: "रोकें",
    checkPill: "दवाई जांचें",
    talk: "बोलें",
    listening: "सुन रहा हूँ…",
    call: "परिवार को कॉल",
    settings: "सेटिंग्स",
    doneOf: (t, n) => `आज ${n} में से ${t} ली गईं`,
    allDone: "आज की सभी दवाइयाँ ले ली गईं। बहुत बढ़िया!",
    tookIt: "मैंने ले ली",
    taken: "ले ली",
    undo: "वापस लें",
    hear: "सुनें",
    next: "अगली",
    prev: "पिछली",
    ofCount: (i, n) => `${n} में से ${i}`,
    nothingNow: "इस समय कोई दवाई नहीं है। आराम करें।",
    safety: "परिवार द्वारा जांची गई",
    takePhoto: "पट्टी की फोटो लें",
    checking: "जांच रहे हैं…",
    photoHint: "दवाई की पट्टी कैमरे के सामने रखें।",
    yesMatch: "हाँ — यह आपकी दवाई है",
    noMatch: "रुकें — यह दवाई न लें",
    checkAnother: "दूसरी जांचें",
    callNow: "कॉल करें",
    sos: "व्हाट्सऐप पर मदद भेजें",
    language: "भाषा",
    textSize: "अक्षर का आकार",
    contrast: "ज़्यादा कंट्रास्ट",
    layout: "होम लेआउट",
    grid: "ग्रिड",
    rows: "पंक्तियाँ",
    on: "चालू",
    off: "बंद",
    familyCode: "परिवार कोड",
    load: "खोलें",
    caregiverExit: "देखभालकर्ता मोड खोलें",
    noVerified: "अभी कोई दवाई नहीं है। परिवार से जोड़ने को कहें।",
    openCaregiver: "देखभालकर्ता मोड",
    markedTaken: (name) => `${name} ले ली गई। बहुत बढ़िया।`,
    alreadyDone: "इस समय की सभी दवाइयाँ पहले ही ली जा चुकी हैं।",
    micUnsupported: "यहाँ आवाज़ उपलब्ध नहीं है। कृपया बटन दबाएँ।",
  },
  mr: {
    greeting: "नमस्कार",
    back: "मागे",
    medsNow: "आताची औषधे",
    checklist: "आजची यादी",
    hearAll: "औषधे ऐका",
    stop: "थांबवा",
    checkPill: "औषध तपासा",
    talk: "बोला",
    listening: "ऐकत आहे…",
    call: "कुटुंबाला कॉल",
    settings: "सेटिंग्ज",
    doneOf: (t, n) => `आज ${n} पैकी ${t} घेतली`,
    allDone: "आजची सर्व औषधे घेतली. छान!",
    tookIt: "मी घेतले",
    taken: "घेतले",
    undo: "रद्द करा",
    hear: "ऐका",
    next: "पुढचे",
    prev: "मागचे",
    ofCount: (i, n) => `${n} पैकी ${i}`,
    nothingNow: "या वेळी कोणतेही औषध नाही. आराम करा.",
    safety: "कुटुंबाने तपासलेले",
    takePhoto: "पट्टीचा फोटो घ्या",
    checking: "तपासत आहे…",
    photoHint: "औषधाची पट्टी कॅमेऱ्यासमोर धरा.",
    yesMatch: "हो — हे तुमचे औषध आहे",
    noMatch: "थांबा — हे औषध घेऊ नका",
    checkAnother: "दुसरे तपासा",
    callNow: "कॉल करा",
    sos: "व्हॉट्सॲपवर मदत पाठवा",
    language: "भाषा",
    textSize: "अक्षरांचा आकार",
    contrast: "जास्त कॉन्ट्रास्ट",
    layout: "होम मांडणी",
    grid: "ग्रिड",
    rows: "ओळी",
    on: "चालू",
    off: "बंद",
    familyCode: "कुटुंब कोड",
    load: "उघडा",
    caregiverExit: "काळजीवाहक मोड उघडा",
    noVerified: "अजून औषधे नाहीत. कुटुंबाला जोडण्यास सांगा.",
    openCaregiver: "काळजीवाहक मोड",
    markedTaken: (name) => `${name} घेतले म्हणून नोंदवले. छान.`,
    alreadyDone: "या वेळेची सर्व औषधे आधीच घेतली आहेत.",
    micUnsupported: "येथे आवाज उपलब्ध नाही. कृपया बटणे वापरा.",
  },
};

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && (allowed as readonly string[]).includes(saved)) return saved as T;
  } catch {
    // Ignore storage access errors
  }
  return fallback;
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
}

function buzz(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Haptics are a progressive enhancement
  }
}

/* ------------------------------------------------------------------ */
/* Big tile (Assistive Access style)                                   */
/* ------------------------------------------------------------------ */

function ElderTile({
  label,
  icon,
  tone,
  layout,
  highContrast,
  badge,
  pressed,
  wide,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  tone: TileTone;
  layout: ElderLayout;
  highContrast: boolean;
  badge?: number;
  pressed?: boolean;
  wide?: boolean;
  onClick: () => void;
}) {
  const hc = highContrast ? "border-4 border-black dark:border-white" : "";
  const badgeEl =
    badge !== undefined && badge > 0 ? (
      <span
        aria-hidden="true"
        className="min-w-9 h-9 px-2 rounded-full bg-white text-slate-950 text-lg font-bold flex items-center justify-center tabular-nums border-2 border-slate-950"
      >
        {badge}
      </span>
    ) : null;

  if (layout === "rows") {
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onClick}
        className={`elder-tile w-full min-h-[88px] px-4 sm:px-5 py-3 rounded-lg flex items-center gap-4 text-left transition-colors cursor-pointer ${TONE_CLASS[tone]} ${hc}`}
      >
        <span className="w-14 h-14 rounded-md bg-black/15 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-2xl font-bold leading-tight">{label}</span>
        {badgeEl}
        <ChevronRight className="w-8 h-8 shrink-0 opacity-80" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`elder-tile relative w-full min-h-[148px] sm:min-h-[176px] p-4 rounded-lg flex flex-col items-center justify-center gap-3 text-center transition-colors cursor-pointer ${TONE_CLASS[tone]} ${hc} ${
        wide ? "col-span-2" : ""
      }`}
    >
      {badgeEl && <span className="absolute top-3 right-3">{badgeEl}</span>}
      {icon}
      <span className="text-xl sm:text-2xl font-bold leading-tight">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

interface NaniPageProps {
  shareCode: string;
  patientName: string;
  onChangeShareCode: (code: string) => void;
  verifiedMedicines: VerifiedMedicine[];
  emergencyContact: EmergencyContact;
  language: LanguageCode;
  onChangeLanguage: (lang: LanguageCode) => void;
  onMarkDose: (medicineId: string, slot: TimeSlotKey, taken: boolean) => Promise<void>;
  onSwitchToCaregiver: () => void;
}

export function NaniPage({
  shareCode,
  patientName,
  onChangeShareCode,
  verifiedMedicines,
  emergencyContact,
  language,
  onChangeLanguage,
  onMarkDose,
  onSwitchToCaregiver,
}: NaniPageProps) {
  const copy = COPY[language];
  const locale = LANGUAGES[language].speechLocale;

  const strictlyVerified = useMemo(
    () => verifiedMedicines.filter((med) => med.caregiver_verified === true),
    [verifiedMedicines]
  );

  const [screen, setScreen] = useState<ElderScreen>("home");
  const [textScale, setTextScale] = useState<ElderTextScale>(() =>
    readStored("nanicare_elder_scale", ["normal", "lg", "xl"] as const, "lg")
  );
  const [highContrast, setHighContrast] = useState<boolean>(
    () => readStored("nanicare_elder_hc", ["true", "false"] as const, "false") === "true"
  );
  const [layout, setLayout] = useState<ElderLayout>(() =>
    readStored("nanicare_elder_layout", ["grid", "rows"] as const, "grid")
  );
  const [now, setNow] = useState(() => new Date());
  const [nowSlot, setNowSlot] = useState<TimeSlotKey>(() => getCurrentTimeSlot());
  const [nowIndex, setNowIndex] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState(shareCode);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMedId, setSpeakingMedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [ttsError, setTtsError] = useState("");

  const [isVerifyingStrip, setIsVerifyingStrip] = useState(false);
  const [stripResult, setStripResult] = useState<StripVerifyResult | null>(null);
  const stripInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const currentSlot = getCurrentTimeSlot();

  /* ---------- persistent preferences ---------- */
  useEffect(() => writeStored("nanicare_elder_scale", textScale), [textScale]);
  useEffect(() => writeStored("nanicare_elder_hc", String(highContrast)), [highContrast]);
  useEffect(() => writeStored("nanicare_elder_layout", layout), [layout]);
  useEffect(() => setCodeDraft(shareCode), [shareCode]);

  // Scale the whole interface (rem-based) while Grandparents Mode is open
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = textScale === "xl" ? "125%" : textScale === "lg" ? "112.5%" : "100%";
    return () => {
      root.style.fontSize = previous;
    };
  }, [textScale]);

  // Live clock
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopSpeaking();
      recognitionRef.current?.stop();
    };
  }, []);

  // Move focus to the screen title on navigation (screen-reader & keyboard friendly)
  useEffect(() => {
    if (screen !== "home") headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  // Escape returns home (keyboard users)
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && screen !== "home") setScreen("home");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [screen]);

  /* ---------- derived data ---------- */
  const doseRows = useMemo(() => {
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
    rows.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    return rows;
  }, [strictlyVerified]);

  const totalDoses = doseRows.length;
  const takenDoses = doseRows.filter((r) => r.taken).length;
  const pendingNowCount = doseRows.filter((r) => r.slot === currentSlot && !r.taken).length;

  const slotMedicines = useMemo(
    () => strictlyVerified.filter((m) => m.slots.some((s) => s.slot === nowSlot)),
    [strictlyVerified, nowSlot]
  );
  const safeIndex = Math.min(nowIndex, Math.max(0, slotMedicines.length - 1));
  const focusMedicine = slotMedicines[safeIndex];

  /* ---------- navigation ---------- */
  function openScreen(next: ElderScreen) {
    stopSpeaking();
    setIsSpeaking(false);
    setSpeakingMedId(null);
    if (next === "now") {
      const firstPending = slotMedicines.findIndex(
        (m) => !m.taken_slots_today.includes(nowSlot)
      );
      setNowIndex(firstPending >= 0 ? firstPending : 0);
    }
    if (next === "camera") setStripResult(null);
    setScreen(next);
  }

  function selectNowSlot(slot: TimeSlotKey) {
    setNowSlot(slot);
    const meds = strictlyVerified.filter((m) => m.slots.some((s) => s.slot === slot));
    const firstPending = meds.findIndex((m) => !m.taken_slots_today.includes(slot));
    setNowIndex(firstPending >= 0 ? firstPending : 0);
  }

  /* ---------- speech ---------- */
  function speak(text: string, medId: string | null = null) {
    setTtsError("");
    speakText(text, language, {
      onStart: () => {
        setIsSpeaking(true);
        setSpeakingMedId(medId);
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

  function handleSpeakSlot(slot: TimeSlotKey | "All") {
    if (isSpeaking && !speakingMedId) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    speak(buildVerifiedSlotSpeech(strictlyVerified, slot, language));
  }

  function handleSpeakSingle(med: VerifiedMedicine) {
    if (!med.caregiver_verified) return;
    if (isSpeaking && speakingMedId === med.id) {
      stopSpeaking();
      setIsSpeaking(false);
      setSpeakingMedId(null);
      return;
    }
    speak(getMedicineSpokenText(med, language), med.id);
  }

  /* ---------- dose marking ---------- */
  async function handleToggleTaken(med: VerifiedMedicine, slot: TimeSlotKey) {
    const key = `${med.id}-${slot}`;
    if (busyKey) return;
    const alreadyTaken = med.taken_slots_today.includes(slot);
    setBusyKey(key);
    try {
      await onMarkDose(med.id, slot, !alreadyTaken);
      if (!alreadyTaken) {
        buzz([80, 60, 80]);
        const msg = copy.markedTaken(med.medicine_name);
        setVoiceFeedback(msg);
        speak(msg);
      } else {
        buzz(40);
      }
    } catch (err: unknown) {
      setTtsError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  /* ---------- pill strip camera check ---------- */
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
      buzz(result.matched ? [80, 60, 80] : [300, 100, 300]);
      const spoken =
        language === "hi" ? result.spoken_hi : language === "mr" ? result.spoken_mr : result.spoken_en;
      if (spoken) speak(spoken);
    } catch (err: unknown) {
      setTtsError(err instanceof Error ? err.message : "Could not check pill strip.");
    } finally {
      setIsVerifyingStrip(false);
    }
  }

  /* ---------- voice commands ---------- */
  function processVoiceCommand(rawTranscript: string) {
    const text = rawTranscript.toLowerCase().trim();
    setVoiceFeedback(`“${rawTranscript}”`);
    const has = (...words: string[]) => words.some((w) => text.includes(w));

    if (has("help", "emergency", "call", "मदद", "मदत", "कॉल")) {
      openScreen("call");
      speak(copy.call);
      return;
    }
    const slotMatch: Array<[TimeSlotKey, string[]]> = [
      ["Morning", ["morning", "breakfast", "सुबह", "subah", "सकाळ", "sakal"]],
      ["Afternoon", ["afternoon", "lunch", "दोपहर", "dopahar", "दुपार", "dupar"]],
      ["Night", ["night", "dinner", "evening", "रात", "raat", "रात्र"]],
    ];
    for (const [slot, words] of slotMatch) {
      if (has(...words)) {
        selectNowSlot(slot);
        setScreen("now");
        speak(buildVerifiedSlotSpeech(strictlyVerified, slot, language));
        return;
      }
    }
    if (has("taken", "done", "liya", "लिया", "ली", "घेतले")) {
      const nextPending = strictlyVerified.find(
        (m) =>
          m.slots.some((s) => s.slot === currentSlot) &&
          !m.taken_slots_today.includes(currentSlot)
      );
      if (nextPending) {
        void handleToggleTaken(nextPending, currentSlot);
      } else {
        speak(copy.alreadyDone);
      }
      return;
    }
    speak(buildVerifiedSlotSpeech(strictlyVerified, currentSlot, language));
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
      setVoiceFeedback(copy.micUnsupported);
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
        setVoiceFeedback(copy.listening);
        buzz(30);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => {
        setIsListening(false);
        setVoiceFeedback(copy.micUnsupported);
      };
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript || "";
        if (transcript) processVoiceCommand(transcript);
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceFeedback(copy.micUnsupported);
    }
  }

  function handleApplyShareCode(event: FormEvent) {
    event.preventDefault();
    const normalized = codeDraft.trim().toUpperCase();
    if (normalized) onChangeShareCode(normalized);
  }

  /* ---------- shared styles ---------- */
  const surface = highContrast
    ? "border-4 border-black dark:border-white bg-white dark:bg-black"
    : "border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900";

  const optionBtn = (active: boolean) =>
    `elder-tile min-h-[72px] px-4 py-3 rounded-lg border-2 text-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
      active
        ? "bg-blue-700 border-blue-900 text-white dark:bg-blue-500 dark:border-blue-300 dark:text-slate-950"
        : "bg-white border-slate-400 text-slate-950 hover:border-slate-950 dark:bg-slate-900 dark:border-slate-500 dark:text-white dark:hover:border-white"
    }`;

  const screenMeta: Record<Exclude<ElderScreen, "home">, { title: string; icon: ReactNode }> = {
    now: { title: copy.medsNow, icon: <Pill className="w-9 h-9 text-blue-700 dark:text-blue-300" aria-hidden="true" /> },
    list: { title: copy.checklist, icon: <ListChecks className="w-9 h-9 text-teal-700 dark:text-teal-300" aria-hidden="true" /> },
    camera: { title: copy.checkPill, icon: <Camera className="w-9 h-9 text-violet-700 dark:text-violet-300" aria-hidden="true" /> },
    call: { title: copy.call, icon: <Phone className="w-9 h-9 text-red-700 dark:text-red-400" aria-hidden="true" /> },
    settings: { title: copy.settings, icon: <Settings className="w-9 h-9 text-slate-700 dark:text-slate-300" aria-hidden="true" /> },
  };

  const cleanTelHref = `tel:${emergencyContact.phone.replace(/[^\d+]/g, "")}`;
  const emergencyWhatsAppHref = buildEmergencyWhatsAppUrl(emergencyContact);
  const initials =
    emergencyContact.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

  const tileIcon = "w-12 h-12 sm:w-14 sm:h-14 shrink-0";
  const rowIcon = "w-9 h-9 shrink-0";
  const iconCls = layout === "rows" ? rowIcon : tileIcon;

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <main
      id="main-content"
      lang={language === "en" ? "en" : language}
      className={`max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-10 space-y-5 ${
        highContrast ? "text-black dark:text-white" : ""
      }`}
    >
      {/* ---------- Header: Back button / greeting + clock ---------- */}
      <header className="flex items-center justify-between gap-3">
        {screen === "home" ? (
          <div className="min-w-0">
            <p className="text-lg text-slate-700 dark:text-slate-300">{copy.greeting},</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white truncate">
              {patientName}
            </h1>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openScreen("home")}
            className="elder-tile min-h-[64px] pl-3 pr-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-950 flex items-center gap-1 text-2xl font-bold cursor-pointer"
          >
            <ChevronLeft className="w-9 h-9 shrink-0" strokeWidth={3} aria-hidden="true" />
            <span>{copy.back}</span>
          </button>
        )}
        <div className="text-right shrink-0">
          <p className="text-3xl font-bold tabular-nums text-slate-950 dark:text-white">
            {now.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}
          </p>
          <p className="text-base text-slate-700 dark:text-slate-300">
            {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })}
          </p>
        </div>
      </header>

      {screen !== "home" && (
        <div className="flex items-center gap-3 border-b-2 border-slate-300 dark:border-slate-700 pb-4">
          {screenMeta[screen].icon}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white focus:outline-none"
          >
            {screenMeta[screen].title}
          </h1>
        </div>
      )}

      {/* ---------- Live feedback ---------- */}
      {ttsError && (
        <p
          role="alert"
          className="rounded-lg border-2 border-red-700 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-lg font-semibold text-red-900 dark:text-red-100"
        >
          {ttsError}
        </p>
      )}
      {voiceFeedback && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-lg font-semibold text-slate-950 dark:text-white"
        >
          {voiceFeedback}
        </p>
      )}

      {/* ================================================================ */}
      {/* HOME                                                              */}
      {/* ================================================================ */}
      {screen === "home" && (
        <>
          {/* Progress summary with pictographic dose dots */}
          <section aria-label={copy.doneOf(takenDoses, totalDoses)} className={`rounded-lg p-4 sm:p-5 space-y-3 ${surface}`}>
            <div className="flex items-center gap-3">
              {totalDoses > 0 && takenDoses === totalDoses ? (
                <CircleCheck className="w-11 h-11 text-green-700 dark:text-green-400 shrink-0" aria-hidden="true" />
              ) : (
                <SlotIcon slot={currentSlot} className="w-11 h-11 shrink-0" />
              )}
              <p className="text-2xl font-bold text-slate-950 dark:text-white">
                {totalDoses > 0 && takenDoses === totalDoses
                  ? copy.allDone
                  : copy.doneOf(takenDoses, totalDoses)}
              </p>
            </div>
            {totalDoses > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-hidden="true">
                {doseRows.map((r) => (
                  <li key={r.key}>
                    {r.taken ? (
                      <CircleCheck className="w-9 h-9 text-green-700 dark:text-green-400" strokeWidth={2.5} />
                    ) : (
                      <Circle className="w-9 h-9 text-slate-400 dark:text-slate-500" strokeWidth={2.5} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {strictlyVerified.length === 0 && (
            <section className={`rounded-lg p-5 space-y-4 text-center ${surface}`}>
              <p className="text-2xl font-bold text-slate-950 dark:text-white">{copy.noVerified}</p>
              <button
                type="button"
                onClick={onSwitchToCaregiver}
                className="elder-tile min-h-[64px] px-6 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xl font-bold cursor-pointer"
              >
                {copy.openCaregiver}
              </button>
            </section>
          )}

          {/* Big tiles */}
          <nav
            aria-label="Grandparents Mode"
            className={layout === "grid" ? "grid grid-cols-2 gap-3 sm:gap-4" : "flex flex-col gap-3"}
          >
            <ElderTile
              label={copy.medsNow}
              icon={<Pill className={`${iconCls} -rotate-45`} aria-hidden="true" />}
              tone="blue"
              layout={layout}
              highContrast={highContrast}
              badge={pendingNowCount}
              onClick={() => openScreen("now")}
            />
            <ElderTile
              label={copy.checklist}
              icon={<ListChecks className={iconCls} aria-hidden="true" />}
              tone="teal"
              layout={layout}
              highContrast={highContrast}
              onClick={() => openScreen("list")}
            />
            <ElderTile
              label={isSpeaking && !speakingMedId ? copy.stop : copy.hearAll}
              icon={
                isSpeaking && !speakingMedId ? (
                  <VolumeX className={iconCls} aria-hidden="true" />
                ) : (
                  <Volume2 className={iconCls} aria-hidden="true" />
                )
              }
              tone="amber"
              layout={layout}
              highContrast={highContrast}
              pressed={isSpeaking && !speakingMedId}
              onClick={() => handleSpeakSlot(currentSlot)}
            />
            <ElderTile
              label={copy.checkPill}
              icon={<Camera className={iconCls} aria-hidden="true" />}
              tone="violet"
              layout={layout}
              highContrast={highContrast}
              onClick={() => openScreen("camera")}
            />
            <ElderTile
              label={isListening ? copy.listening : copy.talk}
              icon={
                isListening ? (
                  <span className="elder-listening-dot rounded-full">
                    <MicOff className={iconCls} aria-hidden="true" />
                  </span>
                ) : (
                  <Mic className={iconCls} aria-hidden="true" />
                )
              }
              tone="slate"
              layout={layout}
              highContrast={highContrast}
              pressed={isListening}
              onClick={handleToggleVoiceRecognition}
            />
            <ElderTile
              label={copy.call}
              icon={<Phone className={iconCls} aria-hidden="true" />}
              tone="red"
              layout={layout}
              highContrast={highContrast}
              onClick={() => openScreen("call")}
            />
          </nav>

          <button
            type="button"
            onClick={() => openScreen("settings")}
            className={`elder-tile w-full min-h-[64px] px-5 rounded-lg flex items-center justify-center gap-3 text-xl font-semibold text-slate-900 dark:text-white cursor-pointer ${surface}`}
          >
            <Settings className="w-7 h-7" aria-hidden="true" />
            <span>{copy.settings}</span>
          </button>
        </>
      )}

      {/* ================================================================ */}
      {/* MEDICINES NOW (one at a time)                                     */}
      {/* ================================================================ */}
      {screen === "now" && (
        <div className="space-y-4">
          <div role="group" aria-label="Time of day" className="grid grid-cols-3 gap-2 sm:gap-3">
            {SLOT_ORDER.map((slot) => {
              const active = nowSlot === slot;
              const pending = doseRows.filter((r) => r.slot === slot && !r.taken).length;
              return (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectNowSlot(slot)}
                  className={`elder-tile relative min-h-[96px] px-2 py-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    active
                      ? "bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-950"
                      : "bg-white border-slate-300 text-slate-950 dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                  }`}
                >
                  <SlotIcon
                    slot={slot}
                    className="w-9 h-9"
                    colorClass={active ? "text-current" : undefined}
                  />
                  <span className="text-lg font-bold leading-tight">{slotName(language, slot)}</span>
                  {pending === 0 && doseRows.some((r) => r.slot === slot) && (
                    <CircleCheck
                      className="absolute top-1.5 right-1.5 w-6 h-6 text-green-600 dark:text-green-400"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {!focusMedicine ? (
            <section className={`rounded-lg p-8 text-center space-y-3 ${surface}`}>
              <SlotIcon slot={nowSlot} className="w-16 h-16 mx-auto" />
              <p className="text-2xl font-bold text-slate-950 dark:text-white">
                {strictlyVerified.length === 0 ? copy.noVerified : copy.nothingNow}
              </p>
            </section>
          ) : (
            <>
              {slotMedicines.length > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums">
                    {copy.ofCount(safeIndex + 1, slotMedicines.length)}
                  </p>
                  <ul className="flex gap-1.5" aria-hidden="true">
                    {slotMedicines.map((m, i) => {
                      const done = m.taken_slots_today.includes(nowSlot);
                      return (
                        <li
                          key={m.id}
                          className={`w-4 h-4 rounded-full border-2 ${
                            done
                              ? "bg-green-700 border-green-700 dark:bg-green-400 dark:border-green-400"
                              : i === safeIndex
                              ? "bg-slate-900 border-slate-900 dark:bg-white dark:border-white"
                              : "bg-transparent border-slate-400"
                          }`}
                        />
                      );
                    })}
                  </ul>
                </div>
              )}

              <MedicineFocusCard
                medicine={focusMedicine}
                slot={nowSlot}
                language={language}
                highContrast={highContrast}
                isSpeaking={isSpeaking && speakingMedId === focusMedicine.id}
                isBusy={busyKey === `${focusMedicine.id}-${nowSlot}`}
                labels={{
                  hear: copy.hear,
                  stop: copy.stop,
                  tookIt: copy.tookIt,
                  taken: copy.taken,
                  undo: copy.undo,
                  safety: copy.safety,
                }}
                onSpeak={handleSpeakSingle}
                onToggleTaken={(m, slot) => void handleToggleTaken(m, slot)}
              />

              {slotMedicines.length > 1 && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={safeIndex === 0}
                    onClick={() => setNowIndex(safeIndex - 1)}
                    className="elder-tile min-h-[72px] rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-900 text-slate-950 dark:text-white flex items-center justify-center gap-2 text-xl font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-8 h-8" strokeWidth={3} aria-hidden="true" />
                    <span>{copy.prev}</span>
                  </button>
                  <button
                    type="button"
                    disabled={safeIndex >= slotMedicines.length - 1}
                    onClick={() => setNowIndex(safeIndex + 1)}
                    className={`elder-tile min-h-[72px] rounded-lg flex items-center justify-center gap-2 text-xl font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      focusMedicine.taken_slots_today.includes(nowSlot)
                        ? "bg-blue-700 hover:bg-blue-800 text-white"
                        : "border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-900 text-slate-950 dark:text-white"
                    }`}
                  >
                    <span>{copy.next}</span>
                    <ChevronRight className="w-8 h-8" strokeWidth={3} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TODAY'S LIST                                                      */}
      {/* ================================================================ */}
      {screen === "list" && (
        <div className="space-y-5">
          {totalDoses === 0 && (
            <section className={`rounded-lg p-8 text-center ${surface}`}>
              <p className="text-2xl font-bold text-slate-950 dark:text-white">{copy.noVerified}</p>
            </section>
          )}
          {SLOT_ORDER.map((slot) => {
            const rows = doseRows.filter((r) => r.slot === slot);
            if (rows.length === 0) return null;
            const doneCount = rows.filter((r) => r.taken).length;
            return (
              <section key={slot} aria-labelledby={`slot-${slot}`} className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    id={`slot-${slot}`}
                    className="flex items-center gap-2.5 text-2xl font-bold text-slate-950 dark:text-white"
                  >
                    <SlotIcon slot={slot} className="w-9 h-9" />
                    <span>{slotName(language, slot)}</span>
                  </h2>
                  <span className="text-lg font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                    {doneCount}/{rows.length}
                  </span>
                </div>
                <ul className="space-y-2.5">
                  {rows.map((row) => {
                    const busy = busyKey === row.key;
                    return (
                      <li
                        key={row.key}
                        className={`rounded-lg p-3 flex items-center gap-3 ${
                          highContrast
                            ? "border-4 border-black dark:border-white bg-white dark:bg-black"
                            : row.taken
                            ? "border-2 border-green-700 dark:border-green-500 bg-green-50 dark:bg-green-950/40"
                            : "border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        }`}
                      >
                        <div className="w-20 h-16 sm:w-24 sm:h-[72px] rounded-md overflow-hidden border-2 border-slate-300 dark:border-slate-600 bg-white shrink-0">
                          <StripImage
                            src={row.medicine.strip_image_url}
                            alt=""
                            title={row.medicine.medicine_name}
                            className="w-full h-full"
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xl font-bold leading-tight text-slate-950 dark:text-white break-words">
                            {row.medicine.medicine_name}
                          </p>
                          <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                            {row.medicine.dosage} · {row.timeLabel}
                          </p>
                          <MealCue relation={row.medicine.meal_relation} language={language} compact />
                        </div>
                        <button
                          type="button"
                          aria-pressed={row.taken}
                          aria-label={`${row.medicine.medicine_name}: ${row.taken ? `${copy.taken} — ${copy.undo}` : copy.tookIt}`}
                          disabled={busy}
                          onClick={() => void handleToggleTaken(row.medicine, row.slot)}
                          className={`elder-tile w-[84px] min-h-[84px] sm:w-[104px] rounded-lg flex flex-col items-center justify-center gap-1 text-sm sm:text-base font-bold cursor-pointer shrink-0 transition-colors disabled:opacity-60 ${
                            row.taken
                              ? "bg-white dark:bg-slate-900 border-2 border-green-700 dark:border-green-400 text-green-800 dark:text-green-300"
                              : "bg-green-700 hover:bg-green-800 text-white"
                          }`}
                        >
                          {busy ? (
                            <Loader2 className="w-9 h-9 animate-spin" aria-hidden="true" />
                          ) : row.taken ? (
                            <CircleCheck className="w-10 h-10" strokeWidth={2.5} aria-hidden="true" />
                          ) : (
                            <Check className="w-10 h-10" strokeWidth={4} aria-hidden="true" />
                          )}
                          <span className="leading-tight text-center px-1">
                            {row.taken ? copy.taken : copy.tookIt}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* ================================================================ */}
      {/* CHECK MY PILL (camera)                                            */}
      {/* ================================================================ */}
      {screen === "camera" && (
        <div className="space-y-4">
          <input
            ref={stripInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void handleStripVerifyFile(e)}
            className="hidden"
            aria-label={copy.takePhoto}
          />

          {!stripResult && (
            <>
              <p className="text-xl text-slate-800 dark:text-slate-200">{copy.photoHint}</p>
              <button
                type="button"
                disabled={isVerifyingStrip}
                onClick={() => stripInputRef.current?.click()}
                className={`elder-tile w-full min-h-[200px] rounded-lg flex flex-col items-center justify-center gap-4 text-3xl font-bold cursor-pointer disabled:opacity-80 ${TONE_CLASS.violet} ${
                  highContrast ? "border-4 border-black dark:border-white" : ""
                }`}
              >
                {isVerifyingStrip ? (
                  <Loader2 className="w-20 h-20 animate-spin" aria-hidden="true" />
                ) : (
                  <Camera className="w-20 h-20" aria-hidden="true" />
                )}
                <span>{isVerifyingStrip ? copy.checking : copy.takePhoto}</span>
              </button>
            </>
          )}

          {stripResult && (
            <section
              role="status"
              aria-live="assertive"
              className={`rounded-lg p-6 sm:p-8 text-center space-y-4 text-white ${
                stripResult.matched ? "bg-green-700" : "bg-red-700"
              } ${highContrast ? "border-4 border-black dark:border-white" : ""}`}
            >
              {stripResult.matched ? (
                <CircleCheck className="w-24 h-24 mx-auto" strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <CircleX className="w-24 h-24 mx-auto" strokeWidth={2.5} aria-hidden="true" />
              )}
              <p className="text-3xl font-bold leading-tight">
                {stripResult.matched ? copy.yesMatch : copy.noMatch}
              </p>
              {stripResult.detected_brand && (
                <p className="text-2xl font-semibold">{stripResult.detected_brand}</p>
              )}
              <p className="text-xl leading-relaxed">
                {language === "hi"
                  ? stripResult.spoken_hi
                  : language === "mr"
                  ? stripResult.spoken_mr
                  : stripResult.spoken_en}
              </p>
            </section>
          )}

          {stripResult && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  speak(
                    language === "hi"
                      ? stripResult.spoken_hi
                      : language === "mr"
                      ? stripResult.spoken_mr
                      : stripResult.spoken_en
                  )
                }
                className={`elder-tile min-h-[80px] rounded-lg flex items-center justify-center gap-3 text-2xl font-bold cursor-pointer ${TONE_CLASS.amber}`}
              >
                <Volume2 className="w-8 h-8" aria-hidden="true" />
                <span>{copy.hear}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStripResult(null);
                  stripInputRef.current?.click();
                }}
                className={`elder-tile min-h-[80px] rounded-lg flex items-center justify-center gap-3 text-2xl font-bold cursor-pointer ${TONE_CLASS.violet}`}
              >
                <RotateCcw className="w-8 h-8" aria-hidden="true" />
                <span>{copy.checkAnother}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* CALL FAMILY                                                       */}
      {/* ================================================================ */}
      {screen === "call" && (
        <div className="space-y-4">
          <section className={`rounded-lg p-6 flex flex-col items-center text-center gap-3 ${surface}`}>
            <span
              aria-hidden="true"
              className="w-28 h-28 rounded-full bg-slate-200 dark:bg-slate-800 border-4 border-slate-300 dark:border-slate-600 flex items-center justify-center text-5xl font-bold text-slate-900 dark:text-white"
            >
              {initials}
            </span>
            <p className="text-3xl font-bold text-slate-950 dark:text-white">{emergencyContact.name}</p>
            <p className="text-xl text-slate-700 dark:text-slate-300">
              {emergencyContact.relation} · <span className="tabular-nums">{emergencyContact.phone}</span>
            </p>
          </section>

          <a
            href={cleanTelHref}
            className={`elder-tile w-full min-h-[112px] rounded-lg flex items-center justify-center gap-4 text-3xl font-bold ${TONE_CLASS.red} ${
              highContrast ? "border-4 border-black dark:border-white" : ""
            }`}
          >
            <Phone className="w-12 h-12" aria-hidden="true" />
            <span>
              {copy.callNow} {emergencyContact.name.split(" ")[0]}
            </span>
          </a>

          <a
            href={emergencyWhatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`elder-tile w-full min-h-[88px] rounded-lg flex items-center justify-center gap-4 text-2xl font-bold ${TONE_CLASS.green} ${
              highContrast ? "border-4 border-black dark:border-white" : ""
            }`}
          >
            <MessageCircle className="w-10 h-10" aria-hidden="true" />
            <span>{copy.sos}</span>
          </a>
        </div>
      )}

      {/* ================================================================ */}
      {/* SETTINGS                                                          */}
      {/* ================================================================ */}
      {screen === "settings" && (
        <div className="space-y-6">
          <section aria-labelledby="set-lang" className="space-y-2.5">
            <h2 id="set-lang" className="text-2xl font-bold text-slate-950 dark:text-white">
              {copy.language}
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(Object.keys(LANGUAGES) as LanguageCode[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  lang={code}
                  aria-pressed={language === code}
                  onClick={() => {
                    stopSpeaking();
                    setIsSpeaking(false);
                    onChangeLanguage(code);
                  }}
                  className={optionBtn(language === code)}
                >
                  {LANGUAGES[code].nativeLabel}
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="set-size" className="space-y-2.5">
            <h2 id="set-size" className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-white">
              <Type className="w-7 h-7" aria-hidden="true" />
              <span>{copy.textSize}</span>
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(
                [
                  { key: "normal", label: "A", size: "text-xl" },
                  { key: "lg", label: "A", size: "text-3xl" },
                  { key: "xl", label: "A", size: "text-5xl" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={textScale === opt.key}
                  aria-label={`${copy.textSize}: ${opt.key === "normal" ? "normal" : opt.key === "lg" ? "large" : "extra large"}`}
                  onClick={() => setTextScale(opt.key)}
                  className={optionBtn(textScale === opt.key)}
                >
                  <span className={opt.size}>{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="set-contrast" className="space-y-2.5">
            <h2 id="set-contrast" className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-white">
              <Contrast className="w-7 h-7" aria-hidden="true" />
              <span>{copy.contrast}</span>
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <button type="button" aria-pressed={!highContrast} onClick={() => setHighContrast(false)} className={optionBtn(!highContrast)}>
                {copy.off}
              </button>
              <button type="button" aria-pressed={highContrast} onClick={() => setHighContrast(true)} className={optionBtn(highContrast)}>
                {copy.on}
              </button>
            </div>
          </section>

          <section aria-labelledby="set-layout" className="space-y-2.5">
            <h2 id="set-layout" className="text-2xl font-bold text-slate-950 dark:text-white">
              {copy.layout}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} className={optionBtn(layout === "grid")}>
                <LayoutGrid className="w-7 h-7" aria-hidden="true" />
                <span>{copy.grid}</span>
              </button>
              <button type="button" aria-pressed={layout === "rows"} onClick={() => setLayout("rows")} className={optionBtn(layout === "rows")}>
                <Rows3 className="w-7 h-7" aria-hidden="true" />
                <span>{copy.rows}</span>
              </button>
            </div>
          </section>

          <section aria-labelledby="set-code" className="space-y-2.5">
            <h2 id="set-code" className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-white">
              <KeyRound className="w-7 h-7" aria-hidden="true" />
              <span>{copy.familyCode}</span>
            </h2>
            <form onSubmit={handleApplyShareCode} className="flex gap-2 sm:gap-3">
              <label htmlFor="elder-share-code" className="sr-only">
                {copy.familyCode}
              </label>
              <input
                id="elder-share-code"
                type="text"
                value={codeDraft}
                onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
                maxLength={12}
                autoComplete="off"
                className="flex-1 min-w-0 min-h-[72px] px-4 rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-900 text-slate-950 dark:text-white font-mono-data text-2xl font-bold uppercase"
              />
              <button
                type="submit"
                className="elder-tile min-h-[72px] px-6 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xl font-bold cursor-pointer shrink-0"
              >
                {copy.load}
              </button>
            </form>
          </section>

          <button
            type="button"
            onClick={onSwitchToCaregiver}
            className="elder-tile w-full min-h-[64px] px-5 rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center gap-3 text-xl font-semibold cursor-pointer"
          >
            <LogOut className="w-7 h-7" aria-hidden="true" />
            <span>{copy.caregiverExit}</span>
          </button>

          <p className="flex items-center justify-center gap-2 text-base text-slate-700 dark:text-slate-300">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            <span>{copy.safety}</span>
          </p>
        </div>
      )}
    </main>
  );
}
