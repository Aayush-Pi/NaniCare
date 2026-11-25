import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { VitalsLogger } from "../../components/VitalsLogger";
import { WhatsAppSummaryCard } from "../../components/WhatsAppSummaryCard";
import {
  deleteVitalEntry,
  fetchProfileSummary,
  logVital,
} from "../../lib/api";
import { CreateVitalRequest, ProfileSummaryResponse } from "../../types/api";

interface VitalsPageProps {
  shareCode: string;
  onChangeShareCode: (code: string) => void;
  onBackToCaregiver: () => void;
  onVitalsMutated: () => Promise<void>;
}

export function VitalsPage({
  shareCode,
  onChangeShareCode,
  onBackToCaregiver,
  onVitalsMutated,
}: VitalsPageProps) {
  const [summary, setSummary] = useState<ProfileSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const data = await fetchProfileSummary(shareCode);
      setSummary(data);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not load vitals summary."
      );
    } finally {
      setIsLoading(false);
    }
  }, [shareCode]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function handleLogVital(payload: CreateVitalRequest) {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await logVital(payload);
      await loadSummary();
      await onVitalsMutated();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save vital.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteVital(id: string) {
    await deleteVitalEntry(id);
    await loadSummary();
    await onVitalsMutated();
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onBackToCaregiver}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Caregiver Mode</span>
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            Vitals Tracker &amp; WhatsApp Summary
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Log Temperature (°F), Blood Pressure, and Weight via POST /vitals, and share the
            live daily report from GET /profile/{shareCode}/summary in one tap.
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
          <span>Share Code:</span>
          <input
            type="text"
            value={shareCode}
            onChange={(e) => onChangeShareCode(e.target.value.toUpperCase())}
            maxLength={12}
            className="w-28 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono-data text-sm uppercase"
          />
        </label>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-900 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        <div className="xl:col-span-7">
          <VitalsLogger
            shareCode={shareCode}
            vitals={summary?.vitals || []}
            isSubmitting={isSubmitting}
            onLogVital={handleLogVital}
            onDeleteVital={handleDeleteVital}
          />
        </div>

        <div className="xl:col-span-5">
          <WhatsAppSummaryCard
            summary={summary}
            isLoading={isLoading}
            onRefresh={() => void loadSummary()}
          />
        </div>
      </div>
    </main>
  );
}
