import { GENERATED_ASSETS, VITALS_RANGES } from "../config";
import {
  AccuracyLevel,
  ConfirmMedicinesRequest,
  CreateVitalRequest,
  MarkDoseRequest,
  MarkDoseResponse,
  MealRelation,
  ProfileSummaryResponse,
  ScannedMedicineCandidate,
  ScanPrescriptionResponse,
  ScheduleResponse,
  VerifiedMedicine,
  VitalLogEntry,
} from "../types/api";
import { parseFrequencyToSlots } from "../utils/scheduler";
import {
  loadAllStoredMedicines,
  loadAllStoredVitals,
  loadEmergencyContact,
  loadVerifiedMedicines,
  loadVitals,
  saveAllStoredMedicines,
  saveAllStoredVitals,
} from "../utils/storage";
import { buildSummaryText, buildWhatsAppSummaryUrl } from "../utils/whatsapp";

const FASTAPI_BASE_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

export function getApiMode(): { connectedToFastApi: boolean; baseUrl: string } {
  return {
    connectedToFastApi: FASTAPI_BASE_URL.length > 0,
    baseUrl: FASTAPI_BASE_URL || "/api (Built-in Preview)",
  };
}

function normalizeAccuracy(raw: unknown, confidenceScore?: number): AccuracyLevel {
  const lower = String(raw || "").toLowerCase();
  if (lower.includes("high")) return "High";
  if (lower.includes("low")) return "Low";
  if (lower.includes("medium") || lower.includes("med")) return "Medium";
  if (typeof confidenceScore === "number") {
    if (confidenceScore >= 0.85) return "High";
    if (confidenceScore < 0.65) return "Low";
    return "Medium";
  }
  return "Medium";
}

function normalizeConfidence(accuracy: AccuracyLevel, rawScore?: number): number {
  if (typeof rawScore === "number" && !Number.isNaN(rawScore)) {
    return rawScore > 1 ? Math.min(1, rawScore / 100) : Math.max(0, Math.min(1, rawScore));
  }
  if (accuracy === "High") return 0.94;
  if (accuracy === "Medium") return 0.72;
  return 0.45;
}

function normalizeMealRelation(raw: unknown): MealRelation {
  const lower = String(raw || "").toLowerCase();
  if (lower.includes("before")) return "Before Food";
  if (lower.includes("with")) return "With Food";
  if (lower.includes("any")) return "Anytime";
  return "After Food";
}

export function guessStripAsset(medicineName: string, appearance: string): string {
  const combined = `${medicineName} ${appearance}`.toLowerCase();
  if (combined.includes("capsule") || combined.includes("pan") || combined.includes("neuro")) {
    return GENERATED_ASSETS.stripCapsule;
  }
  if (
    combined.includes("atorva") ||
    combined.includes("lisinopril") ||
    combined.includes("meta") ||
    combined.includes("10mg") ||
    combined.includes("10 mg") ||
    combined.includes("20 mg")
  ) {
    return GENERATED_ASSETS.stripAtorvastatin;
  }
  return GENERATED_ASSETS.stripParacetamol;
}

function mapRawScannedMedicine(
  raw: Record<string, unknown>,
  index: number,
  overrideStripPhoto?: string
): ScannedMedicineCandidate {
  const rawScore =
    typeof raw.confidence_score === "number" ? raw.confidence_score : undefined;
  const accuracy = normalizeAccuracy(raw.ai_accuracy ?? raw.confidence_level, rawScore);
  const confidenceScore = normalizeConfidence(accuracy, rawScore);
  const name = String(raw.medicine_name ?? raw.name ?? "Unnamed Medicine");
  const dosage = String(raw.dosage ?? "1 tablet");
  const freq = String(raw.frequency_code ?? raw.frequency ?? raw.timing ?? "1-0-0");
  const meal = normalizeMealRelation(raw.meal_relation ?? raw.food_timing);
  const appearance = String(raw.pill_appearance ?? "Standard pharmaceutical blister strip");
  const needsReview =
    typeof raw.needs_review === "boolean"
      ? raw.needs_review
      : accuracy !== "High";

  return {
    id: String(raw.id ?? `draft-${Date.now()}-${index}`),
    medicine_name: name,
    dosage,
    frequency_code: freq,
    meal_relation: meal,
    duration_days: String(raw.duration_days ?? raw.duration ?? "7 days"),
    ai_accuracy: accuracy,
    confidence_score: confidenceScore,
    needs_review: needsReview,
    ai_accuracy_reason: String(
      raw.ai_accuracy_reason ??
        raw.review_reason ??
        (accuracy === "High"
          ? "Clearly printed medicine label and dosage."
          : "Verify dosage and timing against the original prescription.")
    ),
    pill_appearance: appearance,
    simple_explanation_en: String(
      raw.simple_explanation_en ??
        `Take ${dosage} of ${name} ${meal.toLowerCase()}.`
    ),
    simple_explanation_hi: String(
      raw.simple_explanation_hi ?? `${name} की ${dosage} ${meal} लें।`
    ),
    simple_explanation_mr: String(
      raw.simple_explanation_mr ?? `${name} ची ${dosage} घ्या.`
    ),
    strip_image_url:
      overrideStripPhoto ||
      (typeof raw.strip_image_url === "string" && raw.strip_image_url
        ? raw.strip_image_url
        : guessStripAsset(name, appearance)),
    manually_verified: false,
  };
}

/**
 * POST /scan
 * Targets FastAPI `${VITE_API_URL}/scan` when configured, or falls back to
 * the built-in `/api/scan` Gemini Vision endpoint.
 */
export async function scanPrescription(params: {
  file?: File;
  imageBase64: string;
  mimeType: string;
  scanHint?: string;
  overrideStripPhoto?: string;
}): Promise<ScanPrescriptionResponse> {
  if (FASTAPI_BASE_URL) {
    let response: Response;
    if (params.file) {
      const formData = new FormData();
      formData.append("file", params.file);
      response = await fetch(`${FASTAPI_BASE_URL}/scan`, {
        method: "POST",
        body: formData,
      });
    } else {
      const blobRes = await fetch(params.imageBase64);
      const blob = await blobRes.blob();
      const formData = new FormData();
      formData.append("file", blob, "prescription.jpg");
      response = await fetch(`${FASTAPI_BASE_URL}/scan`, {
        method: "POST",
        body: formData,
      });
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        String(payload.detail ?? payload.error ?? "FastAPI /scan request failed.")
      );
    }

    const rawMeds = Array.isArray(payload.medicines)
      ? (payload.medicines as Record<string, unknown>[])
      : [];

    return {
      document_type: String(payload.document_type ?? "Prescription"),
      doctor_or_clinic: String(payload.doctor_or_clinic ?? ""),
      general_warning: String(payload.general_warning ?? ""),
      medicines: rawMeds.map((m, idx) =>
        mapRawScannedMedicine(m, idx, params.overrideStripPhoto)
      ),
    };
  }

  // Built-in preview server Gemini Vision endpoint
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      scanHint: params.scanHint,
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Prescription scan failed."));
  }

  const rawMeds = Array.isArray(payload.medicines)
    ? (payload.medicines as Record<string, unknown>[])
    : [];

  return {
    document_type: String(payload.document_type ?? "Prescription"),
    doctor_or_clinic: String(payload.doctor_or_clinic ?? ""),
    general_warning: String(payload.general_warning ?? ""),
    medicines: rawMeds.map((m, idx) =>
      mapRawScannedMedicine(m, idx, params.overrideStripPhoto)
    ),
  };
}

/**
 * POST /medicines/confirm
 * Persists caregiver-verified medications so they become visible & speakable in Nani mode.
 */
export async function confirmMedicines(
  payload: ConfirmMedicinesRequest
): Promise<VerifiedMedicine[]> {
  const verifiedOnly = payload.medicines.filter(
    (m) => m.manually_verified && m.medicine_name.trim().length > 0
  );
  if (verifiedOnly.length === 0) {
    return [];
  }

  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/medicines/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        share_code: payload.share_code,
        verified_by: payload.verified_by,
        doctor_or_clinic: payload.doctor_or_clinic,
        medicines: verifiedOnly,
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        String(err.detail ?? err.error ?? "Failed to confirm medicines on backend.")
      );
    }

    const data = (await response.json()) as VerifiedMedicine[] | { medicines: VerifiedMedicine[] };
    return Array.isArray(data) ? data : data.medicines || [];
  }

  // Built-in preview persistence
  const normalizedCode = payload.share_code.trim().toUpperCase();
  const created: VerifiedMedicine[] = verifiedOnly.map((draft) => ({
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    share_code: normalizedCode,
    medicine_name: draft.medicine_name.trim(),
    dosage: draft.dosage.trim() || "1 tablet",
    frequency_code: draft.frequency_code.trim() || "1-0-0",
    slots: parseFrequencyToSlots(draft.frequency_code),
    meal_relation: draft.meal_relation,
    duration_days: draft.duration_days.trim() || "Ongoing",
    ai_accuracy: draft.ai_accuracy,
    confidence_score: draft.confidence_score,
    ai_accuracy_reason: draft.ai_accuracy_reason,
    caregiver_verified: true,
    verified_at: new Date().toISOString(),
    verified_by: payload.verified_by || "Primary Caregiver",
    pill_appearance: draft.pill_appearance.trim() || "Matched blister strip",
    simple_explanation_en:
      draft.simple_explanation_en.trim() ||
      `Take ${draft.dosage} of ${draft.medicine_name} ${draft.meal_relation.toLowerCase()}.`,
    simple_explanation_hi:
      draft.simple_explanation_hi.trim() ||
      `${draft.medicine_name} (${draft.dosage}) लें।`,
    simple_explanation_mr:
      draft.simple_explanation_mr.trim() ||
      `${draft.medicine_name} (${draft.dosage}) घ्या.`,
    strip_image_url: draft.strip_image_url || GENERATED_ASSETS.stripParacetamol,
    taken_slots_today: [],
    doctor_or_clinic: payload.doctor_or_clinic || undefined,
  }));

  const existing = loadAllStoredMedicines();
  saveAllStoredMedicines([...created, ...existing]);
  return created;
}

/**
 * GET /schedule/{share_code}
 * Login-free Nani view fetching ONLY caregiver-verified schedules.
 */
export async function fetchSchedule(shareCode: string): Promise<ScheduleResponse> {
  const normalizedCode = shareCode.trim().toUpperCase();

  if (FASTAPI_BASE_URL) {
    const response = await fetch(
      `${FASTAPI_BASE_URL}/schedule/${encodeURIComponent(normalizedCode)}`
    );
    if (!response.ok) {
      throw new Error(`Could not load schedule for share code ${normalizedCode}.`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const rawMeds = Array.isArray(raw.medicines)
      ? (raw.medicines as VerifiedMedicine[])
      : [];
    return {
      share_code: String(raw.share_code ?? normalizedCode),
      patient_name: String(raw.patient_name ?? "Nani"),
      caregiver_name: String(raw.caregiver_name ?? loadEmergencyContact().name),
      emergency_contact:
        (raw.emergency_contact as ScheduleResponse["emergency_contact"]) ||
        loadEmergencyContact(),
      medicines: rawMeds.filter((m) => Boolean(m.caregiver_verified)),
    };
  }

  const emergency = loadEmergencyContact();
  return {
    share_code: normalizedCode,
    patient_name: "Nani",
    caregiver_name: emergency.name,
    emergency_contact: emergency,
    medicines: loadVerifiedMedicines(normalizedCode),
  };
}

/**
 * POST /doses/mark
 */
export async function markDose(req: MarkDoseRequest): Promise<MarkDoseResponse> {
  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/doses/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw new Error("Could not update dose status.");
    }
    return (await response.json()) as MarkDoseResponse;
  }

  const all = loadAllStoredMedicines();
  const updated = all.map((med) => {
    if (med.id !== req.medicine_id) return med;
    const exists = med.taken_slots_today.includes(req.slot);
    const nextSlots = req.taken
      ? exists
        ? med.taken_slots_today
        : [...med.taken_slots_today, req.slot]
      : med.taken_slots_today.filter((s) => s !== req.slot);
    return { ...med, taken_slots_today: nextSlots };
  });
  saveAllStoredMedicines(updated);

  return {
    ok: true,
    medicine_id: req.medicine_id,
    slot: req.slot,
    taken: req.taken,
  };
}

export async function removeVerifiedMedicine(medicineId: string): Promise<void> {
  if (FASTAPI_BASE_URL) {
    await fetch(`${FASTAPI_BASE_URL}/medicines/${encodeURIComponent(medicineId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }
  const remaining = loadAllStoredMedicines().filter((m) => m.id !== medicineId);
  saveAllStoredMedicines(remaining);
}

/**
 * POST /vitals
 */
export async function logVital(req: CreateVitalRequest): Promise<VitalLogEntry> {
  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/vitals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw new Error("Could not save vitals reading.");
    }
    return (await response.json()) as VitalLogEntry;
  }

  const highTemp =
    req.temperature_f > VITALS_RANGES.temperature_f.max ||
    req.temperature_f < VITALS_RANGES.temperature_f.min;
  const highBp =
    req.bp_systolic > VITALS_RANGES.bp_systolic.max ||
    req.bp_systolic < VITALS_RANGES.bp_systolic.min ||
    req.bp_diastolic > VITALS_RANGES.bp_diastolic.max ||
    req.bp_diastolic < VITALS_RANGES.bp_diastolic.min;

  const entry: VitalLogEntry = {
    id: `vital-${Date.now()}`,
    share_code: req.share_code.trim().toUpperCase(),
    recorded_at: new Date().toISOString(),
    temperature_f: req.temperature_f,
    bp_systolic: req.bp_systolic,
    bp_diastolic: req.bp_diastolic,
    weight_kg: req.weight_kg,
    notes: req.notes?.trim() || undefined,
    flagged: highTemp || highBp,
    flag_reason: highTemp
      ? "Temperature outside normal range"
      : highBp
      ? "Blood pressure outside normal range"
      : undefined,
  };

  const all = loadAllStoredVitals();
  saveAllStoredVitals([entry, ...all]);
  return entry;
}

export async function deleteVitalEntry(vitalId: string): Promise<void> {
  const remaining = loadAllStoredVitals().filter((v) => v.id !== vitalId);
  saveAllStoredVitals(remaining);
}

/**
 * GET /profile/{share_code}/summary
 */
export async function fetchProfileSummary(
  shareCode: string
): Promise<ProfileSummaryResponse> {
  const normalizedCode = shareCode.trim().toUpperCase();

  if (FASTAPI_BASE_URL) {
    const response = await fetch(
      `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}/summary`
    );
    if (!response.ok) {
      throw new Error(`Could not load summary for ${normalizedCode}.`);
    }
    return (await response.json()) as ProfileSummaryResponse;
  }

  const medicines = loadVerifiedMedicines(normalizedCode);
  const vitals = loadVitals(normalizedCode);
  const emergencyContact = loadEmergencyContact();

  const totalDoses = medicines.reduce((sum, m) => sum + m.slots.length, 0);
  const takenDoses = medicines.reduce(
    (sum, m) => sum + m.taken_slots_today.length,
    0
  );
  const adherencePercent =
    totalDoses > 0 ? Math.round((takenDoses / totalDoses) * 100) : 0;

  return {
    share_code: normalizedCode,
    patient_name: "Nani",
    generated_at: new Date().toISOString(),
    adherence_taken: takenDoses,
    adherence_total: totalDoses,
    adherence_percent: adherencePercent,
    medicines,
    vitals,
    emergency_contact: emergencyContact,
    summary_text: buildSummaryText(normalizedCode, medicines, vitals),
    whatsapp_url: buildWhatsAppSummaryUrl(
      normalizedCode,
      medicines,
      vitals,
      emergencyContact
    ),
  };
}
