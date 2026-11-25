import { Check, CheckCircle2, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { LanguageCode, TimeSlotKey, VerifiedMedicine } from "../types/api";
import { getMedicineSpokenText } from "../utils/tts";
import { StripImage } from "./StripImage";

interface NaniMedicineCardProps {
  medicine: VerifiedMedicine;
  activeSlot: TimeSlotKey;
  language: LanguageCode;
  highContrast?: boolean;
  isSpeakingThis: boolean;
  labels: {
    listenOne: string;
    stopVoice: string;
    takeAction: string;
    takenDone: string;
  };
  onSpeak: (medicine: VerifiedMedicine) => void;
  onToggleTaken: (medicine: VerifiedMedicine, slot: TimeSlotKey) => void;
}

export function NaniMedicineCard({
  medicine,
  activeSlot,
  language,
  highContrast = false,
  isSpeakingThis,
  labels,
  onSpeak,
  onToggleTaken,
}: NaniMedicineCardProps) {
  // Safety invariant: never render an unverified prescription card in Nani Mode
  if (!medicine.caregiver_verified) {
    return null;
  }

  const isTaken = medicine.taken_slots_today.includes(activeSlot);
  const spokenLine = getMedicineSpokenText(medicine, language);

  return (
    <article
      className={`rounded-lg border-2 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center transition-colors ${
        isTaken
          ? highContrast
            ? "border-green-800 dark:border-green-300 bg-green-50 dark:bg-black"
            : "border-green-700 dark:border-green-500 bg-green-50/80 dark:bg-green-950/30"
          : highContrast
          ? "border-black dark:border-yellow-300 bg-white dark:bg-black"
          : "border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900"
      }`}
    >
      {/* Visual Pill-Strip Thumbnail */}
      <div className="lg:col-span-4 space-y-2">
        <div className="rounded-md overflow-hidden border-2 border-slate-900 dark:border-slate-300 aspect-[4/3] bg-white dark:bg-slate-950">
          <StripImage
            src={medicine.strip_image_url}
            alt={`Medicine strip visual for ${medicine.medicine_name}`}
            title={medicine.medicine_name}
            className="w-full h-full"
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-sm font-bold">
          <span className="text-slate-900 dark:text-slate-100">{medicine.dosage}</span>
          <span className="px-2 py-0.5 rounded-sm bg-slate-200 dark:bg-slate-800 text-slate-950 dark:text-white text-xs font-bold">
            {medicine.meal_relation}
          </span>
        </div>
      </div>

      {/* High-Contrast Info & Oversized Action Buttons */}
      <div className="lg:col-span-8 space-y-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-bold text-teal-900 dark:text-teal-300">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Verified</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-mono-data">
              {medicine.slots.map((s) => `${s.slot} ${s.time_label}`).join(" / ")}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white leading-tight">
              {medicine.medicine_name}
            </h3>
            {isTaken && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-green-700 text-white text-xs sm:text-sm font-extrabold uppercase tracking-wide">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>{labels.takenDone}</span>
              </span>
            )}
          </div>

          <p className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed pt-1">
            {spokenLine}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            aria-pressed={isSpeakingThis}
            onClick={() => onSpeak(medicine)}
            className={`min-h-[64px] px-5 py-3.5 rounded-md border-2 font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-2.5 transition-colors cursor-pointer ${
              isSpeakingThis
                ? "bg-amber-400 text-slate-950 border-slate-950"
                : "bg-slate-950 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950 border-slate-950 dark:border-white"
            }`}
          >
            {isSpeakingThis ? (
              <>
                <VolumeX className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{labels.stopVoice}</span>
              </>
            ) : (
              <>
                <Volume2 className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{labels.listenOne}</span>
              </>
            )}
          </button>

          {/* Unmistakable Bright GREEN button for elders to confirm pill taken */}
          <button
            type="button"
            aria-pressed={isTaken}
            onClick={() => onToggleTaken(medicine, activeSlot)}
            className={`min-h-[64px] px-5 py-3.5 rounded-md border-2 font-display text-lg sm:text-xl font-extrabold flex items-center justify-center gap-2.5 transition-colors cursor-pointer ${
              isTaken
                ? "bg-green-800 hover:bg-green-900 text-white border-green-950 dark:border-green-300"
                : "bg-green-700 hover:bg-green-800 text-white border-green-950 dark:border-green-300"
            }`}
          >
            {isTaken ? (
              <>
                <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>
                  {labels.takenDone} ({activeSlot})
                </span>
              </>
            ) : (
              <>
                <Check className="w-6 h-6 shrink-0 stroke-[3]" aria-hidden="true" />
                <span>
                  {labels.takeAction} ({activeSlot})
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
