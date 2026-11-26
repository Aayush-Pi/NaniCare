import {
  DEFAULT_SHARE_CODE,
  GENERATED_ASSETS,
  INITIAL_VERIFIED_MEDICINES,
  INITIAL_VITALS,
  VITALS_RANGES,
} from "../config";
import devMockData from "../mocks/devMockData.json";
import {
  AccuracyLevel,
  ConfirmMedicinesRequest,
  CreateVitalRequest,
  EmergencyContact,
  LanguageCode,
  MarkDoseRequest,
  MarkDoseResponse,
  MealRelation,
  ProfileInfo,
  ProfileSummaryResponse,
  RefillStatusItem,
  SafetyFlagSummary,
  ScannedMedicineCandidate,
  ScanPrescriptionResponse,
  ScheduledSlot,
  ScheduleResponse,
  StripVerifyResult,
  TimeSlotKey,
  TrendsResponse,
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

const FASTAPI_BASE_URL = (import.meta.env?.VITE_API_URL || "").trim().replace(/\/+$/, "");
const USE_MOCK_DATA =
  String(import.meta.env?.VITE_USE_MOCK_DATA || "").trim().toLowerCase() === "true";

export function getApiMode(): { connectedToFastApi: boolean; baseUrl: string } {
  if (FASTAPI_BASE_URL) {
    return {
      connectedToFastApi: true,
      baseUrl: FASTAPI_BASE_URL,
    };
  }
  return {
    connectedToFastApi: false,
    baseUrl: USE_MOCK_DATA ? "Mock JSON (devMockData.json)" : "/api (Built-in Preview)",
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
    pulse_bpm: typeof raw.pulse_bpm === "number" ? raw.pulse_bpm : undefined,
    spo2_percent: typeof raw.spo2_percent === "number" ? raw.spo2_percent : undefined,
    blood_sugar_mgdl:
      typeof raw.blood_sugar_mgdl === "number" ? raw.blood_sugar_mgdl : undefined,
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
    highlight_color:
      raw.highlight_color === "red" || raw.highlight_color === "yellow"
        ? raw.highlight_color
        : needsReview
        ? "yellow"
        : "none",
  };
}

/**
 * POST /scan
 * Targets FastAPI `${VITE_API_URL}/scan` when configured, or falls back to
 * the built-in `/api/scan` Gemini Vision endpoint.
 */
async function fetchScan(formData: FormData): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    return await fetch(`${FASTAPI_BASE_URL}/scan`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("The scan is taking too long. Please check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
      response = await fetchScan(formData);
    } else {
      const blobRes = await fetch(params.imageBase64);
      const blob = await blobRes.blob();
      const formData = new FormData();
      formData.append("file", blob, "prescription.jpg");
      response = await fetchScan(formData);
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

    const regimenFlags: SafetyFlagSummary[] = Array.isArray(payload.regimen_safety_flags)
      ? (payload.regimen_safety_flags as SafetyFlagSummary[])
      : [];

    return {
      document_type: String(payload.document_type ?? payload.source_type ?? "Prescription"),
      doctor_or_clinic: String(payload.doctor_or_clinic ?? doctorOrClinic),
      general_warning: String(payload.general_warning ?? warnings),
      medicines: rawMeds.map((m, idx) =>
        mapRawScannedMedicine(m, idx, params.overrideStripPhoto)
      ),
      regimen_safety_flags: regimenFlags,
    };
  }

  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const isStrip =
      Boolean(params.overrideStripPhoto) ||
      (params.scanHint || "").toLowerCase().includes("strip");
    const mockPayload = isStrip
      ? devMockData.scan_responses.strip
      : devMockData.scan_responses.prescription;

    return {
      document_type: mockPayload.document_type,
      doctor_or_clinic: mockPayload.doctor_or_clinic,
      general_warning: mockPayload.general_warning,
      medicines: mockPayload.medicines.map((m, idx) =>
        mapRawScannedMedicine(
          m as unknown as Record<string, unknown>,
          idx,
          params.overrideStripPhoto
        )
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
        replace_existing: Boolean(payload.replace_existing),
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
                backend_slot: String(s.slot ?? slotKey.toLowerCase()),
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
  const base = payload.replace_existing
    ? existing.filter((m) => m.share_code !== normalizedCode)
    : existing;
  saveAllStoredMedicines([...created, ...base]);
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
        patient_name: String(raw.patient_name ?? raw.elder_name ?? "Family Member"),
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
        backend_slot: String(card.scheduled_slot ?? slotKey.toLowerCase()),
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
      patient_name: String(raw.elder_name ?? raw.patient_name ?? "Family Member"),
      caregiver_name: caregiverName,
      emergency_contact: emergencyContact,
      medicines: Array.from(grouped.values()),
    };
  }

  const emergency = loadEmergencyContact();
  return {
    share_code: normalizedCode,
    patient_name: "Family Member",
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
        scheduled_slot: (req.backend_slot || req.slot).toLowerCase(),
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
 * DELETE /profile/{share_code}/medicines
 * Flushes all active medicines for a share_code so the caregiver can start fresh.
 */
export async function flushMedicines(shareCode: string): Promise<number> {
  const normalizedCode = shareCode.trim().toUpperCase();
  let deactivatedCount = 0;

  if (FASTAPI_BASE_URL) {
    const response = await fetch(
      `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}/medicines`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      throw new Error(`Could not flush schedule for ${normalizedCode}.`);
    }
    const data = (await response.json()) as { deactivated_count?: number };
    deactivatedCount = Number(data.deactivated_count ?? 0);
  }

  const all = loadAllStoredMedicines();
  const remaining = all.filter((m) => m.share_code !== normalizedCode);
  if (!FASTAPI_BASE_URL) {
    deactivatedCount = all.length - remaining.length;
  }
  saveAllStoredMedicines(remaining);
  return deactivatedCount;
}

/**
 * POST /demo/seed?reset=true
 * Restores DEMO01 back to the clean 5-medicine demo state.
 */
export async function resetDemoProfile(): Promise<void> {
  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/demo/seed?reset=true`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Could not reset DEMO01 on backend.");
    }
  }

  const otherMeds = loadAllStoredMedicines().filter(
    (m) => m.share_code !== DEFAULT_SHARE_CODE
  );
  saveAllStoredMedicines([...INITIAL_VERIFIED_MEDICINES, ...otherMeds]);

  const otherVitals = loadAllStoredVitals().filter(
    (v) => v.share_code !== DEFAULT_SHARE_CODE
  );
  saveAllStoredVitals([...INITIAL_VITALS, ...otherVitals]);
}

/**
 * GET /profiles
 */
export async function listProfiles(): Promise<ProfileInfo[]> {
  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/profiles`);
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>[];
      return data.map((p) => ({
        share_code: String(p.share_code ?? DEFAULT_SHARE_CODE),
        elder_name: String(p.elder_name ?? "Family Member"),
        age: typeof p.age === "number" ? p.age : null,
        preferred_language: (p.preferred_language as LanguageCode) || "hi",
        caregiver_name: p.caregiver_name ? String(p.caregiver_name) : null,
        caregiver_phone: p.caregiver_phone ? String(p.caregiver_phone) : null,
        active_medicine_count: Number(p.active_medicine_count ?? 0),
      }));
    }
  }

  const meds = loadAllStoredMedicines();
  const counts = new Map<string, number>();
  for (const m of meds) {
    counts.set(m.share_code, (counts.get(m.share_code) ?? 0) + 1);
  }
  if (!counts.has(DEFAULT_SHARE_CODE)) {
    counts.set(DEFAULT_SHARE_CODE, 0);
  }
  return Array.from(counts.entries()).map(([code, count]) => ({
    share_code: code,
    elder_name: code === DEFAULT_SHARE_CODE ? "Kamla Sharma" : `Profile ${code}`,
    preferred_language: "hi",
    active_medicine_count: count,
  }));
}

/**
 * POST /profile
 */
export async function createProfile(req: {
  share_code?: string;
  elder_name: string;
  age?: number;
  preferred_language: LanguageCode;
  caregiver_name?: string;
  caregiver_phone?: string;
}): Promise<ProfileInfo> {
  if (FASTAPI_BASE_URL) {
    const response = await fetch(`${FASTAPI_BASE_URL}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        share_code: req.share_code?.trim().toUpperCase() || undefined,
        elder_name: req.elder_name.trim(),
        age: req.age || undefined,
        preferred_language: req.preferred_language,
        caregiver_name: req.caregiver_name?.trim() || undefined,
        caregiver_phone: req.caregiver_phone?.trim() || undefined,
      }),
    });
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(String(err.detail ?? "Could not create profile."));
    }
    const p = (await response.json()) as Record<string, unknown>;
    return {
      share_code: String(p.share_code),
      elder_name: String(p.elder_name),
      age: typeof p.age === "number" ? p.age : null,
      preferred_language: (p.preferred_language as LanguageCode) || req.preferred_language,
      caregiver_name: p.caregiver_name ? String(p.caregiver_name) : null,
      caregiver_phone: p.caregiver_phone ? String(p.caregiver_phone) : null,
      active_medicine_count: Number(p.active_medicine_count ?? 0),
    };
  }

  const randomCode =
    req.share_code?.trim().toUpperCase() ||
    `CARE${Math.floor(10 + Math.random() * 89)}`;
  return {
    share_code: randomCode,
    elder_name: req.elder_name.trim(),
    age: req.age ?? null,
    preferred_language: req.preferred_language,
    caregiver_name: req.caregiver_name?.trim() || null,
    caregiver_phone: req.caregiver_phone?.trim() || null,
    active_medicine_count: 0,
  };
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
        pulse_bpm: req.pulse_bpm,
        spo2_percent: req.spo2_percent,
        blood_sugar_mgdl: req.blood_sugar_mgdl,
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
    pulse_bpm: req.pulse_bpm,
    spo2_percent: req.spo2_percent,
    blood_sugar_mgdl: req.blood_sugar_mgdl,
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
  if (FASTAPI_BASE_URL) {
    const response = await fetch(
      `${FASTAPI_BASE_URL}/vitals/${encodeURIComponent(vitalId)}`,
      { method: "DELETE" }
    );
    if (!response.ok && response.status !== 404) {
      throw new Error("Could not delete vital entry on backend.");
    }
  }
  const remaining = loadAllStoredVitals().filter((v) => v.id !== vitalId);
  saveAllStoredVitals(remaining);
}

/**
 * GET /health
 */
export async function checkBackendHealth(): Promise<{
  connected: boolean;
  label: string;
}> {
  if (!FASTAPI_BASE_URL) {
    return {
      connected: false,
      label: USE_MOCK_DATA ? "Offline Mock" : "Preview Mode",
    };
  }
  try {
    const res = await fetch(`${FASTAPI_BASE_URL}/health`);
    if (res.ok) {
      const data = (await res.json()) as { database_backend?: string };
      const dbName = data.database_backend === "postgresql" ? "Neon" : "SQLite";
      return { connected: true, label: `FastAPI · ${dbName}` };
    }
  } catch {
    // Some privacy extensions block /health on third-party origins; verify via root endpoint
  }

  try {
    const fallbackRes = await fetch(`${FASTAPI_BASE_URL}/`);
    if (fallbackRes.ok) {
      return { connected: true, label: "FastAPI Connected" };
    }
  } catch {
    // Backend genuinely unreachable
  }
  return { connected: false, label: "FastAPI Offline" };
}

/**
 * POST /profile
 * Persists caregiver emergency contact details onto the elder profile in FastAPI.
 */
export async function saveProfileContact(
  shareCode: string,
  contact: EmergencyContact
): Promise<void> {
  if (!FASTAPI_BASE_URL) return;
  const normalizedCode = shareCode.trim().toUpperCase();
  let elderName = "Family Member";
  let preferredLang: LanguageCode = "hi";
  try {
    const existingRes = await fetch(
      `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}`
    );
    if (existingRes.ok) {
      const existing = (await existingRes.json()) as Record<string, unknown>;
      if (existing.elder_name) elderName = String(existing.elder_name);
      if (
        existing.preferred_language === "en" ||
        existing.preferred_language === "hi" ||
        existing.preferred_language === "mr"
      ) {
        preferredLang = existing.preferred_language;
      }
    }
  } catch {
    // Use safe defaults if profile doesn't exist yet
  }

  await fetch(`${FASTAPI_BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      share_code: normalizedCode,
      elder_name: elderName,
      preferred_language: preferredLang,
      caregiver_name: contact.name,
      caregiver_phone: contact.phone,
    }),
  }).catch(() => undefined);
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
      refill_alerts: Array.isArray(raw.refill_alerts)
        ? raw.refill_alerts.map((r) => String(r)).filter(Boolean)
        : [],
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
    patient_name: "Family Member",
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
    refill_alerts: [],
  };
}

/**
 * POST /scan/verify-strip
 * Matches a photographed blister strip against the elder's active verified schedule.
 */
export async function verifyMedicineStrip(params: {
  shareCode: string;
  file: File;
}): Promise<StripVerifyResult> {
  const normalizedCode = params.shareCode.trim().toUpperCase();
  if (FASTAPI_BASE_URL) {
    const formData = new FormData();
    formData.append("share_code", normalizedCode);
    formData.append("file", params.file);
    const response = await fetch(`${FASTAPI_BASE_URL}/scan/verify-strip`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error("Could not verify medicine strip. Please try again.");
    }
    return (await response.json()) as StripVerifyResult;
  }

  return {
    share_code: normalizedCode,
    matched: false,
    confidence: 0,
    spoken_en: "Connect the backend server to verify medicine strips with camera.",
    spoken_hi: "कैमरे से दवाई जांचने के लिए बैकएंड सर्वर कनेक्ट करें।",
    spoken_mr: "कॅमेऱ्याने औषध तपासण्यासाठी बॅकएंड सर्व्हर कनेक्ट करा.",
    warning: "Backend API not connected.",
  };
}

/**
 * GET /profile/{share_code}/refills
 */
export async function fetchRefills(shareCode: string): Promise<RefillStatusItem[]> {
  const normalizedCode = shareCode.trim().toUpperCase();
  if (!FASTAPI_BASE_URL) return [];
  try {
    const res = await fetch(
      `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}/refills`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: RefillStatusItem[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/**
 * GET /profile/{share_code}/trends
 * Returns 7-day adherence history, or null when the backend is not connected.
 */
export async function fetchTrends(
  shareCode: string,
  days = 7
): Promise<TrendsResponse | null> {
  const normalizedCode = shareCode.trim().toUpperCase();
  if (!FASTAPI_BASE_URL) return null;
  try {
    const res = await fetch(
      `${FASTAPI_BASE_URL}/profile/${encodeURIComponent(normalizedCode)}/trends?days=${days}`
    );
    if (!res.ok) return null;
    return (await res.json()) as TrendsResponse;
  } catch {
    return null;
  }
}
