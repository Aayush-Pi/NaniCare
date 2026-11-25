import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PhoneCall,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { PrescriptionScanner } from "../../components/PrescriptionScanner";
import { ReviewMedicineCard } from "../../components/ReviewMedicineCard";
import { StripImage } from "../../components/StripImage";
import { GENERATED_ASSETS } from "../../config";
import {
  confirmMedicines,
  createProfile,
  flushMedicines,
  listProfiles,
  removeVerifiedMedicine,
  resetDemoProfile,
  scanPrescription,
} from "../../lib/api";
import {
  EmergencyContact,
  LanguageCode,
  ProfileInfo,
  ScannedMedicineCandidate,
  TimeSlotKey,
  VerifiedMedicine,
} from "../../types/api";
import { getMedicineSpokenText, speakText, stopSpeaking } from "../../utils/tts";

type CaregiverSubTab = "scan" | "verified" | "emergency";

interface CaregiverPageProps {
  shareCode: string;
  onChangeShareCode: (code: string) => void;
  verifiedMedicines: VerifiedMedicine[];
  emergencyContact: EmergencyContact;
  language: LanguageCode;
  onRefreshData: () => Promise<void>;
  onMarkDose: (medicineId: string, slot: TimeSlotKey, taken: boolean) => Promise<void>;
  onUpdateEmergencyContact: (contact: EmergencyContact) => void;
  onNavigateNani: () => void;
  onNavigateVitals: () => void;
}

async function fetchUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load sample image.");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve({ base64: reader.result, mimeType: blob.type || "image/jpeg" });
      } else {
        reject(new Error("Failed to read sample image."));
      }
    };
    reader.onerror = () => reject(new Error("Could not encode sample image."));
    reader.readAsDataURL(blob);
  });
}

export function CaregiverPage({
  shareCode,
  onChangeShareCode,
  verifiedMedicines,
  emergencyContact,
  language,
  onRefreshData,
  onMarkDose,
  onUpdateEmergencyContact,
  onNavigateNani,
  onNavigateVitals,
}: CaregiverPageProps) {
  const [activeTab, setActiveTab] = useState<CaregiverSubTab>("scan");
  const [previewImage, setPreviewImage] = useState("");
  const [scanLabel, setScanLabel] = useState("");
  const [doctorOrClinic, setDoctorOrClinic] = useState("");
  const [generalWarning, setGeneralWarning] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [drafts, setDrafts] = useState<ScannedMedicineCandidate[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [saveMode, setSaveMode] = useState<"replace" | "append">("replace");
  const [isFlushing, setIsFlushing] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [showNewProfileForm, setShowNewProfileForm] = useState(false);
  const [newElderName, setNewElderName] = useState("");
  const [newCustomCode, setNewCustomCode] = useState("");
  const [newProfileLang, setNewProfileLang] = useState<LanguageCode>("hi");
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [publishNotice, setPublishNotice] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState("");

  const [contactForm, setContactForm] = useState<EmergencyContact>(emergencyContact);
  const [contactSaved, setContactSaved] = useState(false);

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await listProfiles();
      setProfiles(list);
    } catch {
      // Ignore profile list fetch failures gracefully
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles, verifiedMedicines.length]);

  async function executeScan(params: {
    file?: File;
    imageBase64: string;
    mimeType: string;
    label: string;
    hint: string;
    overrideStripPhoto?: string;
  }) {
    setPreviewImage(params.imageBase64);
    setScanLabel(params.label);
    setIsScanning(true);
    setScanError("");
    setPublishNotice("");

    try {
      const result = await scanPrescription({
        file: params.file,
        imageBase64: params.imageBase64,
        mimeType: params.mimeType,
        scanHint: params.hint,
        overrideStripPhoto: params.overrideStripPhoto,
      });

      setDoctorOrClinic(result.doctor_or_clinic || "");
      setGeneralWarning(result.general_warning || "");
      setDrafts(result.medicines);

      if (result.medicines.length === 0) {
        setScanError(
          "No medications were clearly readable in this image. Capture a brighter photo or add a medicine manually."
        );
      }
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Could not scan image.");
    } finally {
      setIsScanning(false);
    }
  }

  function handleUploadFile(file: File, base64: string) {
    void executeScan({
      file,
      imageBase64: base64,
      mimeType: file.type || "image/jpeg",
      label: file.name,
      hint: "Uploaded prescription or physical medicine strip photo",
    });
  }

  async function handleDemoScan(kind: "prescription" | "strip") {
    const url =
      kind === "prescription"
        ? GENERATED_ASSETS.samplePrescription
        : GENERATED_ASSETS.stripParacetamol;

    try {
      const { base64, mimeType } = await fetchUrlAsBase64(url);
      await executeScan({
        imageBase64: base64,
        mimeType,
        label:
          kind === "prescription"
            ? "Sample Clinic Prescription (Sunrise Family Clinic)"
            : "Sample Blister Strip (Paracetamol 650mg)",
        hint:
          kind === "prescription"
            ? "Printed clinic prescription with handwritten breakfast note"
            : "Physical pharmaceutical blister strip photo",
        overrideStripPhoto: kind === "strip" ? url : undefined,
      });
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Failed to load demo image.");
    }
  }

  function handleAddManual() {
    setPublishNotice("");
    setDrafts((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        medicine_name: "",
        dosage: "1 tablet",
        frequency_code: "1-0-1",
        meal_relation: "After Food",
        duration_days: "7 days",
        ai_accuracy: "Low",
        confidence_score: 0.4,
        needs_review: true,
        ai_accuracy_reason: "Entered manually — requires caregiver confirmation.",
        pill_appearance: "White oval tablet",
        simple_explanation_en: "Take 1 tablet after food with water.",
        simple_explanation_hi: "खाने के बाद पानी के साथ 1 गोली लें।",
        simple_explanation_mr: "जेवणानंतर पाण्यासोबत 1 गोळी घ्या.",
        strip_image_url: GENERATED_ASSETS.stripParacetamol,
        manually_verified: false,
      },
    ]);
  }

  function handleUpdateDraft(id: string, patch: Partial<ScannedMedicineCandidate>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function handleRemoveDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  const verifiedDrafts = drafts.filter(
    (d) => d.manually_verified && d.medicine_name.trim().length > 0
  );
  const unverifiedCount = drafts.length - verifiedDrafts.length;

  async function handleConfirmSchedule() {
    if (verifiedDrafts.length === 0) return;
    setIsConfirming(true);
    setScanError("");
    try {
      const saved = await confirmMedicines({
        share_code: shareCode,
        verified_by: emergencyContact.name || "Primary Caregiver",
        doctor_or_clinic: doctorOrClinic || undefined,
        replace_existing: saveMode === "replace",
        medicines: verifiedDrafts,
      });

      setDrafts((prev) => prev.filter((d) => !d.manually_verified));
      setPublishNotice(
        `${saved.length} caregiver-verified ${
          saved.length === 1 ? "medicine" : "medicines"
        } ${
          saveMode === "replace" ? "replaced previous schedule and" : "added to existing schedule and"
        } published to Grandparents Mode (${shareCode}).`
      );
      await onRefreshData();
      await refreshProfiles();
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Failed to confirm schedule.");
    } finally {
      setIsConfirming(false);
    }
  }

  async function handleFlushSchedule() {
    setIsFlushing(true);
    setScanError("");
    try {
      const count = await flushMedicines(shareCode);
      setPublishNotice(`Flushed ${count} active medicine(s) from ${shareCode}.`);
      await onRefreshData();
      await refreshProfiles();
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Failed to flush schedule.");
    } finally {
      setIsFlushing(false);
    }
  }

  async function handleResetDemo() {
    setIsFlushing(true);
    setScanError("");
    try {
      await resetDemoProfile();
      onChangeShareCode("DEMO01");
      setPublishNotice("Reset DEMO01 back to the clean 5-medicine demo schedule.");
      await onRefreshData();
      await refreshProfiles();
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Failed to reset DEMO01.");
    } finally {
      setIsFlushing(false);
    }
  }

  async function handleCreateProfile(event: FormEvent) {
    event.preventDefault();
    if (!newElderName.trim()) return;
    setIsCreatingProfile(true);
    setScanError("");
    try {
      const created = await createProfile({
        share_code: newCustomCode.trim() || undefined,
        elder_name: newElderName.trim(),
        preferred_language: newProfileLang,
        caregiver_name: emergencyContact.name || undefined,
        caregiver_phone: emergencyContact.phone || undefined,
      });
      onChangeShareCode(created.share_code);
      setNewElderName("");
      setNewCustomCode("");
      setShowNewProfileForm(false);
      setPublishNotice(
        `Created profile "${created.elder_name}" with Share Code ${created.share_code}.`
      );
      await refreshProfiles();
      await onRefreshData();
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Failed to create profile.");
    } finally {
      setIsCreatingProfile(false);
    }
  }

  async function handleDeleteVerified(medicineId: string) {
    await removeVerifiedMedicine(medicineId);
    await onRefreshData();
    await refreshProfiles();
  }

  function handlePreviewVoice(med: VerifiedMedicine) {
    if (speakingId === med.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setTtsError("");
    const text = getMedicineSpokenText(med, language);
    speakText(text, language, {
      onStart: () => {
        setTtsError("");
        setSpeakingId(med.id);
      },
      onEnd: () => setSpeakingId(null),
      onError: (message) => {
        setSpeakingId(null);
        setTtsError(message);
      },
    });
  }

  function handleSaveContact(event: FormEvent) {
    event.preventDefault();
    onUpdateEmergencyContact({
      name: contactForm.name.trim() || "Primary Caregiver",
      relation: contactForm.relation.trim() || "Family Caregiver",
      phone: contactForm.phone.trim(),
      whatsapp_phone:
        contactForm.whatsapp_phone.trim() || contactForm.phone.replace(/[^\d]/g, ""),
    });
    setContactSaved(true);
    setTimeout(() => setContactSaved(false), 3000);
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
            Caregiver Mode · Dual AI Accuracy &amp; Manual Verification
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            Prescription Scanner &amp; Verification Gate
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>Profile:</span>
            {profiles.length > 0 && (
              <select
                aria-label="Select existing elder profile"
                value={profiles.some((p) => p.share_code === shareCode) ? shareCode : ""}
                onChange={(e) => {
                  if (e.target.value) onChangeShareCode(e.target.value);
                }}
                className="min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold"
              >
                {!profiles.some((p) => p.share_code === shareCode) && (
                  <option value="">{shareCode} (Custom)</option>
                )}
                {profiles.map((p) => (
                  <option key={p.share_code} value={p.share_code}>
                    {p.share_code} · {p.elder_name} ({p.active_medicine_count})
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={shareCode}
              onChange={(e) => onChangeShareCode(e.target.value.toUpperCase())}
              maxLength={12}
              aria-label="Family profile share code"
              className="w-24 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono-data text-sm uppercase"
            />
            <button
              type="button"
              onClick={() => setShowNewProfileForm((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" aria-hidden="true" />
              <span>New Profile</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onNavigateVitals}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Activity className="w-4 h-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <span>Vitals &amp; WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={onNavigateNani}
            className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Open Grandparents Mode</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Inline Create Profile Form */}
      {showNewProfileForm && (
        <form
          onSubmit={(e) => void handleCreateProfile(e)}
          className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/20 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Elder Name *
            </span>
            <input
              type="text"
              required
              placeholder="e.g. Meera Dadi"
              value={newElderName}
              onChange={(e) => setNewElderName(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Share Code (optional)
            </span>
            <input
              type="text"
              placeholder="Auto-generate"
              maxLength={12}
              value={newCustomCode}
              onChange={(e) => setNewCustomCode(e.target.value.toUpperCase())}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-data uppercase"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Preferred Language
            </span>
            <select
              value={newProfileLang}
              onChange={(e) => setNewProfileLang(e.target.value as LanguageCode)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="hi">Hindi (हिन्दी)</option>
              <option value="mr">Marathi (मराठी)</option>
              <option value="en">English</option>
            </select>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isCreatingProfile}
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{isCreatingProfile ? "Creating..." : "Create"}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowNewProfileForm(false)}
              className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Segmented Workspace Tabs */}
      <div
        role="tablist"
        aria-label="Caregiver workspace tabs"
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 w-fit max-w-full"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "scan"}
          onClick={() => setActiveTab("scan")}
          className={`inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === "scan"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <ScanLine className="w-4 h-4" aria-hidden="true" />
          <span>Scan &amp; Verify</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "verified"}
          onClick={() => setActiveTab("verified")}
          className={`inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === "verified"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
          <span className="tabular-nums">
            Verified Schedule ({verifiedMedicines.length})
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "emergency"}
          onClick={() => setActiveTab("emergency")}
          className={`inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === "emergency"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <PhoneCall className="w-4 h-4" aria-hidden="true" />
          <span>Emergency Contact</span>
        </button>
      </div>

      {/* Tab 1: Prescription Scanner + Yellow Review Gate */}
      {activeTab === "scan" && (
        <div className="space-y-8">
          <PrescriptionScanner
            previewImage={previewImage}
            scanLabel={scanLabel}
            doctorOrClinic={doctorOrClinic}
            isScanning={isScanning}
            scanError={scanError}
            onUploadFile={handleUploadFile}
            onRunDemoScan={(kind) => void handleDemoScan(kind)}
            onAddManual={handleAddManual}
          />

          {publishNotice && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm font-medium text-emerald-900 dark:text-emerald-200"
            >
              <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{publishNotice}</span>
            </div>
          )}

          {drafts.length > 0 && (
            <section className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Step 2 of 2 · Yellow Verification Gate (AI Probability + Manual Confirmation)
                  </p>
                  <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                    Review &amp; Confirm Extracted Medicines
                  </h2>
                  {generalWarning && (
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Scanner note: {generalWarning}
                    </p>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap shrink-0">
                  {verifiedDrafts.length} of {drafts.length} manually verified
                </p>
              </div>

              <div className="space-y-5">
                {drafts.map((draft, idx) => (
                  <ReviewMedicineCard
                    key={draft.id}
                    index={idx}
                    draft={draft}
                    onChange={handleUpdateDraft}
                    onRemove={handleRemoveDraft}
                  />
                ))}
              </div>

              <div className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Confirm Schedule (POST /medicines/confirm)
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {unverifiedCount > 0
                        ? `${unverifiedCount} item(s) still unverified and locked out of Grandparents Mode.`
                        : "All items are manually confirmed and ready for voiceover in Grandparents Mode."}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={verifiedDrafts.length === 0 || isConfirming}
                    onClick={() => void handleConfirmSchedule()}
                    className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isConfirming ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>
                      {saveMode === "replace"
                        ? `Flush & Publish (${verifiedDrafts.length}) to ${shareCode}`
                        : `Add (${verifiedDrafts.length}) to ${shareCode}`}
                    </span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    When saving to {shareCode}:
                  </span>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="saveMode"
                      value="replace"
                      checked={saveMode === "replace"}
                      onChange={() => setSaveMode("replace")}
                    />
                    <span>Flush previous &amp; replace ({verifiedMedicines.length} active)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="saveMode"
                      value="append"
                      checked={saveMode === "append"}
                      onChange={() => setSaveMode("append")}
                    />
                    <span>Add to existing schedule</span>
                  </label>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Tab 2: Live Verified Schedule */}
      {activeTab === "verified" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
              Active medicines for <span className="font-mono-data">{shareCode}</span>:{" "}
              {verifiedMedicines.length}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {shareCode === "DEMO01" && (
                <button
                  type="button"
                  disabled={isFlushing}
                  onClick={() => void handleResetDemo()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reset DEMO01</span>
                </button>
              )}
              {verifiedMedicines.length > 0 && (
                <button
                  type="button"
                  disabled={isFlushing}
                  onClick={() => void handleFlushSchedule()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Flush All ({verifiedMedicines.length})</span>
                </button>
              )}
            </div>
          </div>

          {ttsError && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-semibold text-red-800 dark:text-red-200"
            >
              {ttsError}
            </div>
          )}
          {verifiedMedicines.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-2">
              <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                No verified prescriptions for {shareCode}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Scan a prescription in Scan &amp; Verify and confirm it manually to unlock it for
                Grandparents Mode.
              </p>
            </div>
          ) : (
            verifiedMedicines.map((med) => (
              <article
                key={med.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center"
              >
                <div className="lg:col-span-3 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 aspect-[4/3]">
                  <StripImage
                    src={med.strip_image_url}
                    alt={`${med.medicine_name} strip`}
                    title={med.medicine_name}
                    className="w-full h-full"
                  />
                </div>

                <div className="lg:col-span-6 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      Caregiver Verified
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>AI Accuracy: {med.ai_accuracy}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-data">{med.frequency_code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{med.meal_relation}</span>
                  </div>

                  <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                    {med.medicine_name}
                  </h3>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {med.dosage} — {med.pill_appearance}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {med.slots.map((slotObj) => {
                      const taken = med.taken_slots_today.includes(slotObj.slot);
                      return (
                        <button
                          key={slotObj.slot}
                          type="button"
                          onClick={() => void onMarkDose(med.id, slotObj.slot, !taken)}
                          className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                            taken
                              ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                              : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <CheckCircle2
                            className={`w-3.5 h-3.5 ${
                              taken ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="tabular-nums">
                            {slotObj.slot} ({slotObj.time_label}) · {taken ? "Taken" : "Pending"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-3 flex lg:flex-col items-stretch justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => handlePreviewVoice(med)}
                    className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {speakingId === med.id ? (
                      <>
                        <VolumeX className="w-4 h-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
                        <span>Stop Voice</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
                        <span>Test Voiceover</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDeleteVerified(med.id)}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-red-700 dark:text-red-400 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      )}

      {/* Tab 3: Emergency Contact Config */}
      {activeTab === "emergency" && (
        <section className="max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Emergency Contact for Grandparents Mode
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Powers the oversized 1-tap Emergency Call and WhatsApp SOS alert inside Grandparents
              Mode.
            </p>
          </div>

          <form onSubmit={handleSaveContact} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Caregiver Name
                </span>
                <input
                  type="text"
                  required
                  value={contactForm.name}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Relationship
                </span>
                <input
                  type="text"
                  value={contactForm.relation}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, relation: e.target.value }))
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Phone Number
                </span>
                <input
                  type="tel"
                  required
                  value={contactForm.phone}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  WhatsApp Number (country code + digits)
                </span>
                <input
                  type="text"
                  value={contactForm.whatsapp_phone}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      whatsapp_phone: e.target.value,
                    }))
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono-data"
                />
              </label>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                className="inline-flex items-center gap-2 min-h-[46px] px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors cursor-pointer"
              >
                <span>Save Emergency Contact</span>
              </button>

              {contactSaved && (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>Saved</span>
                </span>
              )}
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
