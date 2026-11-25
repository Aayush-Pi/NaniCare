import { FormEvent, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { VITALS_RANGES } from "../config";
import { CreateVitalRequest, VitalLogEntry } from "../types/api";

interface VitalsLoggerProps {
  shareCode: string;
  vitals: VitalLogEntry[];
  isSubmitting: boolean;
  onLogVital: (payload: CreateVitalRequest) => Promise<void>;
  onDeleteVital: (id: string) => Promise<void>;
}

function assessVital(entry: VitalLogEntry): { label: string; elevated: boolean } {
  if (typeof entry.flagged === "boolean") {
    return {
      label: entry.flagged ? entry.flag_reason || "Needs Review" : "Within Range",
      elevated: entry.flagged,
    };
  }

  const highTemp =
    entry.temperature_f > VITALS_RANGES.temperature_f.max ||
    entry.temperature_f < VITALS_RANGES.temperature_f.min;
  const highBp =
    entry.bp_systolic > VITALS_RANGES.bp_systolic.max ||
    entry.bp_systolic < VITALS_RANGES.bp_systolic.min ||
    entry.bp_diastolic > VITALS_RANGES.bp_diastolic.max ||
    entry.bp_diastolic < VITALS_RANGES.bp_diastolic.min;

  return highTemp || highBp
    ? { label: "Needs Review", elevated: true }
    : { label: "Within Range", elevated: false };
}

export function VitalsLogger({
  shareCode,
  vitals,
  isSubmitting,
  onLogVital,
  onDeleteVital,
}: VitalsLoggerProps) {
  const [temperatureF, setTemperatureF] = useState("98.6");
  const [bpSystolic, setBpSystolic] = useState("122");
  const [bpDiastolic, setBpDiastolic] = useState("78");
  const [weightKg, setWeightKg] = useState("61.5");
  const [notes, setNotes] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const temp = Number.parseFloat(temperatureF);
    const sys = Number.parseInt(bpSystolic, 10);
    const dia = Number.parseInt(bpDiastolic, 10);
    const wt = Number.parseFloat(weightKg);

    if ([temp, sys, dia, wt].some((n) => Number.isNaN(n))) return;

    await onLogVital({
      share_code: shareCode,
      temperature_f: temp,
      bp_systolic: sys,
      bp_diastolic: dia,
      weight_kg: wt,
      notes: notes.trim() || undefined,
    });
    setNotes("");
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Log Vitals Reading (POST /vitals)
          </h2>
          <span className="text-xs font-mono-data text-slate-500 dark:text-slate-400">
            Profile: {shareCode}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Temperature (°F)
            </span>
            <input
              type="number"
              step="0.1"
              min="92"
              max="108"
              required
              value={temperatureF}
              onChange={(e) => setTemperatureF(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Normal: {VITALS_RANGES.temperature_f.min}–{VITALS_RANGES.temperature_f.max} °F
            </p>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Systolic BP (mmHg)
            </span>
            <input
              type="number"
              min="60"
              max="240"
              required
              value={bpSystolic}
              onChange={(e) => setBpSystolic(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Normal: {VITALS_RANGES.bp_systolic.min}–{VITALS_RANGES.bp_systolic.max} mmHg
            </p>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Diastolic BP (mmHg)
            </span>
            <input
              type="number"
              min="40"
              max="150"
              required
              value={bpDiastolic}
              onChange={(e) => setBpDiastolic(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Normal: {VITALS_RANGES.bp_diastolic.min}–{VITALS_RANGES.bp_diastolic.max} mmHg
            </p>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Weight (kg)
            </span>
            <input
              type="number"
              step="0.1"
              min="20"
              max="200"
              required
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">Daily baseline</p>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <label className="flex-1 block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Caregiver Observation Note (Optional)
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., After morning tea, feeling comfortable"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Save Vitals</span>
          </button>
        </div>
      </form>

      {/* Vitals History Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3.5 px-5">Recorded</th>
                <th className="py-3.5 px-4 text-right">Temp (°F)</th>
                <th className="py-3.5 px-4 text-right">Blood Pressure</th>
                <th className="py-3.5 px-4 text-right">Weight (kg)</th>
                <th className="py-3.5 px-4">Assessment</th>
                <th className="py-3.5 px-4">Notes</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {vitals.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 px-5 text-center text-slate-500 dark:text-slate-400"
                  >
                    No vitals logged for {shareCode} yet. Add the first reading above.
                  </td>
                </tr>
              ) : (
                vitals.map((entry) => {
                  const status = assessVital(entry);
                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-5 text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                        {new Date(entry.recorded_at).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-data font-medium text-slate-900 dark:text-white">
                        {entry.temperature_f.toFixed(1)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-data font-medium text-slate-900 dark:text-white">
                        {entry.bp_systolic}/{entry.bp_diastolic}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-data font-medium text-slate-900 dark:text-white">
                        {entry.weight_kg.toFixed(1)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {status.elevated ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>{status.label}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>{status.label}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                        {entry.notes || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => void onDeleteVital(entry.id)}
                          aria-label="Delete vital entry"
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-red-700 dark:hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
