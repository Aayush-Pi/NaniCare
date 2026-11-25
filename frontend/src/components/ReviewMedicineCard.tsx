import { ChangeEvent } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  ImagePlus,
  Trash2,
} from "lucide-react";
import { STRIP_PRESET_LIBRARY } from "../config";
import {
  AccuracyLevel,
  MealRelation,
  ScannedMedicineCandidate,
} from "../types/api";
import { parseFrequencyToSlots } from "../utils/scheduler";
import { StripImage } from "./StripImage";

interface ReviewMedicineCardProps {
  index: number;
  draft: ScannedMedicineCandidate;
  onChange: (id: string, patch: Partial<ScannedMedicineCandidate>) => void;
  onRemove: (id: string) => void;
}

function renderAccuracyLabel(level: AccuracyLevel) {
  if (level === "High") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>AI Accuracy: High</span>
      </span>
    );
  }
  if (level === "Medium") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>AI Accuracy: Medium — Review highlighted fields</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-red-700 dark:text-red-400">
      <AlertOctagon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>AI Accuracy: Low — Careful manual verification required</span>
    </span>
  );
}

export function ReviewMedicineCard({
  index,
  draft,
  onChange,
  onRemove,
}: ReviewMedicineCardProps) {
  const computedSlots = parseFrequencyToSlots(draft.frequency_code);
  const highlightYellow =
    !draft.manually_verified &&
    (draft.needs_review ||
      draft.ai_accuracy === "Low" ||
      draft.ai_accuracy === "Medium");

  const inputBaseClass = highlightYellow
    ? "w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-amber-400 dark:border-amber-500/80 bg-amber-50/70 dark:bg-amber-950/30 text-slate-900 dark:text-white text-sm font-medium"
    : "w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-medium";

  function handleStripPhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        onChange(draft.id, { strip_image_url: reader.result });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <article
      className={`rounded-2xl border p-6 space-y-5 transition-colors ${
        draft.manually_verified
          ? "border-emerald-500 dark:border-emerald-500/70 bg-emerald-50/40 dark:bg-emerald-950/20"
          : highlightYellow
          ? "border-amber-400 dark:border-amber-500/80 bg-amber-50/60 dark:bg-amber-950/25"
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      }`}
    >
      {/* Header Row: Layer 1 AI Accuracy + Layer 2 Manual Verification Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              Medicine 0{index + 1}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            {renderAccuracyLabel(draft.ai_accuracy)}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {draft.ai_accuracy_reason}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() =>
              onChange(draft.id, {
                manually_verified: !draft.manually_verified,
              })
            }
            className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              draft.manually_verified
                ? "bg-emerald-700 hover:bg-emerald-800 text-white"
                : "bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950"
            }`}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>
              {draft.manually_verified
                ? "Manually Verified"
                : "Confirm Manually Verified"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onRemove(draft.id)}
            aria-label={`Remove ${draft.medicine_name || "medicine"}`}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Form Fields + Visual Pill-Strip Matching */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Medicine Name
              </span>
              <input
                type="text"
                value={draft.medicine_name}
                onChange={(e) =>
                  onChange(draft.id, {
                    medicine_name: e.target.value,
                    manually_verified: false,
                  })
                }
                placeholder="e.g., Atorvastatin 10mg"
                className={inputBaseClass}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Dosage Strength &amp; Count
              </span>
              <input
                type="text"
                value={draft.dosage}
                onChange={(e) =>
                  onChange(draft.id, {
                    dosage: e.target.value,
                    manually_verified: false,
                  })
                }
                placeholder="e.g., 10 mg (1 tablet)"
                className={inputBaseClass}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Dosage Schedule (M-A-N)
              </span>
              <input
                type="text"
                value={draft.frequency_code}
                onChange={(e) =>
                  onChange(draft.id, {
                    frequency_code: e.target.value,
                    manually_verified: false,
                  })
                }
                placeholder="1-0-1"
                className={`${inputBaseClass} font-mono-data`}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Slots:{" "}
                {computedSlots
                  .map((s) => `${s.slot} (${s.time_label})`)
                  .join(" · ")}
              </p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Meal Relation
              </span>
              <select
                value={draft.meal_relation}
                onChange={(e) =>
                  onChange(draft.id, {
                    meal_relation: e.target.value as MealRelation,
                    manually_verified: false,
                  })
                }
                className={inputBaseClass}
              >
                <option value="Before Food">Before Food</option>
                <option value="After Food">After Food</option>
                <option value="With Food">With Food</option>
                <option value="Anytime">Anytime</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Duration
              </span>
              <input
                type="text"
                value={draft.duration_days}
                onChange={(e) =>
                  onChange(draft.id, {
                    duration_days: e.target.value,
                    manually_verified: false,
                  })
                }
                placeholder="e.g., 30 days"
                className={inputBaseClass}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 pt-1">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Verified Voiceover Instruction (English)
              </span>
              <input
                type="text"
                value={draft.simple_explanation_en}
                onChange={(e) =>
                  onChange(draft.id, {
                    simple_explanation_en: e.target.value,
                  })
                }
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Voiceover (Hindi / हिन्दी)
                </span>
                <input
                  type="text"
                  value={draft.simple_explanation_hi}
                  onChange={(e) =>
                    onChange(draft.id, {
                      simple_explanation_hi: e.target.value,
                    })
                  }
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Voiceover (Marathi / मराठी)
                </span>
                <input
                  type="text"
                  value={draft.simple_explanation_mr}
                  onChange={(e) =>
                    onChange(draft.id, {
                      simple_explanation_mr: e.target.value,
                    })
                  }
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Visual Pill-Strip Matcher */}
        <div className="lg:col-span-4 space-y-3 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-6">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Visual Pill-Strip Photo (for Grandparents Mode)
          </p>

          <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 aspect-[4/3]">
            <StripImage
              src={draft.strip_image_url}
              alt={`${draft.medicine_name} strip`}
              title={draft.medicine_name || "Medicine Strip"}
              className="w-full h-full"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer">
              <ImagePlus
                className="w-4 h-4 text-teal-700 dark:text-teal-400"
                aria-hidden="true"
              />
              <span>Snap or Upload Actual Strip Photo</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleStripPhotoUpload}
                className="hidden"
              />
            </label>

            <select
              aria-label="Choose a preset medicine strip photo"
              value={
                STRIP_PRESET_LIBRARY.find((p) => p.imageUrl === draft.strip_image_url)
                  ?.imageUrl || ""
              }
              onChange={(e) => {
                const found = STRIP_PRESET_LIBRARY.find(
                  (p) => p.imageUrl === e.target.value
                );
                if (found) {
                  onChange(draft.id, {
                    strip_image_url: found.imageUrl,
                    pill_appearance: found.appearance,
                  });
                }
              }}
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300"
            >
              <option value="">Custom uploaded strip photo</option>
              {STRIP_PRESET_LIBRARY.map((preset) => (
                <option key={preset.id} value={preset.imageUrl}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </article>
  );
}
