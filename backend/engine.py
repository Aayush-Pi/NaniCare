"""NaniCare FastAPI Backend Entry Point.

Voice-first eldercare prescription and vitals companion for Indian families.
Powered by FastAPI, Gemini Vision (Structured Outputs), and Neon PostgreSQL.
"""

from __future__ import annotations

import base64
import io
import logging
import os
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from database import SessionLocal, check_db_connection, get_db, init_db
from models import DoseLog, Medicine, Profile, VitalLog
from prompts import DEMO_PRESCRIPTION_PAYLOAD, DEMO_PROFILE_SEED, DEMO_THUMBNAILS, GEMINI_VISION_SYSTEM_PROMPT
from scheduler import (
    LOW_CONFIDENCE_THRESHOLD,
    SLOT_SORT_ORDER,
    build_multilingual_instructions,
    build_slot_spoken_text,
    build_whatsapp_summary,
    compute_dose_status,
    evaluate_medicine_safety,
    evaluate_vitals,
    generate_share_code,
    get_ist_now,
    get_ist_today,
    parse_indian_dosage_pattern,
    pick_pill_color_tag,
)
from schemas import (
    DailySummaryResponse,
    DoseLogResponse,
    DoseMarkRequest,
    EnrichedScannedMedicine,
    LanguageCode,
    MedicineResponse,
    MedicinesConfirmRequest,
    MedicinesConfirmResponse,
    MedicinesFlushResponse,
    MedicineUpdateRequest,
    NaniScheduleCard,
    NaniScheduleResponse,
    PrescriptionExtractionOutput,
    ProfileCreateRequest,
    ProfileResponse,
    SafetyFlag,
    ScanResponse,
    ScheduleSlot,
    TTSRequest,
    VitalCreateRequest,
    VitalDeleteResponse,
    VitalFlag,
    VitalResponse,
    VitalsHistoryResponse,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("nanicare.engine")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
GEMINI_FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
)
DEFAULT_SHARE_CODE = os.getenv("DEFAULT_SHARE_CODE", "DEMO01").strip().upper() or "DEMO01"
MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MB max prescription image size


# =============================================================================
# Internal Helpers
# =============================================================================


def _get_gemini_api_key() -> str | None:
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not key or "your_gemini_api_key" in key.lower() or key.lower() == "placeholder":
        return None
    return key


def _create_thumbnail_data_uri(image_bytes: bytes) -> tuple[str, str]:
    """Validate uploaded image bytes via Pillow and return (thumbnail_data_uri, mime_type)."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img_format = (img.format or "JPEG").upper()
            mime_map = {
                "JPEG": "image/jpeg",
                "JPG": "image/jpeg",
                "PNG": "image/png",
                "WEBP": "image/webp",
            }
            mime_type = mime_map.get(img_format, "image/jpeg")

            thumb = img.convert("RGB")
            thumb.thumbnail((360, 240))
            buf = io.BytesIO()
            thumb.save(buf, format="JPEG", quality=78, optimize=True)
            encoded = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}", mime_type
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded file is not a valid image: {exc}",
        ) from exc


def _call_gemini_vision(
    image_bytes: bytes,
    mime_type: str,
    api_key: str,
    model_name: str | None = None,
) -> PrescriptionExtractionOutput:
    """Invoke Gemini Vision with strict Pydantic v2 JSON Structured Output."""
    from google import genai
    from google.genai import types

    target_model = (model_name or GEMINI_MODEL).strip() or "gemini-3.5-flash"
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=target_model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            "Extract all medicines, strengths, Indian dosage shorthand, meal relations, and confidence scores from this image.",
        ],
        config=types.GenerateContentConfig(
            system_instruction=GEMINI_VISION_SYSTEM_PROMPT,
            temperature=0.1,
            response_mime_type="application/json",
            response_schema=PrescriptionExtractionOutput,
        ),
    )

    if getattr(response, "parsed", None) is not None:
        parsed = response.parsed
        if isinstance(parsed, PrescriptionExtractionOutput):
            return parsed
        return PrescriptionExtractionOutput.model_validate(parsed)

    raw_text = (response.text or "").strip()
    if not raw_text:
        raise RuntimeError("Gemini Vision returned an empty response.")
    return PrescriptionExtractionOutput.model_validate_json(raw_text)


def _call_gemini_vision_with_fallback(
    image_bytes: bytes,
    mime_type: str,
    api_key: str,
) -> tuple[PrescriptionExtractionOutput, str, list[str]]:
    """Try the configured Gemini model and fall back on transient/deprecated model errors."""
    candidates: list[str] = []
    for candidate in (GEMINI_MODEL, *GEMINI_FALLBACK_MODELS):
        cleaned = candidate.strip()
        if cleaned and cleaned not in candidates:
            candidates.append(cleaned)

    last_exc: Exception | None = None
    extra_warnings: list[str] = []
    for idx, model_name in enumerate(candidates):
        try:
            extraction = _call_gemini_vision(
                image_bytes=image_bytes,
                mime_type=mime_type,
                api_key=api_key,
                model_name=model_name,
            )
            if idx > 0:
                extra_warnings.append(
                    f"Primary model '{candidates[0]}' was unavailable; extracted via '{model_name}'."
                )
            return extraction, model_name, extra_warnings
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Gemini Vision model '%s' failed (%s); trying next fallback if available",
                model_name,
                type(exc).__name__,
            )

    assert last_exc is not None
    raise last_exc


def _enrich_extraction(
    extraction: PrescriptionExtractionOutput,
    source: str,
    model_used: str,
    uploaded_thumbnail: str | None = None,
    extra_warnings: list[str] | None = None,
) -> ScanResponse:
    """Run deterministic Indian schedule + safety enrichment on AI-extracted medicines."""
    med_dicts_for_safety: list[dict[str, Any]] = []
    parsed_entries: list[tuple[Any, list[ScheduleSlot], bool, str, Any]] = []

    for med in extraction.medicines:
        slots, as_needed, normalized_pattern, effective_meal = parse_indian_dosage_pattern(
            dosage_pattern=med.dosage_pattern,
            meal_relation=med.meal_relation,
            brand_name=med.brand_name,
            generic_name=med.generic_name,
        )
        parsed_entries.append((med, slots, as_needed, normalized_pattern, effective_meal))
        med_dicts_for_safety.append(
            {
                "brand_name": med.brand_name,
                "generic_name": med.generic_name,
                "strength": med.strength,
                "dosage_pattern": normalized_pattern,
                "meal_relation": effective_meal,
                "confidence": med.confidence,
                "low_confidence_fields": med.low_confidence_fields,
            }
        )

    per_med_flags, regimen_flags = evaluate_medicine_safety(med_dicts_for_safety)

    enriched: list[EnrichedScannedMedicine] = []
    low_conf_count = 0

    for idx, (med, slots, as_needed, normalized_pattern, effective_meal) in enumerate(parsed_entries):
        flags = per_med_flags.get(idx, [])
        is_low_conf = med.confidence < LOW_CONFIDENCE_THRESHOLD or bool(med.low_confidence_fields)
        has_critical = any(f.severity == "critical" for f in flags)
        needs_review = is_low_conf or has_critical or any(f.code == "MISSING_STRENGTH" for f in flags)

        if is_low_conf:
            low_conf_count += 1

        if has_critical:
            highlight = "red"
        elif needs_review:
            highlight = "yellow"
        else:
            highlight = "none"

        scripts = build_multilingual_instructions(
            brand_name=med.brand_name,
            strength=med.strength,
            dosage_form=med.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
            frequency_notes=med.frequency_notes,
        )

        strip_thumb = uploaded_thumbnail or DEMO_THUMBNAILS.get(med.brand_name)

        enriched.append(
            EnrichedScannedMedicine(
                brand_name=med.brand_name,
                generic_name=med.generic_name,
                strength=med.strength,
                dosage_form=med.dosage_form,
                dosage_pattern=normalized_pattern,
                meal_relation=effective_meal,
                duration_days=med.duration_days,
                as_needed=as_needed,
                schedule_slots=slots,
                instructions_en=scripts["en"],
                instructions_hi=scripts["hi"],
                instructions_mr=scripts["mr"],
                pill_color_tag=pick_pill_color_tag(slots, as_needed),
                strip_thumbnail=strip_thumb,
                confidence=round(float(med.confidence), 3),
                needs_review=needs_review,
                highlight_color=highlight,  # type: ignore[arg-type]
                low_confidence_fields=list(med.low_confidence_fields),
                safety_flags=flags,
                raw_line_text=med.raw_line_text,
            )
        )

    warnings = list(extraction.warnings)
    if extra_warnings:
        warnings.extend(extra_warnings)

    needs_caregiver_review = any(m.needs_review for m in enriched) or bool(regimen_flags)

    return ScanResponse(
        source=source,  # type: ignore[arg-type]
        model_used=model_used,
        source_type=extraction.source_type,
        doctor_name=extraction.doctor_name,
        clinic_name=extraction.clinic_name,
        patient_name=extraction.patient_name,
        prescription_date=extraction.prescription_date,
        diagnosis_notes=extraction.diagnosis_notes,
        overall_confidence=round(float(extraction.overall_confidence), 3),
        needs_caregiver_review=needs_caregiver_review,
        low_confidence_count=low_conf_count,
        strip_thumbnail=uploaded_thumbnail,
        medicines=enriched,
        regimen_safety_flags=regimen_flags,
        warnings=warnings,
    )


def _get_profile_or_404(db: Session, share_code: str) -> Profile:
    normalized = share_code.strip().upper()
    profile = db.scalar(select(Profile).where(Profile.share_code == normalized))
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile with share_code '{normalized}' was not found.",
        )
    return profile


def _serialize_medicine(med: Medicine) -> MedicineResponse:
    slots = [ScheduleSlot.model_validate(s) for s in (med.schedule_slots or [])]
    flags = [SafetyFlag.model_validate(f) for f in (med.safety_flags or [])]
    return MedicineResponse(
        id=med.id,
        profile_id=med.profile_id,
        brand_name=med.brand_name,
        generic_name=med.generic_name,
        strength=med.strength,
        dosage_form=med.dosage_form,
        dosage_pattern=med.dosage_pattern,
        meal_relation=med.meal_relation,
        schedule_slots=slots,
        duration_days=med.duration_days,
        as_needed=med.as_needed,
        instructions_en=med.instructions_en,
        instructions_hi=med.instructions_hi,
        instructions_mr=med.instructions_mr,
        strip_thumbnail=med.strip_thumbnail,
        pill_color_tag=med.pill_color_tag,
        confidence=med.confidence,
        needs_review=med.needs_review,
        safety_flags=flags,
        verified_by_caregiver=med.verified_by_caregiver,
        is_active=med.is_active,
        prescribed_by=med.prescribed_by,
        created_at=med.created_at,
    )


def _serialize_vital(vital: VitalLog, share_code: str) -> VitalResponse:
    flags = [VitalFlag.model_validate(f) for f in (vital.flags or [])]
    abnormal = [f for f in flags if f.status != "normal"]
    if abnormal:
        summary_en = " ".join(f.message_en for f in abnormal)
        summary_hi = " ".join(f.message_hi for f in abnormal)
        summary_mr = " ".join(f.message_mr for f in abnormal)
    else:
        summary_en = "All recorded vitals are within normal range."
        summary_hi = "सभी दर्ज वाइटल्स सामान्य सीमा में हैं।"
        summary_mr = "नोंदवलेले सर्व व्हायटल्स सामान्य मर्यादेत आहेत."

    return VitalResponse(
        id=vital.id,
        profile_id=vital.profile_id,
        share_code=share_code,
        recorded_at=vital.recorded_at,
        temperature_f=vital.temperature_f,
        systolic_mmhg=vital.systolic_mmhg,
        diastolic_mmhg=vital.diastolic_mmhg,
        weight_kg=vital.weight_kg,
        pulse_bpm=vital.pulse_bpm,
        spo2_percent=vital.spo2_percent,
        blood_sugar_mgdl=vital.blood_sugar_mgdl,
        overall_status=vital.overall_status,  # type: ignore[arg-type]
        flags=flags,
        alert_summary_en=summary_en,
        alert_summary_hi=summary_hi,
        alert_summary_mr=summary_mr,
        notes=vital.notes,
        recorded_by=vital.recorded_by,
    )


def _build_schedule_for_profile(
    db: Session,
    profile: Profile,
    target_date: date,
    lang: str | None = None,
) -> NaniScheduleResponse:
    active_lang = lang if lang in ("hi", "mr", "en") else profile.preferred_language
    now_ist = get_ist_now()

    medicines = list(
        db.scalars(
            select(Medicine)
            .where(and_(Medicine.profile_id == profile.id, Medicine.is_active.is_(True)))
            .order_by(Medicine.id.asc())
        )
    )
    dose_logs = list(
        db.scalars(
            select(DoseLog).where(
                and_(DoseLog.profile_id == profile.id, DoseLog.dose_date == target_date)
            )
        )
    )
    log_lookup: dict[tuple[int, str], DoseLog] = {
        (log.medicine_id, log.scheduled_slot): log for log in dose_logs
    }

    cards: list[NaniScheduleCard] = []
    as_needed_cards: list[NaniScheduleCard] = []

    for med in medicines:
        raw_slots = med.schedule_slots or []
        slots = [ScheduleSlot.model_validate(s) for s in raw_slots]
        flags = [SafetyFlag.model_validate(f) for f in (med.safety_flags or [])]

        for slot in slots:
            log = log_lookup.get((med.id, slot.slot))
            dose_status = compute_dose_status(
                scheduled_time=slot.time,
                dose_date=target_date,
                existing_status=log.status if log else None,
                as_needed=med.as_needed,
                now_ist=now_ist,
            )
            spoken = build_slot_spoken_text(
                brand_name=med.brand_name,
                strength=med.strength,
                dosage_form=med.dosage_form,
                meal_relation=med.meal_relation,  # type: ignore[arg-type]
                slot=slot,
                language=active_lang,
            )

            card = NaniScheduleCard(
                medicine_id=med.id,
                brand_name=med.brand_name,
                generic_name=med.generic_name,
                strength=med.strength,
                dosage_form=med.dosage_form,
                dosage_pattern=med.dosage_pattern,
                meal_relation=med.meal_relation,
                as_needed=med.as_needed,
                scheduled_slot=slot.slot,
                scheduled_time=slot.time,
                dose_qty=slot.dose_qty,
                slot_label_en=slot.label_en,
                slot_label_hi=slot.label_hi,
                slot_label_mr=slot.label_mr,
                pill_color_tag=slot.color_hex or med.pill_color_tag,
                strip_thumbnail=med.strip_thumbnail,
                status=dose_status,
                taken_at=log.taken_at if log else None,
                spoken_text=spoken,
                instructions_en=med.instructions_en or spoken,
                instructions_hi=med.instructions_hi or spoken,
                instructions_mr=med.instructions_mr or spoken,
                safety_flags=flags,
            )
            if med.as_needed or slot.slot == "sos":
                as_needed_cards.append(card)
            else:
                cards.append(card)

    cards.sort(
        key=lambda c: (
            SLOT_SORT_ORDER.get(c.scheduled_slot, 99),
            c.scheduled_time,
            c.medicine_id,
        )
    )

    total_scheduled = len(cards)
    taken_count = sum(1 for c in cards if c.status == "taken")
    missed_count = sum(1 for c in cards if c.status == "missed")
    pending_count = sum(1 for c in cards if c.status in ("due_now", "upcoming", "snoozed"))
    adherence = round((taken_count / total_scheduled) * 100.0, 1) if total_scheduled > 0 else 100.0

    # Pick the single most actionable card for Nani Mode's hero card
    next_due = next((c for c in cards if c.status == "due_now"), None)
    if next_due is None:
        next_due = next((c for c in cards if c.status in ("upcoming", "snoozed")), None)
    if next_due is None:
        next_due = next((c for c in cards if c.status == "missed"), None)

    return NaniScheduleResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        preferred_language=profile.preferred_language,
        active_language=active_lang,
        schedule_date=target_date,
        current_time_ist=now_ist.strftime("%H:%M IST"),
        total_scheduled=total_scheduled,
        taken_count=taken_count,
        pending_count=pending_count,
        missed_count=missed_count,
        adherence_percent=adherence,
        next_due_card=next_due,
        cards=cards,
        as_needed_cards=as_needed_cards,
    )


def _seed_demo_profile(db: Session, reset: bool = False) -> Profile:
    """Idempotently seed the default DEMO01 elder profile for zero-setup demos."""
    share_code = DEFAULT_SHARE_CODE
    existing = db.scalar(select(Profile).where(Profile.share_code == share_code))
    if existing and not reset:
        return existing

    if existing and reset:
        db.delete(existing)
        db.commit()

    profile = Profile(
        share_code=share_code,
        elder_name=DEMO_PROFILE_SEED["elder_name"],
        age=DEMO_PROFILE_SEED["age"],
        preferred_language=DEMO_PROFILE_SEED["preferred_language"],
        caregiver_name=DEMO_PROFILE_SEED["caregiver_name"],
        caregiver_phone=DEMO_PROFILE_SEED["caregiver_phone"],
        known_allergies=list(DEMO_PROFILE_SEED["known_allergies"]),
    )
    db.add(profile)
    db.flush()

    seed_meds = DEMO_PROFILE_SEED["medicines"]
    per_med_flags, _ = evaluate_medicine_safety(seed_meds)

    created_meds: list[Medicine] = []
    for idx, item in enumerate(seed_meds):
        slots, as_needed, normalized_pattern, effective_meal = parse_indian_dosage_pattern(
            dosage_pattern=item["dosage_pattern"],
            meal_relation=item["meal_relation"],
            brand_name=item["brand_name"],
            generic_name=item.get("generic_name"),
        )
        scripts = build_multilingual_instructions(
            brand_name=item["brand_name"],
            strength=item.get("strength"),
            dosage_form=item["dosage_form"],
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
        )
        med = Medicine(
            profile_id=profile.id,
            brand_name=item["brand_name"],
            generic_name=item.get("generic_name"),
            strength=item.get("strength"),
            dosage_form=item["dosage_form"],
            dosage_pattern=normalized_pattern,
            meal_relation=effective_meal,
            schedule_slots=[s.model_dump() for s in slots],
            duration_days=item.get("duration_days"),
            as_needed=as_needed,
            instructions_en=scripts["en"],
            instructions_hi=scripts["hi"],
            instructions_mr=scripts["mr"],
            strip_thumbnail=item.get("strip_thumbnail"),
            pill_color_tag=pick_pill_color_tag(slots, as_needed),
            confidence=item.get("confidence", 0.95),
            needs_review=False,
            safety_flags=[f.model_dump() for f in per_med_flags.get(idx, [])],
            verified_by_caregiver=True,
            is_active=True,
            prescribed_by=DEMO_PROFILE_SEED["prescribed_by"],
        )
        db.add(med)
        created_meds.append(med)

    db.flush()

    # Mark Thyronorm (empty stomach 07:00) as taken today so adherence is visible immediately
    today_ist = get_ist_today()
    if created_meds:
        first_med = created_meds[0]
        first_slot = first_med.schedule_slots[0]
        db.add(
            DoseLog(
                profile_id=profile.id,
                medicine_id=first_med.id,
                dose_date=today_ist,
                scheduled_slot=first_slot["slot"],
                scheduled_time=first_slot["time"],
                status="taken",
                taken_at=datetime.now(timezone.utc),
                marked_by="nani",
                notes="Taken with warm water",
            )
        )

    # Seed two baseline vitals readings (yesterday + today) so trend & summary look realistic
    yesterday_ts = datetime.now(timezone.utc) - timedelta(days=1)
    y_status, y_flags, _, _, _ = evaluate_vitals(
        temperature_f=98.4,
        systolic_mmhg=124,
        diastolic_mmhg=78,
        weight_kg=58.2,
        pulse_bpm=74,
    )
    db.add(
        VitalLog(
            profile_id=profile.id,
            recorded_at=yesterday_ts,
            temperature_f=98.4,
            systolic_mmhg=124,
            diastolic_mmhg=78,
            weight_kg=58.2,
            pulse_bpm=74,
            overall_status=y_status,
            flags=[f.model_dump() for f in y_flags],
            notes="Morning routine check",
            recorded_by="caregiver",
        )
    )

    t_status, t_flags, _, _, _ = evaluate_vitals(
        temperature_f=98.6,
        systolic_mmhg=128,
        diastolic_mmhg=80,
        weight_kg=58.4,
        pulse_bpm=76,
        previous_weight_kg=58.2,
        days_since_previous_weight=1.0,
    )
    db.add(
        VitalLog(
            profile_id=profile.id,
            recorded_at=datetime.now(timezone.utc),
            temperature_f=98.6,
            systolic_mmhg=128,
            diastolic_mmhg=80,
            weight_kg=58.4,
            pulse_bpm=76,
            overall_status=t_status,
            flags=[f.model_dump() for f in t_flags],
            notes="After breakfast vitals check",
            recorded_by="caregiver",
        )
    )

    db.commit()
    db.refresh(profile)
    logger.info("Seeded default NaniCare demo profile '%s'", share_code)
    return profile


# =============================================================================
# FastAPI Lifespan & App Initialization
# =============================================================================


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as db:
        _seed_demo_profile(db, reset=False)
    yield


app = FastAPI(
    title="NaniCare Backend API",
    description=(
        "Voice-first eldercare prescription & vitals companion for Indian families. "
        "Powered by FastAPI, Gemini Vision Structured Outputs, and Neon PostgreSQL."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

raw_origins = os.getenv("CORS_ORIGINS", "*").strip()
allowed_origins = ["*"] if raw_origins == "*" else [o.strip() for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False if allowed_origins == ["*"] else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# 1. Health & Demo Seed Endpoints
# =============================================================================


@app.get("/", tags=["System"])
def root() -> dict[str, Any]:
    return {
        "service": "NaniCare Backend API",
        "status": "ok",
        "default_share_code": DEFAULT_SHARE_CODE,
        "docs_url": "/docs",
    }


@app.get("/health", tags=["System"])
def health_check() -> dict[str, Any]:
    db_ok, db_backend = check_db_connection()
    return {
        "status": "healthy" if db_ok else "degraded",
        "database_connected": db_ok,
        "database_backend": db_backend,
        "gemini_configured": _get_gemini_api_key() is not None,
        "gemini_model": GEMINI_MODEL,
        "default_share_code": DEFAULT_SHARE_CODE,
        "server_time_ist": get_ist_now().isoformat(),
    }


@app.post("/demo/seed", response_model=ProfileResponse, tags=["System"])
def seed_demo_endpoint(
    reset: bool = Query(default=False, description="If true, resets DEMO01 back to initial seed state."),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    profile = _seed_demo_profile(db, reset=reset)
    active_count = len([m for m in profile.medicines if m.is_active])
    return ProfileResponse(
        id=profile.id,
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        age=profile.age,
        preferred_language=profile.preferred_language,
        caregiver_name=profile.caregiver_name,
        caregiver_phone=profile.caregiver_phone,
        known_allergies=profile.known_allergies or [],
        active_medicine_count=active_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


# =============================================================================
# 2. Caregiver Mode: Gemini Vision Prescription / Strip Scanner
# =============================================================================


@app.get("/scan/demo", response_model=ScanResponse, tags=["Caregiver Mode"])
def get_demo_scan() -> ScanResponse:
    """Return a realistic Indian prescription extraction without uploading a file."""
    extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)
    return _enrich_extraction(
        extraction=extraction,
        source="demo_fallback",
        model_used="demo-payload",
        uploaded_thumbnail=None,
    )


@app.post("/scan", response_model=ScanResponse, tags=["Caregiver Mode"])
async def scan_prescription(
    file: UploadFile | None = File(
        default=None,
        description="Photo of handwritten doctor prescription or medicine blister strip (JPEG/PNG/WEBP).",
    ),
    demo: bool = Form(
        default=False,
        description="Set true to return the realistic demo prescription payload immediately.",
    ),
) -> ScanResponse:
    """Extract medicines from a prescription or blister strip via Gemini Vision + deterministic rules."""
    uploaded_thumbnail: str | None = None
    image_bytes: bytes | None = None
    mime_type = "image/jpeg"

    if file is not None:
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded image file is empty.",
            )
        if len(image_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Image exceeds 12 MB limit. Please upload a smaller photo.",
            )
        uploaded_thumbnail, mime_type = _create_thumbnail_data_uri(image_bytes)

    api_key = _get_gemini_api_key()

    if demo or image_bytes is None or api_key is None:
        reason = (
            "Demo mode requested."
            if demo
            else (
                "No image uploaded; returning sample Indian prescription."
                if image_bytes is None
                else "GEMINI_API_KEY not configured; returning demo fallback extraction."
            )
        )
        extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)
        return _enrich_extraction(
            extraction=extraction,
            source="demo_fallback",
            model_used="demo-fallback",
            uploaded_thumbnail=uploaded_thumbnail,
            extra_warnings=[reason],
        )

    try:
        extraction, model_used, fallback_warnings = _call_gemini_vision_with_fallback(
            image_bytes=image_bytes,
            mime_type=mime_type,
            api_key=api_key,
        )
        return _enrich_extraction(
            extraction=extraction,
            source="gemini_vision",
            model_used=model_used,
            uploaded_thumbnail=uploaded_thumbnail,
            extra_warnings=fallback_warnings,
        )
    except Exception as exc:
        logger.exception("Gemini Vision extraction failed; falling back to demo payload")
        extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)
        return _enrich_extraction(
            extraction=extraction,
            source="demo_fallback",
            model_used=f"{GEMINI_MODEL} (fallback)",
            uploaded_thumbnail=uploaded_thumbnail,
            extra_warnings=[
                f"Live Gemini Vision call failed ({type(exc).__name__}); returned demo fallback payload."
            ],
        )


# =============================================================================
# 3. Profile Management (Zero-Auth 6-Char Share Code)
# =============================================================================


@app.post(
    "/profile",
    response_model=ProfileResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Profiles"],
)
def create_or_update_profile(
    payload: ProfileCreateRequest,
    db: Session = Depends(get_db),
) -> ProfileResponse:
    """Create a new elder profile (auto-generating a 6-char share_code) or update an existing one."""
    share_code = payload.share_code
    if share_code:
        profile = db.scalar(select(Profile).where(Profile.share_code == share_code))
        if profile:
            profile.elder_name = payload.elder_name
            profile.age = payload.age
            profile.preferred_language = payload.preferred_language
            profile.caregiver_name = payload.caregiver_name
            profile.caregiver_phone = payload.caregiver_phone
            profile.known_allergies = list(payload.known_allergies)
            db.commit()
            db.refresh(profile)
            active_count = len([m for m in profile.medicines if m.is_active])
            return ProfileResponse(
                id=profile.id,
                share_code=profile.share_code,
                elder_name=profile.elder_name,
                age=profile.age,
                preferred_language=profile.preferred_language,
                caregiver_name=profile.caregiver_name,
                caregiver_phone=profile.caregiver_phone,
                known_allergies=profile.known_allergies or [],
                active_medicine_count=active_count,
                created_at=profile.created_at,
                updated_at=profile.updated_at,
            )
    else:
        for _ in range(10):
            candidate = generate_share_code(6)
            exists = db.scalar(select(Profile.id).where(Profile.share_code == candidate))
            if not exists:
                share_code = candidate
                break
        if not share_code:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not generate a unique share_code.",
            )

    profile = Profile(
        share_code=share_code,
        elder_name=payload.elder_name,
        age=payload.age,
        preferred_language=payload.preferred_language,
        caregiver_name=payload.caregiver_name,
        caregiver_phone=payload.caregiver_phone,
        known_allergies=list(payload.known_allergies),
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return ProfileResponse(
        id=profile.id,
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        age=profile.age,
        preferred_language=profile.preferred_language,
        caregiver_name=profile.caregiver_name,
        caregiver_phone=profile.caregiver_phone,
        known_allergies=profile.known_allergies or [],
        active_medicine_count=0,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _serialize_profile(profile: Profile) -> ProfileResponse:
    active_count = len([m for m in profile.medicines if m.is_active])
    return ProfileResponse(
        id=profile.id,
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        age=profile.age,
        preferred_language=profile.preferred_language,
        caregiver_name=profile.caregiver_name,
        caregiver_phone=profile.caregiver_phone,
        known_allergies=profile.known_allergies or [],
        active_medicine_count=active_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _deactivate_profile_medicines(db: Session, profile_id: int) -> int:
    """Soft-deactivate all currently active medicines for a profile."""
    existing_active = list(
        db.scalars(
            select(Medicine).where(
                and_(Medicine.profile_id == profile_id, Medicine.is_active.is_(True))
            )
        )
    )
    for med in existing_active:
        med.is_active = False
    return len(existing_active)


@app.get("/profiles", response_model=list[ProfileResponse], tags=["Profiles"])
def list_profiles(db: Session = Depends(get_db)) -> list[ProfileResponse]:
    """List all elder profiles so caregivers can switch between profiles or create new ones."""
    profiles = list(db.scalars(select(Profile).order_by(Profile.id.asc())))
    return [_serialize_profile(p) for p in profiles]


@app.get("/profile/{share_code}", response_model=ProfileResponse, tags=["Profiles"])
def get_profile(share_code: str, db: Session = Depends(get_db)) -> ProfileResponse:
    profile = _get_profile_or_404(db, share_code)
    return _serialize_profile(profile)


# =============================================================================
# 4. Caregiver Mode: Confirm & Manage Verified Medicines
# =============================================================================


def _recompute_profile_safety_flags(db: Session, profile_id: int) -> list[SafetyFlag]:
    """Re-evaluate deterministic safety flags across all active medicines of a profile."""
    all_active = list(
        db.scalars(
            select(Medicine)
            .where(and_(Medicine.profile_id == profile_id, Medicine.is_active.is_(True)))
            .order_by(Medicine.id.asc())
        )
    )
    safety_inputs = [
        {
            "brand_name": m.brand_name,
            "generic_name": m.generic_name,
            "strength": m.strength,
            "dosage_pattern": m.dosage_pattern,
            "meal_relation": m.meal_relation,
            "confidence": 1.0,  # Caregiver already verified these records
            "low_confidence_fields": [],
        }
        for m in all_active
    ]
    per_med_flags, regimen_flags = evaluate_medicine_safety(safety_inputs)
    for idx, med in enumerate(all_active):
        med.safety_flags = [f.model_dump() for f in per_med_flags.get(idx, [])]
    return regimen_flags


@app.post(
    "/medicines/confirm",
    response_model=MedicinesConfirmResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Caregiver Mode"],
)
def confirm_medicines(
    payload: MedicinesConfirmRequest,
    db: Session = Depends(get_db),
) -> MedicinesConfirmResponse:
    """Confirm caregiver-reviewed medicines and save them to Neon PostgreSQL."""
    profile = db.scalar(select(Profile).where(Profile.share_code == payload.share_code))
    if profile is None:
        profile = Profile(
            share_code=payload.share_code,
            elder_name=payload.elder_name or "Nani",
            preferred_language=payload.preferred_language or "hi",
            caregiver_name=payload.caregiver_name,
            caregiver_phone=payload.caregiver_phone,
            known_allergies=[],
        )
        db.add(profile)
        db.flush()
    else:
        if payload.elder_name:
            profile.elder_name = payload.elder_name
        if payload.preferred_language:
            profile.preferred_language = payload.preferred_language
        if payload.caregiver_name:
            profile.caregiver_name = payload.caregiver_name
        if payload.caregiver_phone:
            profile.caregiver_phone = payload.caregiver_phone

    if payload.replace_existing:
        _deactivate_profile_medicines(db, profile.id)

    new_models: list[Medicine] = []
    for item in payload.medicines:
        slots, as_needed, normalized_pattern, effective_meal = parse_indian_dosage_pattern(
            dosage_pattern=item.dosage_pattern,
            meal_relation=item.meal_relation,
            brand_name=item.brand_name,
            generic_name=item.generic_name,
        )
        generated_scripts = build_multilingual_instructions(
            brand_name=item.brand_name,
            strength=item.strength,
            dosage_form=item.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
        )

        med = Medicine(
            profile_id=profile.id,
            brand_name=item.brand_name.strip(),
            generic_name=item.generic_name.strip() if item.generic_name else None,
            strength=item.strength.strip() if item.strength else None,
            dosage_form=item.dosage_form,
            dosage_pattern=normalized_pattern,
            meal_relation=effective_meal,
            schedule_slots=[s.model_dump() for s in slots],
            duration_days=item.duration_days,
            as_needed=as_needed,
            instructions_en=item.instructions_en or generated_scripts["en"],
            instructions_hi=item.instructions_hi or generated_scripts["hi"],
            instructions_mr=item.instructions_mr or generated_scripts["mr"],
            strip_thumbnail=item.strip_thumbnail or DEMO_THUMBNAILS.get(item.brand_name.strip()),
            pill_color_tag=item.pill_color_tag or pick_pill_color_tag(slots, as_needed),
            confidence=item.confidence,
            needs_review=False,
            safety_flags=[],
            verified_by_caregiver=True,
            is_active=True,
            prescribed_by=item.prescribed_by or payload.prescribed_by,
        )
        db.add(med)
        new_models.append(med)

    db.flush()

    regimen_flags = _recompute_profile_safety_flags(db, profile.id)

    db.commit()
    for med in new_models:
        db.refresh(med)

    return MedicinesConfirmResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        saved_count=len(new_models),
        medicines=[_serialize_medicine(m) for m in new_models],
        regimen_safety_flags=regimen_flags,
    )


@app.get("/medicines/{share_code}", response_model=list[MedicineResponse], tags=["Caregiver Mode"])
def list_medicines(
    share_code: str,
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[MedicineResponse]:
    profile = _get_profile_or_404(db, share_code)
    stmt = select(Medicine).where(Medicine.profile_id == profile.id)
    if not include_inactive:
        stmt = stmt.where(Medicine.is_active.is_(True))
    meds = list(db.scalars(stmt.order_by(Medicine.id.asc())))
    return [_serialize_medicine(m) for m in meds]


@app.patch(
    "/medicines/{medicine_id}",
    response_model=MedicineResponse,
    tags=["Caregiver Mode"],
)
def update_medicine(
    medicine_id: int,
    payload: MedicineUpdateRequest,
    db: Session = Depends(get_db),
) -> MedicineResponse:
    """Update a verified medicine's schedule/details and recompute safety flags."""
    med = db.get(Medicine, medicine_id)
    if not med:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Medicine id={medicine_id} not found.",
        )

    updates = payload.model_dump(exclude_unset=True)
    if "brand_name" in updates and updates["brand_name"] is not None:
        med.brand_name = updates["brand_name"].strip()
    if "generic_name" in updates:
        med.generic_name = updates["generic_name"].strip() if updates["generic_name"] else None
    if "strength" in updates:
        med.strength = updates["strength"].strip() if updates["strength"] else None
    if "dosage_form" in updates and updates["dosage_form"] is not None:
        med.dosage_form = updates["dosage_form"]
    if "duration_days" in updates:
        med.duration_days = updates["duration_days"]
    if "strip_thumbnail" in updates:
        med.strip_thumbnail = updates["strip_thumbnail"]
    if "prescribed_by" in updates:
        med.prescribed_by = updates["prescribed_by"]

    pattern_input = updates.get("dosage_pattern") or med.dosage_pattern
    meal_input = updates.get("meal_relation") or med.meal_relation
    slots, as_needed, normalized_pattern, effective_meal = parse_indian_dosage_pattern(
        dosage_pattern=pattern_input,
        meal_relation=meal_input,  # type: ignore[arg-type]
        brand_name=med.brand_name,
        generic_name=med.generic_name,
    )
    med.dosage_pattern = normalized_pattern
    med.meal_relation = effective_meal
    med.schedule_slots = [s.model_dump() for s in slots]
    med.as_needed = as_needed
    if "pill_color_tag" in updates and updates["pill_color_tag"]:
        med.pill_color_tag = updates["pill_color_tag"]
    elif "dosage_pattern" in updates or "meal_relation" in updates:
        med.pill_color_tag = pick_pill_color_tag(slots, as_needed)

    schedule_changed = bool(
        {"brand_name", "strength", "dosage_form", "dosage_pattern", "meal_relation"} & updates.keys()
    )
    if schedule_changed:
        generated = build_multilingual_instructions(
            brand_name=med.brand_name,
            strength=med.strength,
            dosage_form=med.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
        )
    else:
        generated = {}

    for lang_key in ("en", "hi", "mr"):
        field_name = f"instructions_{lang_key}"
        if field_name in updates:
            setattr(med, field_name, updates[field_name] or generated.get(lang_key))
        elif schedule_changed:
            setattr(med, field_name, generated[lang_key])

    db.flush()
    _recompute_profile_safety_flags(db, med.profile_id)
    db.commit()
    db.refresh(med)
    return _serialize_medicine(med)


@app.delete("/medicines/{medicine_id}", tags=["Caregiver Mode"])
def deactivate_medicine(
    medicine_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    med = db.get(Medicine, medicine_id)
    if not med:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Medicine id={medicine_id} not found.",
        )
    med.is_active = False
    db.commit()
    return {"deleted": True, "medicine_id": medicine_id, "brand_name": med.brand_name}


@app.delete(
    "/profile/{share_code}/medicines",
    response_model=MedicinesFlushResponse,
    tags=["Caregiver Mode"],
)
def flush_profile_medicines(
    share_code: str,
    db: Session = Depends(get_db),
) -> MedicinesFlushResponse:
    """Flush (deactivate) all active medicines for a share_code so schedules can start fresh."""
    profile = _get_profile_or_404(db, share_code)
    count = _deactivate_profile_medicines(db, profile.id)
    db.commit()
    return MedicinesFlushResponse(
        flushed=True,
        share_code=profile.share_code,
        deactivated_count=count,
    )


# =============================================================================
# 5. Nani Mode: High-Contrast Daily Schedule & Dose Marking
# =============================================================================


@app.get("/schedule/{share_code}", response_model=NaniScheduleResponse, tags=["Nani Mode"])
def get_nani_schedule(
    share_code: str,
    schedule_date: date | None = Query(
        default=None,
        description="IST date YYYY-MM-DD (defaults to today IST).",
    ),
    lang: LanguageCode | None = Query(
        default=None,
        description="Optional spoken audio language override: hi, mr, or en.",
    ),
    db: Session = Depends(get_db),
) -> NaniScheduleResponse:
    """Load verified high-contrast Nani Mode medicine cards with Hindi/Marathi/English audio scripts."""
    profile = _get_profile_or_404(db, share_code)
    target_date = schedule_date or get_ist_today()
    return _build_schedule_for_profile(db, profile, target_date, lang=lang)


@app.post("/doses/mark", response_model=DoseLogResponse, tags=["Nani Mode"])
def mark_dose(
    payload: DoseMarkRequest,
    db: Session = Depends(get_db),
) -> DoseLogResponse:
    """Mark a dose as taken, skipped, or snoozed (idempotent per medicine/date/slot)."""
    profile = _get_profile_or_404(db, payload.share_code)
    med = db.scalar(
        select(Medicine).where(
            and_(Medicine.id == payload.medicine_id, Medicine.profile_id == profile.id)
        )
    )
    if not med:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Medicine id={payload.medicine_id} does not belong to "
                f"share_code '{profile.share_code}'."
            ),
        )

    target_date = payload.dose_date or get_ist_today()

    # Resolve scheduled_slot cleanly even when simplified clients send morning/afternoon/night
    med_slots = med.schedule_slots or []
    slot_names = [str(s.get("slot")) for s in med_slots if s.get("slot")]
    effective_slot = payload.scheduled_slot
    if effective_slot not in slot_names:
        slot_aliases: dict[str, tuple[str, ...]] = {
            "morning": ("empty_stomach",),
            "afternoon": ("evening",),
            "night": ("sos",),
        }
        for alias in slot_aliases.get(payload.scheduled_slot, ()):
            if alias in slot_names:
                effective_slot = alias  # type: ignore[assignment]
                break

    # Resolve scheduled_time from medicine's slot metadata if not explicitly provided
    resolved_time = payload.scheduled_time
    if not resolved_time:
        matching_slot = next(
            (s for s in med_slots if s.get("slot") == effective_slot),
            None,
        )
        resolved_time = (
            str(matching_slot["time"])
            if matching_slot and matching_slot.get("time")
            else get_ist_now().strftime("%H:%M")
        )

    existing_log = db.scalar(
        select(DoseLog).where(
            and_(
                DoseLog.medicine_id == med.id,
                DoseLog.dose_date == target_date,
                DoseLog.scheduled_slot == effective_slot,
            )
        )
    )

    now_utc = datetime.now(timezone.utc)
    if existing_log:
        existing_log.status = payload.status
        existing_log.scheduled_time = resolved_time
        existing_log.taken_at = now_utc if payload.status == "taken" else None
        existing_log.marked_by = payload.marked_by
        if payload.notes is not None:
            existing_log.notes = payload.notes
        log = existing_log
    else:
        log = DoseLog(
            profile_id=profile.id,
            medicine_id=med.id,
            dose_date=target_date,
            scheduled_slot=effective_slot,
            scheduled_time=resolved_time,
            status=payload.status,
            taken_at=now_utc if payload.status == "taken" else None,
            marked_by=payload.marked_by,
            notes=payload.notes,
        )
        db.add(log)

    db.commit()
    db.refresh(log)

    return DoseLogResponse(
        id=log.id,
        profile_id=log.profile_id,
        medicine_id=log.medicine_id,
        brand_name=med.brand_name,
        dose_date=log.dose_date,
        scheduled_slot=log.scheduled_slot,
        scheduled_time=log.scheduled_time,
        status=log.status,
        taken_at=log.taken_at,
        marked_by=log.marked_by,
        notes=log.notes,
    )


@app.get("/doses/{share_code}", response_model=list[DoseLogResponse], tags=["Nani Mode"])
def list_dose_logs(
    share_code: str,
    dose_date: date | None = Query(default=None, description="IST date YYYY-MM-DD (defaults to today)."),
    db: Session = Depends(get_db),
) -> list[DoseLogResponse]:
    profile = _get_profile_or_404(db, share_code)
    target_date = dose_date or get_ist_today()

    rows = db.execute(
        select(DoseLog, Medicine.brand_name)
        .join(Medicine, DoseLog.medicine_id == Medicine.id)
        .where(and_(DoseLog.profile_id == profile.id, DoseLog.dose_date == target_date))
        .order_by(DoseLog.scheduled_time.asc(), DoseLog.id.asc())
    ).all()

    return [
        DoseLogResponse(
            id=log.id,
            profile_id=log.profile_id,
            medicine_id=log.medicine_id,
            brand_name=brand_name,
            dose_date=log.dose_date,
            scheduled_slot=log.scheduled_slot,
            scheduled_time=log.scheduled_time,
            status=log.status,
            taken_at=log.taken_at,
            marked_by=log.marked_by,
            notes=log.notes,
        )
        for log, brand_name in rows
    ]


# =============================================================================
# 6. Vitals Logging & Deterministic Clinical Rule Engine
# =============================================================================


@app.post(
    "/vitals",
    response_model=VitalResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Vitals & Family Loop"],
)
def log_vitals(
    payload: VitalCreateRequest,
    db: Session = Depends(get_db),
) -> VitalResponse:
    """Log temperature (°F), BP (mmHg), and weight (kg) and flag abnormal values deterministically."""
    profile = _get_profile_or_404(db, payload.share_code)

    previous_weight_kg: float | None = None
    days_since_prev: float | None = None
    if payload.weight_kg is not None:
        prev_vital = db.scalar(
            select(VitalLog)
            .where(and_(VitalLog.profile_id == profile.id, VitalLog.weight_kg.is_not(None)))
            .order_by(VitalLog.recorded_at.desc())
            .limit(1)
        )
        if prev_vital and prev_vital.weight_kg is not None:
            previous_weight_kg = prev_vital.weight_kg
            prev_ts = prev_vital.recorded_at
            if prev_ts.tzinfo is None:
                prev_ts = prev_ts.replace(tzinfo=timezone.utc)
            days_since_prev = max(
                0.1,
                (datetime.now(timezone.utc) - prev_ts).total_seconds() / 86400.0,
            )

    overall_status, flags, summary_en, summary_hi, summary_mr = evaluate_vitals(
        temperature_f=payload.temperature_f,
        systolic_mmhg=payload.systolic_mmhg,
        diastolic_mmhg=payload.diastolic_mmhg,
        weight_kg=payload.weight_kg,
        pulse_bpm=payload.pulse_bpm,
        spo2_percent=payload.spo2_percent,
        blood_sugar_mgdl=payload.blood_sugar_mgdl,
        previous_weight_kg=previous_weight_kg,
        days_since_previous_weight=days_since_prev,
    )

    vital = VitalLog(
        profile_id=profile.id,
        recorded_at=datetime.now(timezone.utc),
        temperature_f=payload.temperature_f,
        systolic_mmhg=payload.systolic_mmhg,
        diastolic_mmhg=payload.diastolic_mmhg,
        weight_kg=payload.weight_kg,
        pulse_bpm=payload.pulse_bpm,
        spo2_percent=payload.spo2_percent,
        blood_sugar_mgdl=payload.blood_sugar_mgdl,
        overall_status=overall_status,
        flags=[f.model_dump() for f in flags],
        notes=payload.notes,
        recorded_by=payload.recorded_by,
    )
    db.add(vital)
    db.commit()
    db.refresh(vital)

    return VitalResponse(
        id=vital.id,
        profile_id=vital.profile_id,
        share_code=profile.share_code,
        recorded_at=vital.recorded_at,
        temperature_f=vital.temperature_f,
        systolic_mmhg=vital.systolic_mmhg,
        diastolic_mmhg=vital.diastolic_mmhg,
        weight_kg=vital.weight_kg,
        pulse_bpm=vital.pulse_bpm,
        spo2_percent=vital.spo2_percent,
        blood_sugar_mgdl=vital.blood_sugar_mgdl,
        overall_status=overall_status,
        flags=flags,
        alert_summary_en=summary_en,
        alert_summary_hi=summary_hi,
        alert_summary_mr=summary_mr,
        notes=vital.notes,
        recorded_by=vital.recorded_by,
    )


@app.get("/vitals/{share_code}", response_model=VitalsHistoryResponse, tags=["Vitals & Family Loop"])
def get_vitals_history(
    share_code: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> VitalsHistoryResponse:
    profile = _get_profile_or_404(db, share_code)
    logs = list(
        db.scalars(
            select(VitalLog)
            .where(VitalLog.profile_id == profile.id)
            .order_by(VitalLog.recorded_at.desc())
            .limit(limit)
        )
    )
    serialized = [_serialize_vital(v, profile.share_code) for v in logs]
    return VitalsHistoryResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        count=len(serialized),
        latest_status=serialized[0].overall_status if serialized else None,
        vitals=serialized,
    )


@app.delete(
    "/vitals/{vital_id}",
    response_model=VitalDeleteResponse,
    tags=["Vitals & Family Loop"],
)
def delete_vital_log(
    vital_id: int,
    db: Session = Depends(get_db),
) -> VitalDeleteResponse:
    """Delete a vital reading by ID so frontend deletions persist in PostgreSQL."""
    vital = db.get(VitalLog, vital_id)
    if not vital:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"VitalLog id={vital_id} not found.",
        )
    db.delete(vital)
    db.commit()
    return VitalDeleteResponse(deleted=True, vital_id=vital_id)


# =============================================================================
# 7. Family Daily Summary + Ready-to-Use WhatsApp Deep Link
# =============================================================================


@app.get(
    "/profile/{share_code}/summary",
    response_model=DailySummaryResponse,
    tags=["Vitals & Family Loop"],
)
def get_daily_summary(
    share_code: str,
    report_date: date | None = Query(
        default=None,
        description="IST date YYYY-MM-DD for the daily report (defaults to today IST).",
    ),
    phone: str | None = Query(
        default=None,
        description="Optional WhatsApp phone number (e.g. +919876543210). If omitted, generates https://wa.me/?text=... for sharing to any family group.",
    ),
    db: Session = Depends(get_db),
) -> DailySummaryResponse:
    """Return daily adherence + vitals report and a ready-to-use https://wa.me/?text=... deep link."""
    profile = _get_profile_or_404(db, share_code)
    target_date = report_date or get_ist_today()
    schedule = _build_schedule_for_profile(db, profile, target_date)

    taken_list = [f"{c.brand_name} ({c.slot_label_en})" for c in schedule.cards if c.status == "taken"]
    pending_list = [
        f"{c.brand_name} ({c.scheduled_time})"
        for c in schedule.cards
        if c.status in ("due_now", "upcoming", "snoozed")
    ]
    missed_list = [
        f"{c.brand_name} ({c.scheduled_time})" for c in schedule.cards if c.status == "missed"
    ]
    skipped_count = sum(1 for c in schedule.cards if c.status == "skipped")

    latest_vital_row = db.scalar(
        select(VitalLog)
        .where(VitalLog.profile_id == profile.id)
        .order_by(VitalLog.recorded_at.desc())
        .limit(1)
    )
    latest_vital = _serialize_vital(latest_vital_row, profile.share_code) if latest_vital_row else None

    latest_vital_lines: list[str] = []
    abnormal_flags: list[VitalFlag] = []
    if latest_vital:
        if latest_vital.temperature_f is not None:
            latest_vital_lines.append(f"Temp {latest_vital.temperature_f:.1f}°F")
        if latest_vital.systolic_mmhg is not None and latest_vital.diastolic_mmhg is not None:
            latest_vital_lines.append(
                f"BP {latest_vital.systolic_mmhg}/{latest_vital.diastolic_mmhg} mmHg"
            )
        if latest_vital.weight_kg is not None:
            latest_vital_lines.append(f"Weight {latest_vital.weight_kg:.1f} kg")
        if latest_vital.pulse_bpm is not None:
            latest_vital_lines.append(f"Pulse {latest_vital.pulse_bpm} bpm")
        if latest_vital.spo2_percent is not None:
            latest_vital_lines.append(f"SpO2 {latest_vital.spo2_percent}%")
        if latest_vital.blood_sugar_mgdl is not None:
            latest_vital_lines.append(f"Sugar {latest_vital.blood_sugar_mgdl:.0f} mg/dL")
        abnormal_flags = [f for f in latest_vital.flags if f.status != "normal"]

    # Collect unique safety flags across active medicines
    seen_flag_keys: set[tuple[str, tuple[str, ...]]] = set()
    active_safety_flags: list[SafetyFlag] = []
    for card in schedule.cards + schedule.as_needed_cards:
        for flag in card.safety_flags:
            dedupe_key = (flag.code, tuple(sorted(flag.affected_medicines)))
            if dedupe_key not in seen_flag_keys:
                seen_flag_keys.add(dedupe_key)
                active_safety_flags.append(flag)

    whatsapp_message, whatsapp_url = build_whatsapp_summary(
        elder_name=profile.elder_name,
        share_code=profile.share_code,
        report_date=target_date,
        adherence_percent=schedule.adherence_percent,
        doses_taken=schedule.taken_count,
        doses_total=schedule.total_scheduled,
        taken_medicines=taken_list,
        pending_medicines=pending_list,
        missed_medicines=missed_list,
        latest_vital_lines=latest_vital_lines,
        abnormal_vital_flags=abnormal_flags,
        active_safety_flags=active_safety_flags,
        caregiver_phone=phone,
    )

    return DailySummaryResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        caregiver_name=profile.caregiver_name,
        report_date=target_date,
        generated_at_ist=get_ist_now().strftime("%Y-%m-%d %H:%M IST"),
        adherence_percent=schedule.adherence_percent,
        doses_total=schedule.total_scheduled,
        doses_taken=schedule.taken_count,
        doses_pending=schedule.pending_count,
        doses_missed=schedule.missed_count,
        doses_skipped=skipped_count,
        taken_medicines=taken_list,
        pending_medicines=pending_list,
        missed_medicines=missed_list,
        latest_vital=latest_vital,
        abnormal_vital_flags=abnormal_flags,
        active_safety_flags=active_safety_flags,
        whatsapp_message=whatsapp_message,
        whatsapp_url=whatsapp_url,
    )


# =============================================================================
# Neural Text-to-Speech Endpoint (English / Hindi / Marathi)
# =============================================================================

_TTS_VOICE_MAP: dict[str, str] = {
    "en": "en-IN-NeerjaNeural",
    "hi": "hi-IN-SwaraNeural",
    "mr": "mr-IN-AarohiNeural",
}
_TTS_CACHE: OrderedDict[tuple[str, str], bytes] = OrderedDict()
_TTS_CACHE_MAX_ITEMS = 128


async def _synthesize_neural_tts(text: str, language: str) -> tuple[bytes, str]:
    """Synthesize natural Indian neural speech (MP3) using edge-tts with LRU caching."""
    voice = _TTS_VOICE_MAP.get(language, _TTS_VOICE_MAP["en"])
    cache_key = (voice, text)
    if cache_key in _TTS_CACHE:
        _TTS_CACHE.move_to_end(cache_key)
        return _TTS_CACHE[cache_key], voice

    import edge_tts

    communicator = edge_tts.Communicate(text=text, voice=voice, rate="-6%")
    audio_buf = bytearray()
    async for chunk in communicator.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            audio_buf.extend(chunk["data"])

    audio_bytes = bytes(audio_buf)
    if not audio_bytes:
        raise RuntimeError(f"Empty audio stream from {voice}")

    _TTS_CACHE[cache_key] = audio_bytes
    if len(_TTS_CACHE) > _TTS_CACHE_MAX_ITEMS:
        _TTS_CACHE.popitem(last=False)

    return audio_bytes, voice


@app.post("/tts", tags=["Nani Mode"])
async def synthesize_speech(payload: TTSRequest) -> Response:
    """Return natural Indian neural MP3 audio for English, Hindi, or Marathi text."""
    cleaned_text = " ".join(payload.text.split())
    if not cleaned_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text for speech synthesis cannot be empty.",
        )

    try:
        audio_bytes, voice = await _synthesize_neural_tts(cleaned_text, payload.language)
    except Exception as exc:
        logger.warning("Neural TTS synthesis failed (%s): %s", payload.language, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Neural TTS temporarily unavailable; use browser speech fallback.",
        ) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "X-TTS-Voice": voice,
            "Cache-Control": "public, max-age=3600",
        },
    )
