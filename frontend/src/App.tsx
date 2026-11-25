import { useCallback, useEffect, useState } from "react";
import { ModeSelect } from "./components/ModeSelect";
import { TopBar } from "./components/TopBar";
import { fetchProfileSummary, fetchSchedule, markDose } from "./lib/api";
import { CaregiverPage } from "./pages/caregiver";
import { NaniPage } from "./pages/nani";
import { VitalsPage } from "./pages/vitals";
import {
  AppRoute,
  EmergencyContact,
  LanguageCode,
  ThemeMode,
  TimeSlotKey,
  VerifiedMedicine,
  VitalLogEntry,
} from "./types/api";
import {
  loadEmergencyContact,
  loadLanguage,
  loadShareCode,
  loadTheme,
  loadVerifiedMedicines,
  loadVitals,
  saveEmergencyContact,
  saveLanguage,
  saveShareCode,
  saveTheme,
} from "./utils/storage";
import { stopSpeaking } from "./utils/tts";

export default function App() {
  const [route, setRoute] = useState<AppRoute>("select");
  const [shareCode, setShareCode] = useState<string>(() => loadShareCode());
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [language, setLanguage] = useState<LanguageCode>(() => loadLanguage());
  const [verifiedMedicines, setVerifiedMedicines] = useState<VerifiedMedicine[]>(
    () => loadVerifiedMedicines(loadShareCode())
  );
  const [vitals, setVitals] = useState<VitalLogEntry[]>(() =>
    loadVitals(loadShareCode())
  );
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>(() =>
    loadEmergencyContact()
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveLanguage(language);
  }, [language]);

  useEffect(() => {
    saveShareCode(shareCode);
  }, [shareCode]);

  const refreshProfileData = useCallback(async () => {
    try {
      const [schedule, summary] = await Promise.all([
        fetchSchedule(shareCode),
        fetchProfileSummary(shareCode),
      ]);
      setVerifiedMedicines(
        schedule.medicines.filter((m) => m.caregiver_verified === true)
      );
      setVitals(summary.vitals);
      if (schedule.emergency_contact) {
        setEmergencyContact(schedule.emergency_contact);
      }
    } catch {
      setVerifiedMedicines(loadVerifiedMedicines(shareCode));
      setVitals(loadVitals(shareCode));
    }
  }, [shareCode]);

  useEffect(() => {
    void refreshProfileData();
  }, [refreshProfileData]);

  function handleNavigate(nextRoute: AppRoute) {
    stopSpeaking();
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleToggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  async function handleMarkDose(
    medicineId: string,
    slot: TimeSlotKey,
    taken: boolean
  ) {
    await markDose({
      share_code: shareCode,
      medicine_id: medicineId,
      slot,
      taken,
    });
    await refreshProfileData();
  }

  function handleUpdateEmergencyContact(contact: EmergencyContact) {
    setEmergencyContact(contact);
    saveEmergencyContact(contact);
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        route={route}
        onNavigate={handleNavigate}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      <div className="flex-1">
        {route === "select" && (
          <ModeSelect
            shareCode={shareCode}
            onSelectRoute={handleNavigate}
            theme={theme}
            onSetTheme={setTheme}
            verifiedMedicines={verifiedMedicines}
            vitals={vitals}
          />
        )}

        {route === "caregiver" && (
          <CaregiverPage
            shareCode={shareCode}
            onChangeShareCode={setShareCode}
            verifiedMedicines={verifiedMedicines}
            emergencyContact={emergencyContact}
            language={language}
            onRefreshData={refreshProfileData}
            onMarkDose={handleMarkDose}
            onUpdateEmergencyContact={handleUpdateEmergencyContact}
            onNavigateNani={() => handleNavigate("nani")}
            onNavigateVitals={() => handleNavigate("vitals")}
          />
        )}

        {route === "nani" && (
          <NaniPage
            shareCode={shareCode}
            onChangeShareCode={setShareCode}
            verifiedMedicines={verifiedMedicines}
            emergencyContact={emergencyContact}
            language={language}
            onChangeLanguage={setLanguage}
            onMarkDose={handleMarkDose}
            onSwitchToCaregiver={() => handleNavigate("caregiver")}
          />
        )}

        {route === "vitals" && (
          <VitalsPage
            shareCode={shareCode}
            onChangeShareCode={setShareCode}
            onBackToCaregiver={() => handleNavigate("caregiver")}
            onVitalsMutated={refreshProfileData}
          />
        )}
      </div>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <p>
            NaniCare · Caregiver-verified prescription guidance. Always follow your doctor&apos;s
            medical advice.
          </p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleNavigate("nani")}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Grandparents Mode
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("caregiver")}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Caregiver Mode
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("vitals")}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Vitals
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
