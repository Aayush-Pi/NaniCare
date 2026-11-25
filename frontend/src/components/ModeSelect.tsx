import { FormEvent, useState } from "react";
import {
  Activity,
  ArrowRight,
  KeyRound,
  Pill,
  ScanLine,
  UserPlus,
} from "lucide-react";
import { DEFAULT_SHARE_CODE } from "../config";
import { createProfile } from "../lib/api";
import {
  AppRoute,
  LanguageCode,
  VerifiedMedicine,
  VitalLogEntry,
} from "../types/api";

interface ModeSelectProps {
  shareCode: string;
  patientName: string;
  onChangeShareCode: (code: string) => void;
  onChangeLanguage: (lang: LanguageCode) => void;
  onSelectRoute: (route: AppRoute) => void;
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

  const totalDosesToday = verifiedMedicines.reduce((sum, med) => sum + med.slots.length, 0);
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
      setProfileNotice(`Profile ready for ${created.elder_name} (${created.share_code}).`);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Could not create profile.");
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
    setProfileNotice(`Switched to profile ${cleaned}.`);
  }

  function handleUseDemoProfile() {
    onChangeShareCode(DEFAULT_SHARE_CODE);
    setProfileError("");
    setProfileNotice(`Loaded demo profile ${DEFAULT_SHARE_CODE} (Kamla Sharma).`);
  }

  return (
    <main
      id="main-content"
      className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-24 md:pb-12 space-y-6"
    >
      {/* Clean Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white">
            Medication &amp; Care Workspace
          </h1>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Active profile:{" "}
            <strong className="text-slate-950 dark:text-white">{patientName}</strong>{" "}
            <span className="font-mono-data text-blue-800 dark:text-blue-300 font-semibold">
              ({shareCode})
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleUseDemoProfile}
          className="self-start sm:self-auto min-h-[44px] px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          Use Demo Profile ({DEFAULT_SHARE_CODE})
        </button>
      </header>

      {/* Primary Mode Launchers */}
      <section aria-label="Choose mode" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <article className="rounded-lg border-2 border-blue-700 dark:border-blue-500 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white">
                Grandparents Mode
              </h2>
              <span className="w-10 h-10 rounded-md bg-blue-700 text-white flex items-center justify-center shrink-0">
                <Pill className="w-5 h-5 -rotate-45" aria-hidden="true" />
              </span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              Simplified Assistive Access–style home screen with oversized tiles, visual cues,
              voice guidance in English/Hindi/Marathi, green taken buttons, pill-strip camera
              check, and 1-tap family calling.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onSelectRoute("nani")}
            className="w-full min-h-[52px] px-4 py-3 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-semibold text-base flex items-center justify-between gap-3 transition-colors cursor-pointer"
          >
            <span>Open Grandparents Mode</span>
            <ArrowRight className="w-5 h-5 shrink-0" aria-hidden="true" />
          </button>
        </article>

        <article className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white">
                Caregiver Mode
              </h2>
              <span className="w-10 h-10 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
                <ScanLine className="w-5 h-5" aria-hidden="true" />
              </span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              Scan prescriptions or medicine strips, verify flagged dosages before publishing to
              Grandparents Mode, manage emergency contacts, and review vitals graphs and refills.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onSelectRoute("caregiver")}
              className="min-h-[52px] px-4 py-3 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950 font-semibold text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer"
            >
              <span>Prescriptions</span>
              <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onSelectRoute("vitals")}
              className="min-h-[52px] px-4 py-3 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-semibold text-sm flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span>Vitals &amp; Graphs</span>
              <Activity className="w-4 h-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            </button>
          </div>
        </article>
      </section>

      {/* Current Profile Status Strip */}
      <section
        aria-label="Current care status"
        className="grid grid-cols-2 sm:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800"
      >
        <div className="p-4">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Active Medicines</p>
          <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
            {verifiedMedicines.length}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Taken Today</p>
          <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
            {takenDosesToday} / {totalDosesToday}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Latest BP</p>
          <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
            {latestVital ? `${latestVital.bp_systolic}/${latestVital.bp_diastolic}` : "—"}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Latest Temp</p>
          <p className="text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
            {latestVital ? `${latestVital.temperature_f.toFixed(1)} °F` : "—"}
          </p>
        </div>
      </section>

      {/* Quick Profile Setup & Existing Code Loader */}
      <section
        aria-labelledby="quick-profile-heading"
        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2
            id="quick-profile-heading"
            className="flex items-center gap-2 text-sm font-bold text-slate-950 dark:text-white"
          >
            <UserPlus className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>Create or Switch Family Profile</span>
          </h2>

          <form onSubmit={handleLoadExistingCode} className="flex items-center gap-2 w-full sm:w-auto">
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
                placeholder="Share code"
                maxLength={12}
                className="w-full sm:w-36 min-h-[40px] pl-8 pr-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white font-mono-data text-xs uppercase"
              />
            </div>
            <button
              type="submit"
              className="min-h-[40px] px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              Load
            </button>
          </form>
        </div>

        <form
          onSubmit={(e) => void handleQuickCreateProfile(e)}
          className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 items-end"
        >
          <div className="lg:col-span-3 space-y-1">
            <label
              htmlFor="quick-elder-name"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Elder&apos;s Name *
            </label>
            <input
              id="quick-elder-name"
              type="text"
              required
              placeholder="e.g. Kamla Sharma"
              value={elderName}
              onChange={(e) => setElderName(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm"
            />
          </div>

          <div className="lg:col-span-2 space-y-1">
            <label
              htmlFor="quick-language"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Language
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
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Caregiver Phone
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
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Custom Code
            </label>
            <input
              id="quick-code"
              type="text"
              maxLength={12}
              placeholder="Auto"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-950 dark:text-white text-sm font-mono-data uppercase"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={isCreating}
              className="w-full min-h-[44px] px-4 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        </form>

        {(profileNotice || profileError) && (
          <div className="px-4 sm:px-5 pb-4">
            {profileNotice && (
              <p
                role="status"
                aria-live="polite"
                className="px-3.5 py-2.5 rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-xs sm:text-sm font-semibold text-green-900 dark:text-green-200"
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
    </main>
  );
}
