import { Check, CheckCircle2, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { LanguageCode, TimeSlotKey, VerifiedMedicine } from "../types/api";
import { getMedicineSpokenText } from "../utils/tts";
import { StripImage } from "./StripImage";

interface NaniMedicineCardProps {
  medicine: VerifiedMedicine;
  activeSlot: TimeSlotKey;
  language: LanguageCode;
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
      className={`rounded-3xl border-2 p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center transition-colors ${
        isTaken
          ? "border-emerald-700 dark:border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30"
          : "border-slate-950 dark:border-slate-200 bg-white dark:bg-slate-900"
      }`}
    >
      {/* Visual Pill-Strip Thumbnail */}
      <div className="lg:col-span-5 space-y-2">
        <div className="rounded-2xl overflow-hidden border-2 border-slate-900 dark:border-slate-300 aspect-[4/3] bg-slate-100 dark:bg-slate-950">
          <StripImage
            src={medicine.strip_image_url}
            alt={`Medicine strip for ${medicine.medicine_name}`}
            title={medicine.medicine_name}
            className="w-full h-full"
          />
        </div>
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">
          Match this strip: {medicine.pill_appearance}
        </p>
      </div>

      {/* High-Contrast Info & Oversized Action Buttons */}
      <div className="lg:col-span-7 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold text-teal-800 dark:text-teal-300">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>Verified by {medicine.verified_by}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {medicine.slots
                .map((s) => `${s.slot} ${s.time_label}`)
                .join(" / ")}
            </span>
          </div>

          <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-950 dark:text-white leading-tight">
            {medicine.medicine_name}
          </h2>

          <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
            {medicine.dosage} · {medicine.meal_relation}
          </p>

          <p className="text-lg sm:text-xl text-slate-800 dark:text-slate-200 leading-relaxed pt-1">
            {spokenLine}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <button
            type="button"
            onClick={() => onSpeak(medicine)}
            className={`min-h-[68px] px-6 py-4 rounded-2xl border-2 font-display text-xl font-extrabold flex items-center justify-center gap-3 transition-colors cursor-pointer ${
              isSpeakingThis
                ? "bg-amber-500 text-slate-950 border-slate-950"
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

          <button
            type="button"
            onClick={() => onToggleTaken(medicine, activeSlot)}
            className={`min-h-[68px] px-6 py-4 rounded-2xl border-2 font-display text-xl font-extrabold flex items-center justify-center gap-3 transition-colors cursor-pointer ${
              isTaken
                ? "bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-950 dark:border-emerald-300"
                : "bg-teal-700 hover:bg-teal-800 dark:bg-teal-400 dark:hover:bg-teal-300 text-white dark:text-slate-950 border-teal-900 dark:border-teal-200"
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
                <Check className="w-6 h-6 shrink-0" aria-hidden="true" />
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
