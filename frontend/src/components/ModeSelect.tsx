import {
  ArrowRight,
  CheckCircle2,
  Mic,
  Moon,
  PhoneCall,
  ScanLine,
  ShieldCheck,
  Sun,
  Volume2,
} from "lucide-react";
import { GENERATED_ASSETS } from "../config";
import { AppRoute, ThemeMode, VerifiedMedicine, VitalLogEntry } from "../types/api";
import { StripImage } from "./StripImage";

interface ModeSelectProps {
  shareCode: string;
  onSelectRoute: (route: AppRoute) => void;
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  verifiedMedicines: VerifiedMedicine[];
  vitals: VitalLogEntry[];
}

export function ModeSelect({
  shareCode,
  onSelectRoute,
  theme,
  onSetTheme,
  verifiedMedicines,
  vitals,
}: ModeSelectProps) {
  const totalDosesToday = verifiedMedicines.reduce(
    (sum, med) => sum + med.slots.length,
    0
  );
  const takenDosesToday = verifiedMedicines.reduce(
    (sum, med) => sum + med.taken_slots_today.length,
    0
  );
  const latestVital = vitals[0];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 space-y-10">
      {/* Intro & Light/Dark Background Theme Selector */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-slate-200 dark:border-slate-800 pb-8">
        <div className="max-w-2xl space-y-3">
          <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">
            Family Medication Safety Companion · Profile {shareCode}
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            Choose who is using NaniCare right now
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            Caregivers scan prescriptions with Low, Medium, or High AI accuracy checks and
            confirm dosages manually. Grandparents receive a high-contrast, voice-first view
            that reads only verified prescriptions.
          </p>
        </div>

        {/* Dedicated 2-Option Background Theme Control */}
        <div className="shrink-0 space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Background Theme
          </p>
          <div
            role="group"
            aria-label="Choose background theme"
            className="inline-flex items-center p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
          >
            <button
              type="button"
              onClick={() => onSetTheme("light")}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                theme === "light"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Sun className="w-4 h-4 text-amber-600" aria-hidden="true" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => onSetTheme("dark")}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                theme === "dark"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Moon className="w-4 h-4 text-teal-400" aria-hidden="true" />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>
      </section>

      {/* Two Primary Mode Selection Cards */}
      <section
        aria-label="Select application mode"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch"
      >
        {/* Option 1: Grandparents Mode (Nani) */}
        <div className="flex flex-col justify-between rounded-2xl border-2 border-slate-900 dark:border-slate-200 bg-white dark:bg-slate-900 p-6 sm:p-8 transition-transform duration-150 hover:-translate-y-0.5">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                  For Nani, Dada &amp; Elderly Parents
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white">
                  Grandparents Mode
                </h2>
              </div>
              <div className="w-12 h-12 rounded-xl bg-teal-700 dark:bg-teal-500 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
                <Volume2 className="w-6 h-6" aria-hidden="true" />
              </div>
            </div>

            <p className="text-base text-slate-700 dark:text-slate-200 leading-relaxed">
              High-contrast large buttons, share-code login-free access, actual pill-strip photos,
              voice commands, and 1-tap emergency calling. Voiceover reads only prescriptions
              verified by the caregiver.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripParacetamol}
                  alt="Paracetamol 650mg blister strip"
                  title="Paracetamol 650mg"
                  className="w-full h-full"
                />
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripAtorvastatin}
                  alt="Metaglyp 10mg round tablet strip"
                  title="Metaglyp 10mg"
                  className="w-full h-full"
                />
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripCapsule}
                  alt="Neurosyn capsule blister strip"
                  title="Neurosyn 200mg"
                  className="w-full h-full"
                />
              </div>
            </div>

            <ul className="space-y-2.5 text-sm sm:text-base text-slate-800 dark:text-slate-200">
              <li className="flex items-center gap-2.5">
                <Volume2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>Hindi, Marathi &amp; English voiceover of verified prescriptions</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Mic className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>Voice recognition commands (&ldquo;Morning&rdquo;, &ldquo;Taken&rdquo;, &ldquo;Help&rdquo;)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <PhoneCall className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>Large high-contrast emergency call &amp; WhatsApp SOS button</span>
              </li>
            </ul>
          </div>

          <div className="pt-8">
            <button
              type="button"
              onClick={() => onSelectRoute("nani")}
              className="w-full min-h-[60px] px-6 py-4 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 font-display text-lg font-bold flex items-center justify-between gap-4 transition-colors cursor-pointer"
            >
              <span>Open Grandparents Mode</span>
              <ArrowRight className="w-5 h-5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Option 2: Caregiver Mode */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-8 transition-transform duration-150 hover:-translate-y-0.5">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                  For Sons, Daughters &amp; Family Caregivers
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
                  Caregiver Mode
                </h2>
              </div>
              <div className="w-12 h-12 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
                <ScanLine className="w-6 h-6" aria-hidden="true" />
              </div>
            </div>

            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              Scan prescriptions or physical blister strips, inspect Low / Medium / High AI
              accuracy flags highlighted in yellow, manually verify every dosage, and share daily
              vitals summaries via WhatsApp.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4">
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 aspect-[3/4] max-h-36 mx-auto sm:mx-0">
                <StripImage
                  src={GENERATED_ASSETS.samplePrescription}
                  alt="Sample printed clinic prescription"
                  title="Sample Rx"
                  className="w-full h-full"
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  2-Step Safety Verification Gate
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Step 1: AI rates each medicine Low, Medium, or High accuracy.
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Step 2: Caregiver manually confirms dosage &amp; strip photo before publishing.
                </p>
              </div>
            </div>

            <ul className="space-y-2.5 text-sm sm:text-base text-slate-700 dark:text-slate-200">
              <li className="flex items-center gap-2.5">
                <ScanLine className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>POST /scan prescription &amp; medicine strip analyzer</span>
              </li>
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span>Yellow review gate + POST /medicines/confirm caregiver lock</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Vitals logging (Temp, BP, Weight) &amp; 1-tap WhatsApp summary</span>
              </li>
            </ul>
          </div>

          <div className="pt-8">
            <button
              type="button"
              onClick={() => onSelectRoute("caregiver")}
              className="w-full min-h-[60px] px-6 py-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950 font-display text-lg font-bold flex items-center justify-between gap-4 transition-colors cursor-pointer"
            >
              <span>Open Caregiver Mode</span>
              <ArrowRight className="w-5 h-5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* Full-Width 4-Column Quiet Status Strip */}
      <section
        aria-label="Current care status"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-200 dark:border-slate-800 pt-8"
      >
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Verified Prescriptions
          </p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {verifiedMedicines.length} active
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Unlocked for voiceover
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Today&apos;s Adherence
          </p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {takenDosesToday} / {totalDosesToday} doses
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Morning, afternoon &amp; night
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Latest Blood Pressure
          </p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {latestVital
              ? `${latestVital.bp_systolic}/${latestVital.bp_diastolic}`
              : "--/--"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {latestVital
              ? `Temp ${latestVital.temperature_f.toFixed(1)} °F`
              : "No vitals logged"}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Voice Languages Ready
          </p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            EN · हिं · मरा
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            English, Hindi &amp; Marathi
          </p>
        </div>
      </section>
    </main>
  );
}
