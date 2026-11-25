"""Strict Pydantic v2 schemas for Gemini Structured Output and FastAPI I/O."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LanguageCode = Literal["hi", "mr", "en"]
MealRelation = Literal[
    "empty_stomach", "before_food", "after_food", "with_food", "anytime"
]
DosageForm = Literal[
    "tablet", "capsule", "syrup", "drops", "injection", "inhaler", "ointment", "other"
]
SlotName = Literal["empty_stomach", "morning", "afternoon", "evening", "night", "sos"]
DoseStatus = Literal["taken", "skipped", "snoozed", "missed", "due_now", "upcoming"]
SeverityLevel = Literal["info", "warning", "critical"]
VitalStatus = Literal["normal", "caution", "critical"]


# =============================================================================
# 1. Gemini Vision Structured Output Schemas (kept flat/strict for response_schema)
# =============================================================================


class ExtractedMedicineRaw(BaseModel):
    """Single medicine extracted directly by Gemini Vision from a prescription or strip."""

    brand_name: str = Field(
        ...,
        description="Printed or handwritten medicine brand name, e.g. 'Glycomet-500' or 'Dolo 650'.",
    )
    generic_name: str | None = Field(
        default=None,
        description="Active salt / generic molecule if readable or unambiguous, e.g. 'Metformin Hydrochloride'.",
    )
    strength: str | None = Field(
        default=None,
        description="Strength per unit such as '500 mg', '5 mg', '650 mg', '100 mcg'.",
    )
    dosage_form: DosageForm = Field(
        default="tablet",
        description="Dosage form: tablet, capsule, syrup, drops, injection, inhaler, ointment, or other.",
    )
    dosage_pattern: str = Field(
        default="OD",
        description="Indian shorthand frequency like '1-0-1', '1-1-1', 'OD', 'BD', 'TDS', 'HS', or 'SOS'.",
    )
    meal_relation: MealRelation = Field(
        default="after_food",
        description="Relation to food: empty_stomach, before_food, after_food, with_food, or anytime.",
    )
    duration_days: int | None = Field(
        default=None,
        description="Number of days prescribed if written (e.g. 5, 14, 30).",
    )
    frequency_notes: str | None = Field(
        default=None,
        description="Any extra doctor instruction such as 'for fever > 100F' or 'take with warm water'.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Honest extraction confidence from 0.0 to 1.0. Use < 0.80 whenever handwriting or print is blurry/ambiguous.",
    )
    low_confidence_fields: list[str] = Field(
        default_factory=list,
        description="Field names requiring caregiver verification (e.g. ['strength', 'dosage_pattern']).",
    )
    raw_line_text: str | None = Field(
        default=None,
        description="Best-effort raw transcription of the prescription line or strip label.",
    )


class PrescriptionExtractionOutput(BaseModel):
    """Top-level Gemini Vision structured JSON output schema."""

    source_type: Literal["prescription", "blister_strip", "medicine_bottle", "unknown"] = Field(
        default="prescription",
        description="Detected photo type.",
    )
    doctor_name: str | None = Field(default=None, description="Doctor name if visible.")
    clinic_name: str | None = Field(default=None, description="Clinic or hospital name if visible.")
    patient_name: str | None = Field(default=None, description="Patient name if visible.")
    prescription_date: str | None = Field(
        default=None, description="Date written on prescription (YYYY-MM-DD or as written)."
    )
    diagnosis_notes: str | None = Field(
        default=None, description="Brief diagnosis or chief complaint if written."
    )
    overall_confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Overall confidence across the entire image.",
    )
    medicines: list[ExtractedMedicineRaw] = Field(
        default_factory=list,
        description="All medicines detected in the image.",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Image quality warnings (e.g. glare, cropped corner, smeared ink).",
    )


# =============================================================================
# 2. Deterministic Schedule, Safety & Scan API Schemas
# =============================================================================


class ScheduleSlot(BaseModel):
    """Single Indian meal-aligned daily medication slot."""

    slot: SlotName
    time: str = Field(..., description="24-hour IST time HH:MM, e.g. '08:30'.")
    dose_qty: float = Field(default=1.0, ge=0.25, le=10.0)
    label_en: str
    label_hi: str
    label_mr: str
    color_hex: str


class SafetyFlag(BaseModel):
    """Deterministic clinical or OCR safety warning surfaced to caregivers."""

    code: str
    severity: SeverityLevel
    title: str
    message_en: str
    message_hi: str
    message_mr: str
    affected_medicines: list[str] = Field(default_factory=list)


class EnrichedScannedMedicine(BaseModel):
    """AI-extracted medicine enriched by deterministic Indian scheduler & safety checks."""

    brand_name: str
    generic_name: str | None = None
    strength: str | None = None
    dosage_form: DosageForm = "tablet"
    dosage_pattern: str = "OD"
    meal_relation: MealRelation = "after_food"
    duration_days: int | None = None
    as_needed: bool = False
    schedule_slots: list[ScheduleSlot] = Field(default_factory=list)
    instructions_en: str
    instructions_hi: str
    instructions_mr: str
    pill_color_tag: str = "#2563EB"
    strip_thumbnail: str | None = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    needs_review: bool = False
    highlight_color: Literal["none", "yellow", "red"] = "none"
    low_confidence_fields: list[str] = Field(default_factory=list)
    safety_flags: list[SafetyFlag] = Field(default_factory=list)
    raw_line_text: str | None = None


class ScanResponse(BaseModel):
    """Response returned by POST /scan and GET /scan/demo for Caregiver Mode review."""

    source: Literal["gemini_vision", "demo_fallback"]
    model_used: str
    source_type: str
    doctor_name: str | None = None
    clinic_name: str | None = None
    patient_name: str | None = None
    prescription_date: str | None = None
    diagnosis_notes: str | None = None
    overall_confidence: float
    needs_caregiver_review: bool
    low_confidence_count: int
    strip_thumbnail: str | None = None
    medicines: list[EnrichedScannedMedicine]
    regimen_safety_flags: list[SafetyFlag] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# =============================================================================
# 3. Profile & Medicine Confirmation Schemas
# =============================================================================


class ProfileCreateRequest(BaseModel):
    """Create or update an elder profile."""

    share_code: str | None = Field(
        default=None,
        min_length=4,
        max_length=12,
        description="Optional custom 6-char share code; auto-generated if omitted.",
    )
    elder_name: str = Field(..., min_length=1, max_length=120)
    age: int | None = Field(default=None, ge=1, le=120)
    preferred_language: LanguageCode = "hi"
    caregiver_name: str | None = Field(default=None, max_length=120)
    caregiver_phone: str | None = Field(default=None, max_length=24)
    known_allergies: list[str] = Field(default_factory=list)

    @field_validator("share_code")
    @classmethod
    def normalize_share_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().upper()
        if not cleaned.isalnum():
            raise ValueError("share_code must be alphanumeric")
        return cleaned


class ProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    share_code: str
    elder_name: str
    age: int | None = None
    preferred_language: str
    caregiver_name: str | None = None
    caregiver_phone: str | None = None
    known_allergies: list[str] = Field(default_factory=list)
    active_medicine_count: int = 0
    created_at: datetime
    updated_at: datetime


class MedicineConfirmItem(BaseModel):
    """Single caregiver-verified medicine item submitted to POST /medicines/confirm."""

    brand_name: str = Field(..., min_length=1, max_length=160)
    generic_name: str | None = Field(default=None, max_length=160)
    strength: str | None = Field(default=None, max_length=64)
    dosage_form: DosageForm = "tablet"
    dosage_pattern: str = Field(default="OD", min_length=1, max_length=32)
    meal_relation: MealRelation = "after_food"
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    instructions_en: str | None = None
    instructions_hi: str | None = None
    instructions_mr: str | None = None
    strip_thumbnail: str | None = None
    pill_color_tag: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    prescribed_by: str | None = Field(default=None, max_length=120)


class MedicineUpdateRequest(BaseModel):
    """Partial update payload for PATCH /medicines/{medicine_id}."""

    brand_name: str | None = Field(default=None, min_length=1, max_length=160)
    generic_name: str | None = Field(default=None, max_length=160)
    strength: str | None = Field(default=None, max_length=64)
    dosage_form: DosageForm | None = None
    dosage_pattern: str | None = Field(default=None, min_length=1, max_length=32)
    meal_relation: MealRelation | None = None
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    instructions_en: str | None = None
    instructions_hi: str | None = None
    instructions_mr: str | None = None
    strip_thumbnail: str | None = None
    pill_color_tag: str | None = None
    prescribed_by: str | None = Field(default=None, max_length=120)


class MedicinesConfirmRequest(BaseModel):
    """Batch confirmation payload from Caregiver Mode to persist verified medicines."""

    share_code: str = Field(default="DEMO01", min_length=4, max_length=12)
    elder_name: str | None = Field(default=None, max_length=120)
    preferred_language: LanguageCode | None = None
    caregiver_name: str | None = Field(default=None, max_length=120)
    caregiver_phone: str | None = Field(default=None, max_length=24)
    prescribed_by: str | None = Field(default=None, max_length=120)
    replace_existing: bool = Field(
        default=False,
        description="If true, deactivates previously active medicines before saving new ones.",
    )
    medicines: list[MedicineConfirmItem] = Field(..., min_length=1)

    @field_validator("share_code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if not cleaned.isalnum():
            raise ValueError("share_code must be alphanumeric")
        return cleaned


class MedicineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    brand_name: str
    generic_name: str | None = None
    strength: str | None = None
    dosage_form: str
    dosage_pattern: str
    meal_relation: str
    schedule_slots: list[ScheduleSlot] = Field(default_factory=list)
    duration_days: int | None = None
    as_needed: bool
    instructions_en: str | None = None
    instructions_hi: str | None = None
    instructions_mr: str | None = None
    strip_thumbnail: str | None = None
    pill_color_tag: str
    confidence: float
    needs_review: bool
    safety_flags: list[SafetyFlag] = Field(default_factory=list)
    verified_by_caregiver: bool
    is_active: bool
    prescribed_by: str | None = None
    created_at: datetime


class MedicinesConfirmResponse(BaseModel):
    share_code: str
    elder_name: str
    saved_count: int
    medicines: list[MedicineResponse]
    regimen_safety_flags: list[SafetyFlag] = Field(default_factory=list)


class MedicinesFlushResponse(BaseModel):
    flushed: bool
    share_code: str
    deactivated_count: int


# =============================================================================
# 4. Nani Mode Schedule & Dose Marking Schemas
# =============================================================================


class DoseMarkRequest(BaseModel):
    """Mark a specific scheduled dose as taken, skipped, or snoozed."""

    share_code: str = Field(default="DEMO01", min_length=4, max_length=12)
    medicine_id: int = Field(..., ge=1)
    scheduled_slot: SlotName
    scheduled_time: str | None = Field(
        default=None, description="Optional HH:MM override; inferred from medicine slot if omitted."
    )
    dose_date: date | None = Field(
        default=None, description="IST calendar date YYYY-MM-DD; defaults to today IST."
    )
    status: Literal["taken", "skipped", "snoozed"] = "taken"
    marked_by: Literal["nani", "caregiver"] = "nani"
    notes: str | None = Field(default=None, max_length=300)

    @field_validator("share_code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()


class DoseLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    medicine_id: int
    brand_name: str | None = None
    dose_date: date
    scheduled_slot: str
    scheduled_time: str
    status: str
    taken_at: datetime | None = None
    marked_by: str
    notes: str | None = None


class NaniScheduleCard(BaseModel):
    """High-contrast card ready for Nani Mode UI + Web Speech / TTS audio playback."""

    medicine_id: int
    brand_name: str
    generic_name: str | None = None
    strength: str | None = None
    dosage_form: str
    dosage_pattern: str
    meal_relation: str
    as_needed: bool
    scheduled_slot: SlotName
    scheduled_time: str
    dose_qty: float
    slot_label_en: str
    slot_label_hi: str
    slot_label_mr: str
    pill_color_tag: str
    strip_thumbnail: str | None = None
    status: DoseStatus
    taken_at: datetime | None = None
    spoken_text: str
    instructions_en: str
    instructions_hi: str
    instructions_mr: str
    safety_flags: list[SafetyFlag] = Field(default_factory=list)


class NaniScheduleResponse(BaseModel):
    """Full Nani Mode daily schedule returned by GET /schedule/{share_code}."""

    share_code: str
    elder_name: str
    preferred_language: str
    active_language: str
    schedule_date: date
    current_time_ist: str
    total_scheduled: int
    taken_count: int
    pending_count: int
    missed_count: int
    adherence_percent: float
    next_due_card: NaniScheduleCard | None = None
    cards: list[NaniScheduleCard]
    as_needed_cards: list[NaniScheduleCard] = Field(default_factory=list)


# =============================================================================
# 5. Vitals & Deterministic Clinical Alert Schemas
# =============================================================================


class VitalFlag(BaseModel):
    """Single deterministic vital sign assessment."""

    metric: Literal[
        "temperature_f",
        "blood_pressure",
        "weight_kg",
        "pulse_bpm",
        "spo2_percent",
        "blood_sugar_mgdl",
    ]
    status: VitalStatus
    code: str
    value_display: str
    message_en: str
    message_hi: str
    message_mr: str


class VitalCreateRequest(BaseModel):
    """Log one or more vitals for an elder profile."""

    share_code: str = Field(default="DEMO01", min_length=4, max_length=12)
    temperature_f: float | None = Field(default=None, ge=85.0, le=112.0)
    systolic_mmhg: int | None = Field(default=None, ge=50, le=280)
    diastolic_mmhg: int | None = Field(default=None, ge=30, le=180)
    weight_kg: float | None = Field(default=None, ge=15.0, le=250.0)
    pulse_bpm: int | None = Field(default=None, ge=25, le=220)
    spo2_percent: int | None = Field(default=None, ge=50, le=100)
    blood_sugar_mgdl: float | None = Field(default=None, ge=20.0, le=700.0)
    notes: str | None = Field(default=None, max_length=500)
    recorded_by: Literal["caregiver", "nani", "device"] = "caregiver"

    @field_validator("share_code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def validate_at_least_one_vital(self) -> VitalCreateRequest:
        has_any = any(
            v is not None
            for v in (
                self.temperature_f,
                self.systolic_mmhg,
                self.diastolic_mmhg,
                self.weight_kg,
                self.pulse_bpm,
                self.spo2_percent,
                self.blood_sugar_mgdl,
            )
        )
        if not has_any:
            raise ValueError("At least one vital sign measurement must be provided.")
        if (self.systolic_mmhg is None) != (self.diastolic_mmhg is None):
            raise ValueError(
                "Both systolic_mmhg and diastolic_mmhg must be provided together."
            )
        if (
            self.systolic_mmhg is not None
            and self.diastolic_mmhg is not None
            and self.systolic_mmhg <= self.diastolic_mmhg
        ):
            raise ValueError("systolic_mmhg must be greater than diastolic_mmhg.")
        return self


class VitalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    share_code: str | None = None
    recorded_at: datetime
    temperature_f: float | None = None
    systolic_mmhg: int | None = None
    diastolic_mmhg: int | None = None
    weight_kg: float | None = None
    pulse_bpm: int | None = None
    spo2_percent: int | None = None
    blood_sugar_mgdl: float | None = None
    overall_status: VitalStatus
    flags: list[VitalFlag] = Field(default_factory=list)
    alert_summary_en: str = ""
    alert_summary_hi: str = ""
    alert_summary_mr: str = ""
    notes: str | None = None
    recorded_by: str


class VitalsHistoryResponse(BaseModel):
    share_code: str
    elder_name: str
    count: int
    latest_status: VitalStatus | None = None
    vitals: list[VitalResponse]


class VitalDeleteResponse(BaseModel):
    deleted: bool
    vital_id: int


# =============================================================================
# 6. Family Daily Summary & WhatsApp Deep-Link Schema
# =============================================================================


class DailySummaryResponse(BaseModel):
    """Caregiver/family daily digest + ready-to-share WhatsApp deep link."""

    share_code: str
    elder_name: str
    caregiver_name: str | None = None
    report_date: date
    generated_at_ist: str
    adherence_percent: float
    doses_total: int
    doses_taken: int
    doses_pending: int
    doses_missed: int
    doses_skipped: int
    taken_medicines: list[str]
    pending_medicines: list[str]
    missed_medicines: list[str]
    latest_vital: VitalResponse | None = None
    abnormal_vital_flags: list[VitalFlag] = Field(default_factory=list)
    active_safety_flags: list[SafetyFlag] = Field(default_factory=list)
    whatsapp_message: str
    whatsapp_url: str
