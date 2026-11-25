import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, Pill } from "lucide-react";
import { VitalsCharts } from "../../components/VitalsCharts";
import { VitalsLogger } from "../../components/VitalsLogger";
import { WhatsAppSummaryCard } from "../../components/WhatsAppSummaryCard";
import {
  deleteVitalEntry,
  fetchProfileSummary,
  fetchRefills,
  fetchTrends,
  logVital,
} from "../../lib/api";
import {
  CreateVitalRequest,
  ProfileSummaryResponse,
  RefillStatusItem,
  TrendsResponse,
} from "../../types/api";

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
  const [refills, setRefills] = useState<RefillStatusItem[]>([]);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [data, refillList, trendData] = await Promise.all([
        fetchProfileSummary(shareCode),
        fetchRefills(shareCode).catch(() => []),
        fetchTrends(shareCode, 7).catch(() => null),
      ]);
      setSummary(data);
      setRefills(refillList);
      setTrends(trendData);
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
    <main
      id="main-content"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 md:pb-12 space-y-6 sm:space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onBackToCaregiver}
            className="inline-flex items-center gap-1.5 min-h-[36px] text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Caregiver Mode</span>
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            Vitals Tracker, Refills &amp; Family Report
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Track daily temperature, blood pressure, and weight, check medicine refill
            dates, and share the daily WhatsApp summary in one tap.
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 shrink-0">
          <span>Share Code:</span>
          <input
            type="text"
            value={shareCode}
            onChange={(e) => onChangeShareCode(e.target.value.toUpperCase())}
            maxLength={12}
            className="w-28 min-h-[44px] px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono-data text-sm uppercase"
          />
        </label>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-900 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      <VitalsCharts
        vitals={summary?.vitals || []}
        trends={trends}
        todayAdherence={
          summary
            ? {
                taken: summary.adherence_taken,
                total: summary.adherence_total,
                percent: summary.adherence_percent,
              }
            : undefined
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7">
          <VitalsLogger
            shareCode={shareCode}
            vitals={summary?.vitals || []}
            isSubmitting={isSubmitting}
            onLogVital={handleLogVital}
            onDeleteVital={handleDeleteVital}
          />
        </div>

        <div className="xl:col-span-5 space-y-6">
          <WhatsAppSummaryCard
            summary={summary}
            isLoading={isLoading}
            onRefresh={() => void loadSummary()}
          />

          {/* Refill Countdown Panel */}
          {refills.length > 0 && (
            <section
              aria-label="Medicine refill status"
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <CalendarClock
                    className="w-4 h-4 text-teal-700 dark:text-teal-400"
                    aria-hidden="true"
                  />
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Medicine Refill Tracker
                  </h2>
                </div>
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                  {refills.length} tracked
                </span>
              </div>

              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {refills.map((item) => {
                  const daysLeft = item.days_remaining ?? null;
                  return (
                    <li
                      key={item.medicine_id}
                      className="py-2.5 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                          <Pill
                            className="w-3.5 h-3.5 text-slate-400 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {item.brand_name}
                            {item.strength ? ` ${item.strength}` : ""}
                          </span>
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {item.message_en ||
                            (item.duration_days ? `${item.duration_days}-day course` : "Ongoing")}
                        </p>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-sm text-xs font-bold whitespace-nowrap shrink-0 tabular-nums ${
                          item.status === "completed"
                            ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                            : item.status === "refill_soon"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {daysLeft === null
                          ? "Ongoing"
                          : daysLeft <= 0
                          ? "Refill now"
                          : `${daysLeft}d left`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
