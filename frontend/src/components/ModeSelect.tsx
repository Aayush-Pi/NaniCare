import { FormEvent, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Mic,
  PhoneCall,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Volume2,
} from "lucide-react";
import { DEFAULT_SHARE_CODE, GENERATED_ASSETS } from "../config";
import { createProfile } from "../lib/api";
import {
  AppRoute,
  LanguageCode,
  ThemeMode,
  VerifiedMedicine,
  VitalLogEntry,
} from "../types/api";
import { StripImage } from "./StripImage";

interface ModeSelectProps {
  shareCode: string;
  patientName: string;
  onChangeShareCode: (code: string) => void;
  onChangeLanguage: (lang: LanguageCode) => void;
  onSelectRoute: (route: AppRoute) => void;
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  verifiedMedicines: VerifiedMedicine[];
  vitals: VitalLogEntry[];
}

export function ModeSelect({
  shareCode,
  patientName,
  onChangeShareCode,
  onChangeLanguage,
  onSelectRoute,
  verifiedMedicines,
  vitals,
}: ModeSelectProps) {
  const [elderName, setElderName] = useState("");
  const [preferredLang, setPreferredLang] = useState<LanguageCode>("hi");
  const [caregiverPhone, setCaregiverPhone] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [existingCodeInput, setExistingCodeInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");

  const totalDosesToday = verifiedMedicines.reduce(
    (sum, med) => sum + med.slots.length,
    0
  );
  const takenDosesToday = verifiedMedicines.reduce(
    (sum, med) => sum + med.taken_slots_today.length,
    0
  );
  const latestVital = vitals[0];

  async function handleQuickCreateProfile(event: FormEvent) {
    event.preventDefault();
    if (!elderName.trim()) return;
    setIsCreating(true);
    setProfileError("");
    setProfileNotice("");
    try {
      const created = await createProfile({
        elder_name: elderName.trim(),
        preferred_language: preferredLang,
        caregiver_phone: caregiverPhone.trim() || undefined,
        share_code: customCode.trim() || undefined,
      });
      onChangeLanguage(preferredLang);
      onChangeShareCode(created.share_code);
      setElderName("");
      setCaregiverPhone("");
      setCustomCode("");
      setProfileNotice(
        `Profile ready for ${created.elder_name}. Share Code: ${created.share_code}`
      );
    } catch (err: unknown) {
      setProfileError(
        err instanceof Error ? err.message : "Could not create profile."
      );
    } finally {
      setIsCreating(false);
    }
  }

  function handleLoadExistingCode(event: FormEvent) {
    event.preventDefault();
    const cleaned = existingCodeInput.trim().toUpperCase();
    if (!cleaned) return;
    onChangeShareCode(cleaned);
    setExistingCodeInput("");
    setProfileError("");
    setProfileNotice(`Loaded family profile ${cleaned}.`);
  }

  function handleUseDemoProfile() {
    onChangeShareCode(DEFAULT_SHARE_CODE);
    setProfileError("");
    setProfileNotice(`Loaded demo profile ${DEFAULT_SHARE_CODE} (Kamla Nani).`);
  }

  return (
    <main
      id="main-content"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-24 md:pb-12 space-y-8"
    >
      {/* Structured Header */}
      <section className="border-b border-slate-300 dark:border-slate-800 pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300">
            Family Medication Safety Companion
          </p>
          <h1 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white leading-tight">
            Clear daily medication guidance for elders &amp; caregivers
          </h1>
          <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed">
            Set up a family profile below or load the sample profile, then choose Grandparents Mode
            for voice-guided medicine tracking or Caregiver Mode for prescription scanning.
          </p>
        </div>

        {/* Active Profile Pill & Compact Demo Profile Switch */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm">
            <span className="text-slate-600 dark:text-slate-400">Active: </span>
            <span className="font-bold text-slate-950 dark:text-white">{patientName}</span>
            <span className="ml-2 font-mono-data font-bold text-teal-800 dark:text-teal-300">
              {shareCode}
            </span>
          </div>
          <button
            type="button"
            onClick={handleUseDemoProfile}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-md border border-teal-700 dark:border-teal-400 bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200 text-xs sm:text-sm font-bold hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Demo Profile ({DEFAULT_SHARE_CODE})</span>
          </button>
        </div>
      </section>

      {/* Quick Profile Maker + Existing Code Loader */}
      <section
        aria-labelledby="quick-profile-heading"
        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <h2
              id="quick-profile-heading"
              className="font-display text-sm sm:text-base font-bold text-slate-950 dark:text-white"
            >
              Quick Family Profile Setup
            </h2>
          </div>

          <form
            onSubmit={handleLoadExistingCode}
            className="flex items-center gap-2 w-full sm:w-auto"
          >
            <label htmlFor="existing-share-code" className="sr-only">
              Enter existing share code
            </label>
            <div className="relative flex-1 sm:flex-initial">
              <KeyRound
                className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="existing-share-code"
                type="text"
                value={existingCodeInput}
                onChange={(e) => setExistingCodeInput(e.target.value.toUpperCase())}
                placeholder="Have a code?"
                maxLength={12}
                className="w-full sm:w-36 min-h-[40px] pl-8 pr-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white font-mono-data text-xs uppercase"
              />
            </div>
            <button
              type="submit"
              className="min-h-[40px] px-3 py-1.5 rounded-md border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              Load Code
            </button>
          </form>
        </div>

        <form
          onSubmit={(e) => void handleQuickCreateProfile(e)}
          className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end"
        >
          <div className="lg:col-span-3 space-y-1">
            <label
              htmlFor="quick-elder-name"
              className="block text-xs font-bold text-slate-800 dark:text-slate-200"
            >
              Elder&apos;s Name *
            </label>
            <input
              id="quick-elder-name"
              type="text"
              required
              placeholder="e.g. Sunita Nani"
              value={elderName}
              onChange={(e) => setElderName(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm"
            />
          </div>

          <div className="lg:col-span-2 space-y-1">
            <label
              htmlFor="quick-language"
              className="block text-xs font-bold text-slate-800 dark:text-slate-200"
            >
              Voice Language
            </label>
            <select
              id="quick-language"
              value={preferredLang}
              onChange={(e) => setPreferredLang(e.target.value as LanguageCode)}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm"
            >
              <option value="hi">Hindi (हिन्दी)</option>
              <option value="mr">Marathi (मराठी)</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="lg:col-span-3 space-y-1">
            <label
              htmlFor="quick-phone"
              className="block text-xs font-bold text-slate-800 dark:text-slate-200"
            >
              Caregiver Phone (Optional)
            </label>
            <input
              id="quick-phone"
              type="tel"
              placeholder="+91 98200 12345"
              value={caregiverPhone}
              onChange={(e) => setCaregiverPhone(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-mono-data"
            />
          </div>

          <div className="lg:col-span-2 space-y-1">
            <label
              htmlFor="quick-code"
              className="block text-xs font-bold text-slate-800 dark:text-slate-200"
            >
              Custom Code (Opt.)
            </label>
            <input
              id="quick-code"
              type="text"
              maxLength={12}
              placeholder="Auto 6-char"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-mono-data uppercase"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={isCreating}
              className="w-full min-h-[44px] px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isCreating ? "Creating..." : "Create Profile"}
            </button>
          </div>
        </form>

        {(profileNotice || profileError) && (
          <div className="px-5 pb-4">
            {profileNotice && (
              <p
                role="status"
                aria-live="polite"
                className="px-3.5 py-2.5 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs sm:text-sm font-semibold text-emerald-900 dark:text-emerald-200"
              >
                {profileNotice}
              </p>
            )}
            {profileError && (
              <p
                role="alert"
                className="px-3.5 py-2.5 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs sm:text-sm font-semibold text-red-900 dark:text-red-200"
              >
                {profileError}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Two Structured Mode Cards */}
      <section
        aria-label="Select application mode"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch"
      >
        {/* Grandparents Mode */}
        <article className="flex flex-col justify-between rounded-lg border-2 border-slate-900 dark:border-slate-300 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-800 dark:text-teal-300">
                  Accessible Elder View
                </p>
                <h2 className="font-display text-2xl font-extrabold text-slate-950 dark:text-white">
                  Grandparents Mode
                </h2>
              </div>
              <div className="w-11 h-11 rounded-md bg-teal-700 dark:bg-teal-500 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
                <Volume2 className="w-5 h-5" aria-hidden="true" />
              </div>
            </div>

            <p className="text-sm sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed">
              Adjustable text sizes, AAA high contrast, spoken instructions describing each
              pill&apos;s size, color, and strip, a live daily checklist with one-tap green
              &ldquo;Taken&rdquo; buttons, and 1-tap emergency calling.
            </p>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-md overflow-hidden border border-slate-300 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripParacetamol}
                  alt="Paracetamol 650mg blister strip"
                  title="Paracetamol 650mg"
                  className="w-full h-full"
                />
              </div>
              <div className="rounded-md overflow-hidden border border-slate-300 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripAtorvastatin}
                  alt="Atorvastatin blister strip"
                  title="Atorva 10mg"
                  className="w-full h-full"
                />
              </div>
              <div className="rounded-md overflow-hidden border border-slate-300 dark:border-slate-700 aspect-[4/3]">
                <StripImage
                  src={GENERATED_ASSETS.stripCapsule}
                  alt="Capsule blister strip"
                  title="Pan-D Capsule"
                  className="w-full h-full"
                />
              </div>
            </div>

            <ul className="space-y-2 text-sm text-slate-800 dark:text-slate-200">
              <li className="flex items-center gap-2.5">
                <Volume2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>Natural English, Hindi &amp; Marathi voice guidance with pill descriptions</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-400 shrink-0" aria-hidden="true" />
                <span>Big green &ldquo;Taken&rdquo; buttons that update today&apos;s dose table instantly</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Mic className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>Voice commands &amp; camera pill-strip safety check</span>
              </li>
              <li className="flex items-center gap-2.5">
                <PhoneCall className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>One-tap Emergency Call &amp; WhatsApp SOS</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onSelectRoute("nani")}
            className="w-full min-h-[56px] px-5 py-3.5 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 font-display text-base sm:text-lg font-bold flex items-center justify-between gap-4 transition-colors cursor-pointer"
          >
            <span>Open Grandparents Mode ({shareCode})</span>
            <ArrowRight className="w-5 h-5 shrink-0" aria-hidden="true" />
          </button>
        </article>

        {/* Caregiver Mode */}
        <article className="flex flex-col justify-between rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Family Caregiver Workspace
                </p>
                <h2 className="font-display text-2xl font-extrabold text-slate-950 dark:text-white">
                  Caregiver Mode
                </h2>
              </div>
              <div className="w-11 h-11 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
                <ScanLine className="w-5 h-5" aria-hidden="true" />
              </div>
            </div>

            <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed">
              Scan handwritten prescriptions or blister strips, review AI confidence flags and
              drug-interaction warnings, replace or append schedules, and track daily vitals and
              refills.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
              <div className="rounded-sm overflow-hidden border border-slate-300 dark:border-slate-700 aspect-[4/3] max-h-28 mx-auto sm:mx-0">
                <StripImage
                  src={GENERATED_ASSETS.samplePrescription}
                  alt="Sample printed clinic prescription"
                  title="Sample Prescription"
                  className="w-full h-full"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <p className="text-sm font-bold text-slate-950 dark:text-white">
                  2-Step Caregiver Verification Gate
                </p>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  Unclear handwriting is highlighted in amber and never reaches Grandparents Mode
                  until a caregiver confirms every dose.
                </p>
              </div>
            </div>

            <ul className="space-y-2 text-sm text-slate-800 dark:text-slate-200">
              <li className="flex items-center gap-2.5">
                <ScanLine className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                <span>Handwritten prescription &amp; medicine-strip AI extraction</span>
              </li>
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span>Allergy, duplicate-drug &amp; timing interaction safety checks</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Vitals monitoring, refill alerts &amp; 1-tap WhatsApp summary</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onSelectRoute("caregiver")}
            className="w-full min-h-[56px] px-5 py-3.5 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950 font-display text-base sm:text-lg font-bold flex items-center justify-between gap-4 transition-colors cursor-pointer"
          >
            <span>Open Caregiver Mode</span>
            <ArrowRight className="w-5 h-5 shrink-0" aria-hidden="true" />
          </button>
        </article>
      </section>

      {/* Structured 4-Column Summary Strip */}
      <section
        aria-label="Current care status"
        className="grid grid-cols-2 lg:grid-cols-4 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800"
      >
        <div className="p-4 sm:p-5 space-y-1">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Verified Medicines
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tabular-nums">
            {verifiedMedicines.length} active
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">Profile {shareCode}</p>
        </div>

        <div className="p-4 sm:p-5 space-y-1">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Today&apos;s Adherence
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tabular-nums">
            {takenDosesToday} / {totalDosesToday} doses
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">Morning, afternoon &amp; night</p>
        </div>

        <div className="p-4 sm:p-5 space-y-1">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Latest Blood Pressure
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tabular-nums">
            {latestVital
              ? `${latestVital.bp_systolic}/${latestVital.bp_diastolic}`
              : "--/--"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {latestVital ? `Temp ${latestVital.temperature_f.toFixed(1)} °F` : "No vitals logged"}
          </p>
        </div>

        <div className="p-4 sm:p-5 space-y-1">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Voice Languages
          </p>
          <p className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white">
            EN · हिं · मरा
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">Neural + browser speech</p>
        </div>
      </section>
    </main>
  );
}
