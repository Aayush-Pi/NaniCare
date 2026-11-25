import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  HeartPulse,
  Minus,
  Scale,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { VITALS_RANGES } from "../config";
import { TrendsResponse, VitalLogEntry } from "../types/api";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type PointShape = "circle" | "square" | "diamond";

interface ChartPoint {
  t: number;
  v: number;
}

interface ChartSeries {
  label: string;
  unit: string;
  shape: PointShape;
  dashed?: boolean;
  /** Tailwind stroke/fill classes so colors adapt to light & dark themes */
  strokeClass: string;
  fillClass: string;
  points: ChartPoint[];
  range?: { min: number; max: number };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const rawStep = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const step =
    (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(2)));
  }
  return ticks;
}

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function trendOf(points: ChartPoint[], threshold: number): "rising" | "falling" | "stable" | "none" {
  if (points.length < 2) return "none";
  const delta = points[points.length - 1].v - points[0].v;
  if (delta >= threshold) return "rising";
  if (delta <= -threshold) return "falling";
  return "stable";
}

function PointMarker({
  shape,
  x,
  y,
  className,
  outOfRange,
}: {
  shape: PointShape;
  x: number;
  y: number;
  className: string;
  outOfRange: boolean;
}) {
  const size = outOfRange ? 6 : 4.5;
  const cls = outOfRange
    ? "fill-red-700 dark:fill-red-400 stroke-white dark:stroke-slate-900"
    : `${className} stroke-white dark:stroke-slate-900`;

  if (shape === "square") {
    return (
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        className={cls}
        strokeWidth={2}
      />
    );
  }
  if (shape === "diamond") {
    return (
      <polygon
        points={`${x},${y - size - 1} ${x + size + 1},${y} ${x},${y + size + 1} ${x - size - 1},${y}`}
        className={cls}
        strokeWidth={2}
      />
    );
  }
  return <circle cx={x} cy={y} r={size} className={cls} strokeWidth={2} />;
}

function LegendSwatch({ series }: { series: ChartSeries }) {
  return (
    <svg width="28" height="14" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="7"
        x2="28"
        y2="7"
        className={series.strokeClass}
        strokeWidth={2.5}
        strokeDasharray={series.dashed ? "5 4" : undefined}
      />
      <PointMarker shape={series.shape} x={14} y={7} className={series.fillClass} outOfRange={false} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Line chart                                                          */
/* ------------------------------------------------------------------ */

function LineChart({
  series,
  height = 200,
  band,
  ariaLabel,
}: {
  series: ChartSeries[];
  height?: number;
  band?: { min: number; max: number };
  ariaLabel: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const margin = { top: 12, right: 14, bottom: 28, left: 40 };

  const allPoints = series.flatMap((s) => s.points);
  const hasData = allPoints.length > 0;

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (!hasData) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const ts = allPoints.map((p) => p.t);
    const vs = allPoints.map((p) => p.v);
    if (band) vs.push(band.min, band.max);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.15;
    return {
      xMin: Math.min(...ts),
      xMax: Math.max(...ts),
      yMin: lo - pad,
      yMax: hi + pad,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, band, hasData]);

  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const singleX = xMax === xMin;

  const sx = (t: number) =>
    margin.left + (singleX ? innerW / 2 : ((t - xMin) / (xMax - xMin)) * innerW);
  const sy = (v: number) => margin.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const ticks = niceTicks(yMin, yMax, 4);
  const xLabels = singleX
    ? [xMin]
    : [xMin, xMin + (xMax - xMin) / 2, xMax];

  return (
    <div ref={ref} className="w-full">
      {!hasData ? (
        <div
          className="flex items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400"
          style={{ height }}
        >
          No readings yet
        </div>
      ) : width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block overflow-visible"
        >
          {/* Normal range band */}
          {band && (
            <g>
              <rect
                x={margin.left}
                y={sy(band.max)}
                width={innerW}
                height={Math.max(0, sy(band.min) - sy(band.max))}
                className="fill-green-600/10 dark:fill-green-400/10"
              />
              <line
                x1={margin.left}
                x2={margin.left + innerW}
                y1={sy(band.max)}
                y2={sy(band.max)}
                className="stroke-green-700/60 dark:stroke-green-400/60"
                strokeDasharray="3 4"
              />
              <line
                x1={margin.left}
                x2={margin.left + innerW}
                y1={sy(band.min)}
                y2={sy(band.min)}
                className="stroke-green-700/60 dark:stroke-green-400/60"
                strokeDasharray="3 4"
              />
            </g>
          )}

          {/* Grid + Y axis labels */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + innerW}
                y1={sy(tick)}
                y2={sy(tick)}
                className="stroke-slate-200 dark:stroke-slate-800"
              />
              <text
                x={margin.left - 8}
                y={sy(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-600 dark:fill-slate-400 text-[11px] tabular-nums"
              >
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {xLabels.map((t, i) => (
            <text
              key={`${t}-${i}`}
              x={sx(t)}
              y={height - 8}
              textAnchor={singleX ? "middle" : i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
              className="fill-slate-600 dark:fill-slate-400 text-[11px]"
            >
              {formatDay(t)}
            </text>
          ))}

          {/* Series lines + points */}
          {series.map((s) => {
            const path = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`)
              .join(" ");
            return (
              <g key={s.label}>
                {s.points.length > 1 && (
                  <path
                    d={path}
                    fill="none"
                    className={s.strokeClass}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? "6 5" : undefined}
                  />
                )}
                {s.points.map((p) => (
                  <PointMarker
                    key={`${s.label}-${p.t}`}
                    shape={s.shape}
                    x={sx(p.t)}
                    y={sy(p.v)}
                    className={s.fillClass}
                    outOfRange={
                      !!s.range && (p.v > s.range.max || p.v < s.range.min)
                    }
                  />
                ))}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart card shell                                                    */
/* ------------------------------------------------------------------ */

function TrendBadge({ trend }: { trend: ReturnType<typeof trendOf> }) {
  if (trend === "none") return null;
  const Icon = trend === "rising" ? TrendingUp : trend === "falling" ? TrendingDown : Minus;
  const label = trend === "rising" ? "Rising" : trend === "falling" ? "Falling" : "Stable";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function ChartCard({
  title,
  icon,
  latest,
  trend,
  series,
  children,
}: {
  title: string;
  icon: ReactNode;
  latest: string;
  trend?: ReturnType<typeof trendOf>;
  series: ChartSeries[];
  children: ReactNode;
}) {
  const rows = useMemo(() => {
    const byTime = new Map<number, Record<string, number>>();
    for (const s of series) {
      for (const p of s.points) {
        const row = byTime.get(p.t) || {};
        row[s.label] = p.v;
        byTime.set(p.t, row);
      }
    }
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  }, [series]);

  return (
    <figure className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3 m-0">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-center shrink-0">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</p>
            <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums leading-tight">
              {latest}
            </p>
          </div>
        </div>
        {trend && <TrendBadge trend={trend} />}
      </figcaption>

      {children}

      {series.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-700 dark:text-slate-300">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <LegendSwatch series={s} />
              <span>{s.label}</span>
            </span>
          ))}
          {series.some((s) => s.range) && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-4 h-3 border border-dashed border-green-700 dark:border-green-400 bg-green-600/10"
              />
              <span>Normal range</span>
            </span>
          )}
          {series.some((s) => s.range) && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="5" className="fill-red-700 dark:fill-red-400" />
              </svg>
              <span>Out of range</span>
            </span>
          )}
        </div>
      )}

      {/* Screen-reader data table (WCAG 1.1.1 text alternative for the chart) */}
      <table className="sr-only">
        <caption>{title} readings</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label} ({s.unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([t, row]) => (
            <tr key={t}>
              <th scope="row">{new Date(t).toLocaleString("en-IN")}</th>
              {series.map((s) => (
                <td key={s.label}>{row[s.label] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Adherence bar chart                                                 */
/* ------------------------------------------------------------------ */

function AdherenceBars({
  points,
}: {
  points: Array<{ label: string; percent: number; taken: number; total: number }>;
}) {
  return (
    <div>
      <div className="flex items-end gap-1.5 sm:gap-2 h-40" role="img" aria-label="Daily medicine adherence for the last days">
        {points.map((p) => {
          const tone =
            p.percent >= 80
              ? "bg-green-700 dark:bg-green-500"
              : p.percent >= 50
              ? "bg-amber-500 dark:bg-amber-400"
              : "bg-red-700 dark:bg-red-500";
          return (
            <div key={p.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-0">
              <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {Math.round(p.percent)}%
              </span>
              <div
                className={`w-full max-w-10 rounded-t-sm ${tone}`}
                style={{ height: `${Math.max(3, p.percent)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 sm:gap-2 mt-1.5 border-t border-slate-300 dark:border-slate-700 pt-1.5">
        {points.map((p) => (
          <span
            key={p.label}
            className="flex-1 text-center text-[11px] text-slate-600 dark:text-slate-400 truncate"
          >
            {p.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Daily medicine adherence</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Doses taken</th>
            <th scope="col">Percent</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>
                {p.taken} of {p.total}
              </td>
              <td>{Math.round(p.percent)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

interface VitalsChartsProps {
  vitals: VitalLogEntry[];
  trends: TrendsResponse | null;
  todayAdherence?: { taken: number; total: number; percent: number };
}

export function VitalsCharts({ vitals, trends, todayAdherence }: VitalsChartsProps) {
  const ordered = useMemo(
    () =>
      [...vitals]
        .map((v) => ({ ...v, t: new Date(v.recorded_at).getTime() }))
        .filter((v) => Number.isFinite(v.t))
        .sort((a, b) => a.t - b.t)
        .slice(-14),
    [vitals]
  );

  const bpSeries: ChartSeries[] = [
    {
      label: "Systolic",
      unit: "mmHg",
      shape: "circle",
      strokeClass: "stroke-blue-700 dark:stroke-blue-400",
      fillClass: "fill-blue-700 dark:fill-blue-400",
      points: ordered.map((v) => ({ t: v.t, v: v.bp_systolic })),
      range: VITALS_RANGES.bp_systolic,
    },
    {
      label: "Diastolic",
      unit: "mmHg",
      shape: "square",
      dashed: true,
      strokeClass: "stroke-violet-700 dark:stroke-violet-400",
      fillClass: "fill-violet-700 dark:fill-violet-400",
      points: ordered.map((v) => ({ t: v.t, v: v.bp_diastolic })),
      range: VITALS_RANGES.bp_diastolic,
    },
  ];

  const tempSeries: ChartSeries[] = [
    {
      label: "Temperature",
      unit: "°F",
      shape: "circle",
      strokeClass: "stroke-orange-700 dark:stroke-orange-400",
      fillClass: "fill-orange-700 dark:fill-orange-400",
      points: ordered.map((v) => ({ t: v.t, v: v.temperature_f })),
      range: VITALS_RANGES.temperature_f,
    },
  ];

  const weightSeries: ChartSeries[] = [
    {
      label: "Weight",
      unit: "kg",
      shape: "diamond",
      strokeClass: "stroke-teal-700 dark:stroke-teal-400",
      fillClass: "fill-teal-700 dark:fill-teal-400",
      points: ordered.map((v) => ({ t: v.t, v: v.weight_kg })),
    },
  ];

  const latest = ordered[ordered.length - 1];

  const adherencePoints = trends?.daily_adherence?.length
    ? trends.daily_adherence.map((d) => ({
        label: new Date(d.date).toLocaleDateString("en-IN", { weekday: "short" }),
        percent: d.adherence_percent,
        taken: d.taken,
        total: d.total,
      }))
    : todayAdherence
    ? [
        {
          label: "Today",
          percent: todayAdherence.percent,
          taken: todayAdherence.taken,
          total: todayAdherence.total,
        },
      ]
    : [];

  const avgAdherence = trends
    ? `${Math.round(trends.average_adherence_percent)}% avg`
    : todayAdherence
    ? `${todayAdherence.percent}% today`
    : "—";

  return (
    <section aria-labelledby="vitals-trends-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2
          id="vitals-trends-heading"
          className="text-lg font-bold text-slate-950 dark:text-white"
        >
          Trends
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Last {ordered.length || 0} readings · {trends?.days ?? 7}-day adherence
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Blood Pressure"
          icon={<HeartPulse className="w-5 h-5" aria-hidden="true" />}
          latest={latest ? `${latest.bp_systolic}/${latest.bp_diastolic} mmHg` : "—"}
          trend={trendOf(bpSeries[0].points, 8)}
          series={bpSeries}
        >
          <LineChart series={bpSeries} ariaLabel="Blood pressure trend chart" />
        </ChartCard>

        <ChartCard
          title="Temperature"
          icon={<Thermometer className="w-5 h-5" aria-hidden="true" />}
          latest={latest ? `${latest.temperature_f.toFixed(1)} °F` : "—"}
          trend={trendOf(tempSeries[0].points, 0.8)}
          series={tempSeries}
        >
          <LineChart
            series={tempSeries}
            band={VITALS_RANGES.temperature_f}
            ariaLabel="Body temperature trend chart"
          />
        </ChartCard>

        <ChartCard
          title="Weight"
          icon={<Scale className="w-5 h-5" aria-hidden="true" />}
          latest={latest ? `${latest.weight_kg.toFixed(1)} kg` : "—"}
          trend={trendOf(weightSeries[0].points, 0.5)}
          series={weightSeries}
        >
          <LineChart series={weightSeries} ariaLabel="Body weight trend chart" />
        </ChartCard>

        <figure className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3 m-0">
          <figcaption className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-center shrink-0">
              <CalendarCheck className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Medicine Adherence
              </p>
              <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums leading-tight">
                {avgAdherence}
              </p>
            </div>
          </figcaption>
          {adherencePoints.length > 0 ? (
            <AdherenceBars points={adherencePoints} />
          ) : (
            <div className="h-40 flex items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400">
              No dose history yet
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-green-700 dark:bg-green-500" aria-hidden="true" />
              80% or more
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
              50–79%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-red-700 dark:bg-red-500" aria-hidden="true" />
              Below 50%
            </span>
          </div>
        </figure>
      </div>
    </section>
  );
}
