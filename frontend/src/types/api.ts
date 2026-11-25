export type AppRoute = "select" | "caregiver" | "nani" | "vitals";
export type ThemeMode = "light" | "dark";
export type LanguageCode = "en" | "hi" | "mr";
export type AccuracyLevel = "High" | "Medium" | "Low";
export type TimeSlotKey = "Morning" | "Afternoon" | "Night";
export type MealRelation = "Before Food" | "After Food" | "With Food" | "Anytime";

export interface ScheduledSlot {
  slot: TimeSlotKey;
  backend_slot?: string;
  time_label: string;
  dose_count: number;
}

export interface SafetyFlagSummary {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message_en: string;
  message_hi?: string;
  message_mr?: string;
  affected_medicines: string[];
}

/**
 * Mirrors backend/schemas.py scanned medicine candidate returned by POST /scan
 */
export interface ScannedMedicineCandidate {
  id: string;
  medicine_name: string;
  dosage: string;
  frequency_code: string;
  meal_relation: MealRelation;
  duration_days: string;
  ai_accuracy: AccuracyLevel;
  confidence_score: number;
  needs_review: boolean;
  ai_accuracy_reason: string;
  pill_appearance: string;
  simple_explanation_en: string;
  simple_explanation_hi: string;
  simple_explanation_mr: string;
  strip_image_url: string;
  manually_verified: boolean;
  highlight_color?: "none" | "yellow" | "red";
}

export interface ScanPrescriptionResponse {
  document_type: string;
  doctor_or_clinic: string;
  general_warning: string;
  medicines: ScannedMedicineCandidate[];
  regimen_safety_flags?: SafetyFlagSummary[];
}

/**
 * Mirrors confirmed Medicine + DoseLog state returned by GET /schedule/{share_code}
 */
export interface VerifiedMedicine {
  id: string;
  share_code: string;
  medicine_name: string;
  dosage: string;
  frequency_code: string;
  slots: ScheduledSlot[];
  meal_relation: MealRelation;
  duration_days: string;
  ai_accuracy: AccuracyLevel;
  confidence_score: number;
  ai_accuracy_reason: string;
  caregiver_verified: true;
  verified_at: string;
  verified_by: string;
  pill_appearance: string;
  simple_explanation_en: string;
  simple_explanation_hi: string;
  simple_explanation_mr: string;
  strip_image_url: string;
  taken_slots_today: TimeSlotKey[];
  doctor_or_clinic?: string;
}

export interface ConfirmMedicinesRequest {
  share_code: string;
  verified_by: string;
  doctor_or_clinic?: string;
  replace_existing?: boolean;
  medicines: ScannedMedicineCandidate[];
}

export interface ProfileInfo {
  share_code: string;
  elder_name: string;
  age?: number | null;
  preferred_language: LanguageCode;
  caregiver_name?: string | null;
  caregiver_phone?: string | null;
  active_medicine_count: number;
}

export interface ScheduleResponse {
  share_code: string;
  patient_name: string;
  caregiver_name: string;
  emergency_contact: EmergencyContact;
  medicines: VerifiedMedicine[];
}

export interface MarkDoseRequest {
  share_code: string;
  medicine_id: string;
  slot: TimeSlotKey;
  backend_slot?: string;
  taken: boolean;
}

export interface MarkDoseResponse {
  ok: boolean;
  medicine_id: string;
  slot: TimeSlotKey;
  taken: boolean;
}

/**
 * Mirrors backend/models.py VitalLog + POST /vitals payload
 */
export interface VitalLogEntry {
  id: string;
  share_code: string;
  recorded_at: string;
  temperature_f: number;
  bp_systolic: number;
  bp_diastolic: number;
  weight_kg: number;
  pulse_bpm?: number;
  spo2_percent?: number;
  blood_sugar_mgdl?: number;
  notes?: string;
  flagged?: boolean;
  flag_reason?: string;
}

export interface CreateVitalRequest {
  share_code: string;
  temperature_f: number;
  bp_systolic: number;
  bp_diastolic: number;
  weight_kg: number;
  pulse_bpm?: number;
  spo2_percent?: number;
  blood_sugar_mgdl?: number;
  notes?: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
  whatsapp_phone: string;
}

/**
 * Mirrors GET /profile/{share_code}/summary
 */
export interface ProfileSummaryResponse {
  share_code: string;
  patient_name: string;
  generated_at: string;
  adherence_taken: number;
  adherence_total: number;
  adherence_percent: number;
  medicines: VerifiedMedicine[];
  vitals: VitalLogEntry[];
  emergency_contact: EmergencyContact;
  summary_text: string;
  whatsapp_url: string;
}
