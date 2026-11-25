import { useState } from "react";
import { Check, Copy, MessageCircle, RefreshCw } from "lucide-react";
import { ProfileSummaryResponse } from "../types/api";

interface WhatsAppSummaryCardProps {
  summary: ProfileSummaryResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function WhatsAppSummaryCard({
  summary,
  isLoading,
  onRefresh,
}: WhatsAppSummaryCardProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyText() {
    if (!summary?.summary_text) return;
    try {
      await navigator.clipboard.writeText(summary.summary_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures cleanly
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            GET /profile/{summary?.share_code || "DEMO01"}/summary
          </p>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Daily Family WhatsApp Report
          </h2>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>Refresh Summary</span>
        </button>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Adherence</p>
              <p className="font-display text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                {summary.adherence_taken}/{summary.adherence_total} ({summary.adherence_percent}%)
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Verified Meds</p>
              <p className="font-display text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                {summary.medicines.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Vitals Logged</p>
              <p className="font-display text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                {summary.vitals.length}
              </p>
            </div>
          </div>

          <pre className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono-data leading-relaxed overflow-x-auto">
            {summary.summary_text}
          </pre>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={summary.whatsapp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold transition-colors whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              <span>Share on WhatsApp (wa.me)</span>
            </a>

            <button
              type="button"
              onClick={() => void handleCopyText()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" aria-hidden="true" />
                  <span>Copy Report Text</span>
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Loading daily family summary...
        </p>
      )}
    </section>
  );
}
