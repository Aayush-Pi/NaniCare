import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock,
  Loader2,
  Moon,
  Pill,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sun,
  Sunrise,
  Utensils,
  Volume2,
  VolumeX,
} from "lucide-react";
import { LanguageCode, MealRelation, TimeSlotKey, VerifiedMedicine } from "../types/api";
import { SLOT_LOCALIZED_LABELS } from "../utils/scheduler";
import { getMedicineSpokenText } from "../utils/tts";
import { StripImage } from "./StripImage";

/* ------------------------------------------------------------------ */
/* Shared non-textual visual cues for Grandparents Mode                */
/* ------------------------------------------------------------------ */

export const MEAL_LABELS: Record<LanguageCode, Record<MealRelation, string>> = {
  en: {
    "Before Food": "Before food",
    "After Food": "After food",
    "With Food": "With food",
    Anytime: "Any time",
  },
  hi: {
    "Before Food": "खाने से पहले",
    "After Food": "खाने के बाद",
    "With Food": "खाने के साथ",
    Anytime: "कभी भी",
  },
  mr: {
    "Before Food": "जेवणापूर्वी",
    "After Food": "जेवणानंतर",
    "With Food": "जेवणासोबत",
    Anytime: "कधीही",
  },
};

/** Slot name without the clock time, e.g. "Morning" / "सुबह" */
export function slotName(language: LanguageCode, slot: TimeSlotKey): string {
  return SLOT_LOCALIZED_LABELS[language][slot].split(" · ")[0];
}

/** Slot clock time, e.g. "8:00 AM" */
export function slotTime(language: LanguageCode, slot: TimeSlotKey): string {
  return SLOT_LOCALIZED_LABELS[language][slot].split(" · ")[1] || "";
}

/** Sunrise / Sun / Moon pictogram so elders recognise time-of-day without reading */
export function SlotIcon({
  slot,
  className = "w-6 h-6",
  colorClass,
}: {
  slot: TimeSlotKey;
  className?: string;
  colorClass?: string;
}) {
  if (slot === "Morning") {
    return (
      <Sunrise
        className={`${className} ${colorClass ?? "text-amber-600 dark:text-amber-400"}`}
        aria-hidden="true"
      />
    );
  }
  if (slot === "Afternoon") {
    return (
      <Sun
        className={`${className} ${colorClass ?? "text-orange-600 dark:text-orange-400"}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <Moon
      className={`${className} ${colorClass ?? "text-indigo-700 dark:text-indigo-300"}`}
      aria-hidden="true"
    />
  );
}

const CHIP_CLASS =
  "inline-flex items-center gap-2 min-h-[48px] px-3 py-2 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-950 dark:text-white";

/** Pill-then-plate / plate-then-pill pictogram showing when to eat */
export function MealCue({
  relation,
  language,
  compact = false,
}: {
  relation: MealRelation;
  language: LanguageCode;
  compact?: boolean;
}) {
  const icon = compact ? "w-5 h-5" : "w-6 h-6";
  const pill = <Pill className={`${icon} -rotate-45 text-blue-700 dark:text-blue-300`} aria-hidden="true" />;
  const food = <Utensils className={`${icon} text-slate-800 dark:text-slate-200`} aria-hidden="true" />;
  const arrow = <ArrowRight className="w-4 h-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />;

  let pictogram;
  if (relation === "Before Food") {
    pictogram = (
      <>
        {pill}
        {arrow}
        {food}
      </>
    );
  } else if (relation === "After Food") {
    pictogram = (
      <>
        {food}
        {arrow}
        {pill}
      </>
    );
  } else if (relation === "With Food") {
    pictogram = (
      <>
        {pill}
        <Plus className="w-4 h-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
        {food}
      </>
    );
  } else {
    pictogram = <Clock className={`${icon} text-slate-800 dark:text-slate-200`} aria-hidden="true" />;
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-800 dark:text-slate-200">
        <span className="inline-flex items-center gap-0.5">{pictogram}</span>
        <span>{MEAL_LABELS[language][relation]}</span>
      </span>
    );
  }

  return (
    <span className={CHIP_CLASS}>
      <span className="inline-flex items-center gap-1">{pictogram}</span>
      <span className="text-lg font-semibold">{MEAL_LABELS[language][relation]}</span>
    </span>
  );
}

/** Draws one pill icon per tablet so the dose count is visible at a glance */
export function DoseCount({ count, dosage }: { count?: number; dosage: string }) {
  const n = Math.max(1, Math.round(count || 1));
  const shown = Math.min(n, 4);
  return (
    <span className={CHIP_CLASS}>
      <span className="inline-flex items-center" aria-hidden="true">
        {Array.from({ length: shown }).map((_, i) => (
          <Pill key={i} className="w-6 h-6 -rotate-45 text-blue-700 dark:text-blue-300" />
        ))}
        {n > 4 && <span className="ml-1 text-lg font-bold">×{n}</span>}
      </span>
      <span className="text-lg font-semibold">{dosage}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* One-medicine-at-a-time focus card                                   */
/* ------------------------------------------------------------------ */

interface MedicineFocusCardProps {
  medicine: VerifiedMedicine;
  slot: TimeSlotKey;
  language: LanguageCode;
  highContrast?: boolean;
  isSpeaking: boolean;
  isBusy: boolean;
  labels: {
    hear: string;
    stop: string;
    tookIt: string;
    taken: string;
    undo: string;
    safety: string;
  };
  onSpeak: (medicine: VerifiedMedicine) => void;
  onToggleTaken: (medicine: VerifiedMedicine, slot: TimeSlotKey) => void;
}

export function MedicineFocusCard({
  medicine,
  slot,
  language,
  highContrast = false,
  isSpeaking,
  isBusy,
  labels,
  onSpeak,
  onToggleTaken,
}: MedicineFocusCardProps) {
  // Safety invariant: never render an unverified prescription in Grandparents Mode
  if (!medicine.caregiver_verified) return null;

  const isTaken = medicine.taken_slots_today.includes(slot);
  const slotInfo = medicine.slots.find((s) => s.slot === slot);
  const spoken = getMedicineSpokenText(medicine, language);

  const frame = highContrast
    ? "border-4 border-black dark:border-white"
    : isTaken
    ? "border-2 border-green-700 dark:border-green-500"
    : "border-2 border-slate-300 dark:border-slate-700";

  return (
    <article
      aria-label={medicine.medicine_name}
      className={`rounded-lg overflow-hidden ${frame} ${
        isTaken ? "bg-green-50 dark:bg-green-950/40" : "bg-white dark:bg-slate-900"
      }`}
    >
      {isTaken && (
        <div
          role="status"
          className="flex items-center justify-center gap-3 bg-green-700 text-white py-3 px-4 text-2xl font-bold"
        >
          <CircleCheck className="w-8 h-8 shrink-0" aria-hidden="true" />
          <span>{labels.taken}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-4 sm:p-6">
        <div className="rounded-md overflow-hidden border-2 border-slate-300 dark:border-slate-600 bg-white aspect-[4/3]">
          <StripImage
            src={medicine.strip_image_url}
            alt={`Picture of ${medicine.medicine_name} strip`}
            title={medicine.medicine_name}
            className="w-full h-full"
          />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <p className="inline-flex items-center gap-2 text-base font-semibold text-teal-800 dark:text-teal-300">
            <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{labels.safety}</span>
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold leading-tight text-slate-950 dark:text-white break-words">
            {medicine.medicine_name}
          </h2>
          <div className="flex flex-wrap gap-2.5">
            <DoseCount count={slotInfo?.dose_count} dosage={medicine.dosage} />
            <MealCue relation={medicine.meal_relation} language={language} />
            <span className={CHIP_CLASS}>
              <SlotIcon slot={slot} />
              <span className="text-lg font-semibold">
                {slotName(language, slot)} · {slotInfo?.time_label || slotTime(language, slot)}
              </span>
            </span>
          </div>
          {spoken && (
            <p className="text-lg sm:text-xl leading-relaxed text-slate-900 dark:text-slate-100">
              {spoken}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
        <button
          type="button"
          aria-pressed={isSpeaking}
          onClick={() => onSpeak(medicine)}
          className={`elder-tile min-h-[80px] px-5 py-4 rounded-lg flex items-center justify-center gap-3 text-2xl font-bold transition-colors cursor-pointer ${
            isSpeaking
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
              : "bg-amber-400 hover:bg-amber-300 text-slate-950"
          } ${highContrast ? "border-4 border-black dark:border-white" : ""}`}
        >
          {isSpeaking ? (
            <VolumeX className="w-8 h-8 shrink-0" aria-hidden="true" />
          ) : (
            <Volume2 className="w-8 h-8 shrink-0" aria-hidden="true" />
          )}
          <span>{isSpeaking ? labels.stop : labels.hear}</span>
        </button>

        {isTaken ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onToggleTaken(medicine, slot)}
            className="elder-tile sm:col-span-2 min-h-[80px] px-5 py-4 rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center gap-3 text-xl font-semibold cursor-pointer disabled:opacity-60"
          >
            {isBusy ? (
              <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="w-7 h-7" aria-hidden="true" />
            )}
            <span>{labels.undo}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onToggleTaken(medicine, slot)}
            className={`elder-tile sm:col-span-2 min-h-[96px] px-5 py-4 rounded-lg bg-green-700 hover:bg-green-800 text-white flex items-center justify-center gap-4 text-2xl sm:text-3xl font-bold transition-colors cursor-pointer disabled:opacity-70 ${
              highContrast ? "border-4 border-black dark:border-white" : ""
            }`}
          >
            <span className="w-14 h-14 rounded-full bg-white text-green-800 flex items-center justify-center shrink-0">
              {isBusy ? (
                <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="w-9 h-9" strokeWidth={4} aria-hidden="true" />
              )}
            </span>
            <span>{labels.tookIt}</span>
          </button>
        )}
      </div>
    </article>
  );
}
