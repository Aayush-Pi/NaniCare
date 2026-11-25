import { GENERATED_ASSETS, VITALS_RANGES } from "../config";
import {
  AccuracyLevel,
  ConfirmMedicinesRequest,
  CreateVitalRequest,
  EmergencyContact,
  MarkDoseRequest,
  MarkDoseResponse,
  MealRelation,
  ProfileSummaryResponse,
  ScannedMedicineCandidate,
  ScanPrescriptionResponse,
  ScheduledSlot,
  ScheduleResponse,
  TimeSlotKey,
  VerifiedMedicine,
  VitalLogEntry,
} from "../types/api";
import { parseFrequencyToSlots, SLOT_TIME_LABELS } from "../utils/scheduler";
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
  if (lower.includes("before") || lower.includes("empty")) return "Before Food";
  if (lower.includes("with")) return "With Food";
  if (lower.includes("any")) return "Anytime";
  return "After Food";
}

function toBackendMealRelation(
  meal: MealRelation
): "before_food" | "after_food" | "with_food" | "anytime" {
  switch (meal) {
    case "Before Food":
      return "before_food";
    case "With Food":
      return "with_food";
    case "Anytime":
      return "anytime";
    default:
      return "after_food";
  }
}

function toFrontendSlot(rawSlot: unknown): TimeSlotKey {
  const lower = String(rawSlot || "").toLowerCase();
  if (lower === "afternoon" || lower === "evening") return "Afternoon";
  if (lower === "night" || lower === "sos") return "Night";
  return "Morning";
}

function inferDosageForm(
  dosage: string,
  appearance: string
): "tablet" | "capsule" | "syrup" | "drops" | "injection" | "inhaler" | "ointment" | "other" {
  const text = `${dosage} ${appearance}`.toLowerCase();
  if (text.includes("capsule")) return "capsule";
  if (text.includes("syrup") || text.includes("liquid") || text.includes("ml")) return "syrup";
  if (text.includes("drop")) return "drops";
  if (text.includes("inhaler")) return "inhaler";
  if (text.includes("ointment") || text.includes("cream") || text.includes("gel")) return "ointment";
  if (text.includes("injection")) return "injection";
  return "tablet";
}

function parseDurationDays(raw: string): number | null {
  const match = /\d+/.exec(raw || "");
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function mapBackendVital(
  raw: Record<string, unknown>,
  fallbackShareCode: string
): VitalLogEntry {
  const flags = Array.isArray(raw.flags)
    ? (raw.flags as Record<string, unknown>[])
    : [];
  const overallStatus = String(raw.overall_status ?? "normal").toLowerCase();
  const flagReason = flags
    .map((f) => String(f.message_en ?? "").trim())
    .filter(Boolean)
    .join("; ");

  return {
    id: String(raw.id ?? `vital-${Date.now()}`),
    share_code: String(raw.share_code ?? fallbackShareCode).toUpperCase(),
    recorded_at: String(raw.recorded_at ?? new Date().toISOString()),
    temperature_f: Number(raw.temperature_f ?? 0),
    bp_systolic: Number(raw.systolic_mmhg ?? raw.bp_systolic ?? 0),
    bp_diastolic: Number(raw.diastolic_mmhg ?? raw.bp_diastolic ?? 0),
    weight_kg: Number(raw.weight_kg ?? 0),
    notes: raw.notes ? String(raw.notes) : undefined,
    flagged:
      typeof raw.flagged === "boolean"
        ? raw.flagged
        : overallStatus !== "normal" || flags.length > 0,
    flag_reason: flagReason || (raw.flag_reason ? String(raw.flag_reason) : undefined),
  };
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
    typeof raw.confidence_score === "number"
      ? raw.confidence_score
      : typeof raw.confidence === "number"
      ? raw.confidence
      : undefined;
  const accuracy = normalizeAccuracy(raw.ai_accuracy ?? raw.confidence_level, rawScore);
  const confidenceScore = normalizeConfidence(accuracy, rawScore);
  const name = String(
    raw.medicine_name ?? raw.brand_name ?? raw.name ?? "Unnamed Medicine"
  );
  const strength = raw.strength ? String(raw.strength) : "";
  const dosageForm = raw.dosage_form ? String(raw.dosage_form) : "";
  const dosage = String(
    raw.dosage ?? ([strength, dosageForm].filter(Boolean).join(" · ") || "1 tablet")
  );
  const freq = String(
    raw.frequency_code ?? raw.dosage_pattern ?? raw.frequency ?? raw.timing ?? "1-0-0"
  );
  const meal = normalizeMealRelation(raw.meal_relation ?? raw.food_timing);
  const appearance = String(
    raw.pill_appearance ??
      (dosageForm ? `Standard ${dosageForm} blister strip` : "Standard pharmaceutical blister strip")
  );
  const needsReview =
    typeof raw.needs_review === "boolean"
      ? raw.needs_review
      : accuracy !== "High";
  const durationDisplay =
    typeof raw.duration_days === "number"
      ? `${raw.duration_days} days`
      : String(raw.duration_days ?? raw.duration ?? "Ongoing");
  const safetyFlags = Array.isArray(raw.safety_flags)
    ? (raw.safety_flags as Record<string, unknown>[])
    : [];
  const safetyReason = safetyFlags
    .map((f) => String(f.message_en ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const stripImage =
    overrideStripPhoto ||
    (typeof raw.strip_image_url === "string" && raw.strip_image_url
      ? raw.strip_image_url
      : typeof raw.strip_thumbnail === "string" && raw.strip_thumbnail
      ? raw.strip_thumbnail
      : guessStripAsset(name, appearance));

  return {
    id: String(raw.id ?? `draft-${Date.now()}-${index}`),
    medicine_name: name,
    dosage,
    frequency_code: freq,
    meal_relation: meal,
    duration_days: durationDisplay,
    ai_accuracy: accuracy,
    confidence_score: confidenceScore,
    needs_review: needsReview,
    ai_accuracy_reason: String(
      raw.ai_accuracy_reason ??
        raw.review_reason ??
        (safetyReason ||
          (accuracy === "High"
            ? "Clearly printed medicine label and dosage."
            : "Verify dosage and timing against the original prescription."))
    ),
    pill_appearance: appearance,
    simple_explanation_en: String(
      raw.simple_explanation_en ??
        raw.instructions_en ??
        `Take ${dosage} of ${name} ${meal.toLowerCase()}.`
    ),
    simple_explanation_hi: String(
      raw.simple_explanation_hi ??
        raw.instructions_hi ??
        `${name} की ${dosage} ${meal} लें।`
    ),
    simple_explanation_mr: String(
      raw.simple_explanation_mr ??
        raw.instructions_mr ??
        `${name} ची ${dosage} घ्या.`
    ),
    strip_image_url: stripImage,
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
    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings.map((w) => String(w)).filter(Boolean).join(" ")
      : "";
    const doctorOrClinic = [payload.doctor_name, payload.clinic_name]
      .filter((v) => typeof v === "string" && v.trim().length > 0)
      .join(" — ");

    return {
      document_type: String(payload.document_type ?? payload.source_type ?? "Prescription"),
      doctor_or_clinic: String(payload.doctor_or_clinic ?? doctorOrClinic),
      general_warning: String(payload.general_warning ?? warnings),
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
    const normalizedCode = payload.share_code.trim().toUpperCase();
    const response = await fetch(`${FASTAPI_BASE_URL}/medicines/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        share_code: normalizedCode,
        caregiver_name: payload.verified_by || undefined,
        prescribed_by: payload.doctor_or_clinic || undefined,
        medicines: verifiedOnly.map((draft) => ({
          brand_name: draft.medicine_name.trim(),
          strength: draft.dosage.trim() || null,
          dosage_form: inferDosageForm(draft.dosage, draft.pill_appearance),
          dosage_pattern: draft.frequency_code.trim() || "OD",
          meal_relation: toBackendMealRelation(draft.meal_relation),
          duration_days: parseDurationDays(draft.duration_days),
          instructions_en: draft.simple_explanation_en.trim() || null,
          instructions_hi: draft.simple_explanation_hi.trim() || null,
          instructions_mr: draft.simple_explanation_mr.trim() || null,
          strip_thumbnail: draft.strip_image_url || null,
          confidence: draft.confidence_score,
          prescribed_by: payload.doctor_or_clinic || null,
        })),
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        String(err.detail ?? err.error ?? "Failed to confirm medicines on backend.")
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawMeds = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : Array.isArray(data.medicines)
      ? (data.medicines as Record<string, unknown>[])
      : [];

    return rawMeds.map((m) => {
      const name = String(m.brand_name ?? m.medicine_name ?? "Medicine");
      const freq = String(m.dosage_pattern ?? m.frequency_code ?? "1-0-0");
      const rawSlots = Array.isArray(m.schedule_slots)
        ? (m.schedule_slots as Record<string, unknown>[])
        : [];
      const slots: ScheduledSlot[] =
        rawSlots.length > 0
          ? rawSlots.map((s) => {
              const slotKey = toFrontendSlot(s.slot);
              return {
                slot: slotKey,
                time_label: String(s.time ?? SLOT_TIME_LABELS[slotKey]),
                dose_count: Number(s.dose_qty ?? 1),
              };
            })
          : parseFrequencyToSlots(freq);
      const confidence =
        typeof m.confidence === "number" ? m.confidence : 0.95;

      return {
        id: String(m.id ?? `ver-${Date.now()}`),
        share_code: String(data.share_code ?? normalizedCode),
        medicine_name: name,
        dosage: String(m.strength ?? m.dosage ?? "1 tablet"),
        frequency_code: freq,
        slots,
        meal_relation: normalizeMealRelation(m.meal_relation),
        duration_days:
          typeof m.duration_days === "number"
            ? `${m.duration_days} days`
            : "Ongoing",
        ai_accuracy: normalizeAccuracy(undefined, confidence),
        confidence_score: confidence,
        ai_accuracy_reason: "Verified by caregiver.",
        caregiver_verified: true,
        verified_at: String(m.created_at ?? new Date().toISOString()),
        verified_by: payload.verified_by || "Primary Caregiver",
        pill_appearance: String(m.dosage_form ?? "Standard blister strip"),
        simple_explanation_en: String(m.instructions_en ?? ""),
        simple_explanation_hi: String(m.instructions_hi ?? ""),
        simple_explanation_mr: String(m.instructions_mr ?? ""),
        strip_image_url: String(
          m.strip_thumbnail || guessStripAsset(name, String(m.dosage_form ?? ""))
        ),
        taken_slots_today: [],
        doctor_or_clinic: m.prescribed_by ? String(m.prescribed_by) : payload.doctor_or_clinic,
      };
    });
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
    const [scheduleRes, profileRes] = await Promise.all([
      fetch(`${FASTAPI_BASE_URL}/schedule/${encodeURIComponent(normalizedCode)}`),
      fetch(`${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}`).catch(
        () => null
      ),
    ]);

    if (!scheduleRes.ok) {
      throw new Error(`Could not load schedule for share code ${normalizedCode}.`);
    }

    const raw = (await scheduleRes.json()) as Record<string, unknown>;
    const profileRaw =
      profileRes && profileRes.ok
        ? ((await profileRes.json().catch(() => ({}))) as Record<string, unknown>)
        : {};

    const fallbackContact = loadEmergencyContact();
    const caregiverName = String(
      profileRaw.caregiver_name ?? raw.caregiver_name ?? fallbackContact.name
    );
    const caregiverPhone = String(
      profileRaw.caregiver_phone ?? fallbackContact.phone
    );
    const emergencyContact: EmergencyContact = {
      name: caregiverName,
      relation: fallbackContact.relation,
      phone: caregiverPhone,
      whatsapp_phone: caregiverPhone.replace(/\D/g, "") || fallbackContact.whatsapp_phone,
    };

    if (Array.isArray(raw.medicines)) {
      return {
        share_code: String(raw.share_code ?? normalizedCode),
        patient_name: String(raw.patient_name ?? raw.elder_name ?? "Nani"),
        caregiver_name: caregiverName,
        emergency_contact: emergencyContact,
        medicines: (raw.medicines as VerifiedMedicine[]).filter((m) =>
          Boolean(m.caregiver_verified)
        ),
      };
    }

    const allCards = [
      ...(Array.isArray(raw.cards) ? (raw.cards as Record<string, unknown>[]) : []),
      ...(Array.isArray(raw.as_needed_cards)
        ? (raw.as_needed_cards as Record<string, unknown>[])
        : []),
    ];

    const grouped = new Map<string, VerifiedMedicine>();
    for (const card of allCards) {
      const medId = String(card.medicine_id ?? "");
      if (!medId) continue;

      const slotKey = toFrontendSlot(card.scheduled_slot);
      const slotEntry: ScheduledSlot = {
        slot: slotKey,
        time_label: String(card.scheduled_time ?? SLOT_TIME_LABELS[slotKey]),
        dose_count: Number(card.dose_qty ?? 1),
      };
      const isTaken = String(card.status ?? "").toLowerCase() === "taken";

      const existing = grouped.get(medId);
      if (existing) {
        if (!existing.slots.some((s) => s.slot === slotKey)) {
          existing.slots.push(slotEntry);
        }
        if (isTaken && !existing.taken_slots_today.includes(slotKey)) {
          existing.taken_slots_today.push(slotKey);
        }
        continue;
      }

      const name = String(card.brand_name ?? "Medicine");
      const dosageForm = String(card.dosage_form ?? "tablet");
      grouped.set(medId, {
        id: medId,
        share_code: String(raw.share_code ?? normalizedCode),
        medicine_name: name,
        dosage: String(card.strength ?? "1 tablet"),
        frequency_code: String(card.dosage_pattern ?? "OD"),
        slots: [slotEntry],
        meal_relation: normalizeMealRelation(card.meal_relation),
        duration_days: "Ongoing",
        ai_accuracy: "High",
        confidence_score: 0.95,
        ai_accuracy_reason: "Verified by caregiver.",
        caregiver_verified: true,
        verified_at: new Date().toISOString(),
        verified_by: caregiverName,
        pill_appearance: `Standard ${dosageForm} strip`,
        simple_explanation_en: String(card.instructions_en ?? ""),
        simple_explanation_hi: String(card.instructions_hi ?? ""),
        simple_explanation_mr: String(card.instructions_mr ?? ""),
        strip_image_url: String(
          card.strip_thumbnail || guessStripAsset(name, dosageForm)
        ),
        taken_slots_today: isTaken ? [slotKey] : [],
      });
    }

    return {
      share_code: String(raw.share_code ?? normalizedCode),
      patient_name: String(raw.elder_name ?? raw.patient_name ?? "Nani"),
      caregiver_name: caregiverName,
      emergency_contact: emergencyContact,
      medicines: Array.from(grouped.values()),
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
    const parsedId = Number.parseInt(req.medicine_id, 10);
    const response = await fetch(`${FASTAPI_BASE_URL}/doses/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        share_code: req.share_code.trim().toUpperCase(),
        medicine_id: Number.isFinite(parsedId) ? parsedId : req.medicine_id,
        scheduled_slot: req.slot.toLowerCase(),
        status: req.taken ? "taken" : "skipped",
        marked_by: "nani",
      }),
    });
    if (!response.ok) {
      throw new Error("Could not update dose status.");
    }
    await response.json();
    return {
      ok: true,
      medicine_id: req.medicine_id,
      slot: req.slot,
      taken: req.taken,
    };
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
    const normalizedCode = req.share_code.trim().toUpperCase();
    const response = await fetch(`${FASTAPI_BASE_URL}/vitals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        share_code: normalizedCode,
        temperature_f: req.temperature_f,
        systolic_mmhg: req.bp_systolic,
        diastolic_mmhg: req.bp_diastolic,
        weight_kg: req.weight_kg,
        notes: req.notes?.trim() || undefined,
      }),
    });
    if (!response.ok) {
      throw new Error("Could not save vitals reading.");
    }
    const raw = (await response.json()) as Record<string, unknown>;
    return mapBackendVital(raw, normalizedCode);
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
    const [summaryRes, schedule, vitalsRes] = await Promise.all([
      fetch(
        `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}/summary`
      ),
      fetchSchedule(normalizedCode),
      fetch(`${FASTAPI_BASE_URL}/vitals/${encodeURIComponent(normalizedCode)}`).catch(
        () => null
      ),
    ]);
    if (!summaryRes.ok) {
      throw new Error(`Could not load summary for ${normalizedCode}.`);
    }
    const raw = (await summaryRes.json()) as Record<string, unknown>;
    const vitalsPayload =
      vitalsRes && vitalsRes.ok
        ? ((await vitalsRes.json().catch(() => ({}))) as Record<string, unknown>)
        : {};
    const rawVitals = Array.isArray(vitalsPayload.vitals)
      ? (vitalsPayload.vitals as Record<string, unknown>[])
      : [];

    return {
      share_code: String(raw.share_code ?? normalizedCode),
      patient_name: String(raw.elder_name ?? raw.patient_name ?? schedule.patient_name),
      generated_at: String(
        raw.generated_at ?? raw.generated_at_ist ?? new Date().toISOString()
      ),
      adherence_taken: Number(raw.doses_taken ?? raw.adherence_taken ?? 0),
      adherence_total: Number(raw.doses_total ?? raw.adherence_total ?? 0),
      adherence_percent: Math.round(Number(raw.adherence_percent ?? 0)),
      medicines: schedule.medicines,
      vitals: rawVitals.map((v) => mapBackendVital(v, normalizedCode)),
      emergency_contact: schedule.emergency_contact,
      summary_text: String(raw.whatsapp_message ?? raw.summary_text ?? ""),
      whatsapp_url: String(raw.whatsapp_url ?? ""),
    };
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
