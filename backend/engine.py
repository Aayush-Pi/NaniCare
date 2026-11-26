"""NaniCare FastAPI Backend Entry Point.

Voice-first eldercare prescription and vitals companion for Indian families.
Powered by FastAPI, Gemini Vision (Structured Outputs), and Neon PostgreSQL.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from database import SessionLocal, check_db_connection, get_db, init_db
from models import DoseLog, Medicine, MedicineCatalog, Profile, VitalLog
from prompts import DEMO_PRESCRIPTION_PAYLOAD, DEMO_PROFILE_SEED, DEMO_THUMBNAILS, GEMINI_VISION_SYSTEM_PROMPT
from scheduler import (
    LOW_CONFIDENCE_THRESHOLD,
    SLOT_SORT_ORDER,
    build_multilingual_instructions,
    build_slot_spoken_text,
    build_whatsapp_summary,
    compute_dose_status,
    compute_refill_status,
    evaluate_medicine_safety,
    evaluate_vitals,
    generate_share_code,
    get_ist_now,
    get_ist_today,
    parse_indian_dosage_pattern,
    pick_pill_color_tag,
)
from schemas import (
    CatalogEntryResponse,
    CatalogLookupRequest,
    CatalogLookupResponse,
    DailyAdherencePoint,
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
    RefillItem,
    RefillsResponse,
    SafetyFlag,
    ScanResponse,
    ScheduleSlot,
    StripVerifyResponse,
    TrendsResponse,
    TTSRequest,
    VisualSpec,
    VitalCreateRequest,
    VitalDeleteResponse,
    VitalFlag,
    VitalResponse,
    VitalsHistoryResponse,
    VitalsTrendSummary,
)
from visuals import (
    base_brand_root,
    default_visual_spec_for_form,
    describe_visual_for_elder,
    load_seed_catalog,
    normalize_medicine_key,
    render_medicine_svg,
    sanitize_hex,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("nanicare.engine")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "auto").strip() or "auto"
GEMINI_FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-pro",
)


def _gemini_model_candidates() -> list[str]:
    """Return ordered Gemini model names, skipping literal 'auto'."""
    candidates: list[str] = []
    if GEMINI_MODEL.lower() != "auto":
        candidates.append(GEMINI_MODEL)
    for model_name in GEMINI_FALLBACK_MODELS:
        if model_name not in candidates:
            candidates.append(model_name)
    return candidates
GEMINI_CALL_TIMEOUT_MS = 20_000  # per-model call cap so fallbacks cannot hang a scan
GEMINI_TOTAL_BUDGET_S = 50.0  # overall scan budget before falling back to demo/error


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
        logger.warning("Rejected invalid image upload: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid image (JPEG, PNG, or WEBP required).",
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
    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=GEMINI_CALL_TIMEOUT_MS),
    )
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
    """Try the configured Gemini model (or auto list) and fall back on 404/429/503 errors."""
    candidates = _gemini_model_candidates()

    last_exc: Exception | None = None
    extra_warnings: list[str] = []
    is_auto = GEMINI_MODEL.lower() == "auto"
    started = time.monotonic()
    for idx, model_name in enumerate(candidates):
        if last_exc is not None and time.monotonic() - started > GEMINI_TOTAL_BUDGET_S:
            break
        try:
            extraction = _call_gemini_vision(
                image_bytes=image_bytes,
                mime_type=mime_type,
                api_key=api_key,
                model_name=model_name,
            )
            if idx > 0 and not is_auto:
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


def _seed_medicine_catalog(db: Session) -> int:
    """Idempotently seed the Indian medicine visual catalog into medicine_catalog."""
    seed_rows = load_seed_catalog()
    if not seed_rows:
        return 0
    existing_keys = set(db.scalars(select(MedicineCatalog.normalized_key)))
    added = 0
    for row in seed_rows:
        key = normalize_medicine_key(str(row.get("key") or row.get("brand_name") or ""))
        if not key or key in existing_keys:
            continue
        db.add(
            MedicineCatalog(
                normalized_key=key,
                brand_name=str(row.get("brand_name") or key).strip(),
                aliases=[str(a).strip() for a in (row.get("aliases") or []) if str(a).strip()],
                generic_name=row.get("generic_name"),
                therapeutic_class=row.get("therapeutic_class"),
                dosage_form=str(row.get("dosage_form") or "tablet"),
                visual_spec=dict(row.get("visual_spec") or {}),
                source="seed_catalog",
            )
        )
        existing_keys.add(key)
        added += 1
    if added:
        db.commit()
        logger.info("Seeded %d Indian medicine visual catalog entries", added)
    return added


def _find_catalog_entry(
    db: Session | None,
    brand_name: str,
    generic_name: str | None = None,
) -> MedicineCatalog | None:
    """Tier-1 zero-token lookup in medicine_catalog by exact key, brand root, or alias."""
    if db is None:
        return None
    candidates = {
        normalize_medicine_key(brand_name),
        base_brand_root(brand_name),
    }
    if generic_name:
        candidates.add(normalize_medicine_key(generic_name))
        candidates.add(base_brand_root(generic_name))
    candidates.discard("")
    if not candidates:
        return None

    direct = db.scalar(
        select(MedicineCatalog).where(MedicineCatalog.normalized_key.in_(candidates)).limit(1)
    )
    if direct:
        return direct

    all_entries = list(db.scalars(select(MedicineCatalog)))
    brand_lower = brand_name.strip().lower()
    generic_lower = (generic_name or "").strip().lower()
    for entry in all_entries:
        alias_keys = {normalize_medicine_key(a) for a in (entry.aliases or [])}
        alias_roots = {base_brand_root(a) for a in (entry.aliases or [])}
        if candidates & (alias_keys | alias_roots):
            return entry
        for alias in entry.aliases or []:
            al = alias.strip().lower()
            if len(al) >= 4 and (al in brand_lower or (generic_lower and al in generic_lower)):
                return entry
    return None


def _serialize_catalog_entry(
    entry: MedicineCatalog,
    display_brand: str | None = None,
    strength: str | None = None,
) -> CatalogEntryResponse:
    spec_dict = dict(entry.visual_spec or default_visual_spec_for_form(entry.dosage_form))
    spec = VisualSpec.model_validate(spec_dict)
    thumb = render_medicine_svg(
        brand_name=display_brand or entry.brand_name,
        strength=strength,
        visual_spec=spec.model_dump(),
        dosage_form=entry.dosage_form,
    )
    return CatalogEntryResponse(
        id=entry.id,
        normalized_key=entry.normalized_key,
        brand_name=entry.brand_name,
        aliases=list(entry.aliases or []),
        generic_name=entry.generic_name,
        therapeutic_class=entry.therapeutic_class,
        dosage_form=entry.dosage_form,
        visual_spec=spec,
        strip_thumbnail=thumb,
        source=entry.source,
    )


def _resolve_visual_spec_and_source(
    db: Session | None,
    brand_name: str,
    generic_name: str | None,
    dosage_form: str,
    fallback_accent: str,
    ai_shape: str | None = None,
    ai_primary_hex: str | None = None,
    ai_secondary_hex: str | None = None,
    ai_accent_hex: str | None = None,
) -> tuple[dict[str, Any], str, str | None]:
    """Resolve compact VisualSpec, visual_source, and generic_name via 3-tier lookup."""
    entry = _find_catalog_entry(db, brand_name, generic_name)
    if entry is not None:
        spec = dict(entry.visual_spec or default_visual_spec_for_form(dosage_form or entry.dosage_form, fallback_accent))
        return spec, "catalog_verified", generic_name or entry.generic_name

    if ai_shape or ai_primary_hex or ai_accent_hex:
        spec = default_visual_spec_for_form(dosage_form, ai_accent_hex or fallback_accent)
        if ai_shape:
            spec["shape"] = ai_shape
        if ai_primary_hex:
            spec["primary_color"] = sanitize_hex(ai_primary_hex, spec["primary_color"])
        if ai_secondary_hex:
            spec["secondary_color"] = sanitize_hex(ai_secondary_hex, "#FFFFFF")
        if ai_accent_hex:
            spec["strip_accent"] = sanitize_hex(ai_accent_hex, fallback_accent)
        return spec, "ai_inferred", generic_name

    return default_visual_spec_for_form(dosage_form, fallback_accent), "generic_fallback", generic_name


def _resolve_medicine_visual(
    db: Session | None,
    brand_name: str,
    generic_name: str | None,
    strength: str | None,
    dosage_form: str,
    fallback_accent: str,
    source_type: str = "prescription",
    uploaded_thumbnail: str | None = None,
    single_medicine: bool = False,
    ai_shape: str | None = None,
    ai_primary_hex: str | None = None,
    ai_secondary_hex: str | None = None,
    ai_accent_hex: str | None = None,
) -> tuple[str, str, str | None, dict[str, Any]]:
    """3-Tier token-efficient visual resolver returning (data_uri, visual_source, resolved_generic, spec)."""
    spec, visual_source, resolved_generic = _resolve_visual_spec_and_source(
        db=db,
        brand_name=brand_name,
        generic_name=generic_name,
        dosage_form=dosage_form,
        fallback_accent=fallback_accent,
        ai_shape=ai_shape,
        ai_primary_hex=ai_primary_hex,
        ai_secondary_hex=ai_secondary_hex,
        ai_accent_hex=ai_accent_hex,
    )
    if source_type == "blister_strip" and uploaded_thumbnail and single_medicine:
        return uploaded_thumbnail, "uploaded_strip", resolved_generic, spec

    svg = render_medicine_svg(
        brand_name=brand_name,
        strength=strength,
        visual_spec=spec,
        dosage_form=dosage_form,
        fallback_accent=fallback_accent,
    )
    return svg, visual_source, resolved_generic, spec


def _upsert_catalog_on_confirm(db: Session, med: Medicine) -> None:
    """Auto-cache caregiver-confirmed new medicines into medicine_catalog for future 0-token hits."""
    if _find_catalog_entry(db, med.brand_name, med.generic_name) is not None:
        return
    key = base_brand_root(med.brand_name) or normalize_medicine_key(med.brand_name)
    if not key:
        return
    if db.scalar(select(MedicineCatalog.id).where(MedicineCatalog.normalized_key == key)):
        return
    db.add(
        MedicineCatalog(
            normalized_key=key,
            brand_name=med.brand_name.strip(),
            aliases=[med.brand_name.strip().lower()],
            generic_name=med.generic_name,
            therapeutic_class=None,
            dosage_form=med.dosage_form or "tablet",
            visual_spec=default_visual_spec_for_form(med.dosage_form, med.pill_color_tag),
            source="caregiver_confirmed",
        )
    )


def _call_gemini_catalog_lookup(
    query: str,
    dosage_form: str,
    api_key: str,
) -> tuple[str | None, str | None, VisualSpec]:
    """Tiny ~40-token text-only Gemini lookup for unknown Indian medicines."""
    from google import genai
    from google.genai import types
    from pydantic import BaseModel

    class _MiniLookup(BaseModel):
        generic_name: str | None = None
        therapeutic_class: str | None = None
        visual_spec: VisualSpec

    client = genai.Client(api_key=api_key)
    prompt = (
        f"Indian medicine lookup for '{query}' (form: {dosage_form}). "
        "Return generic_name, therapeutic_class, and a compact visual_spec "
        "(shape, primary_color hex, optional secondary_color hex, strip_accent hex, short imprint <=5 chars)."
    )
    for model_name in _gemini_model_candidates():
        try:
            resp = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                    response_schema=_MiniLookup,
                ),
            )
            parsed = (
                resp.parsed
                if isinstance(getattr(resp, "parsed", None), _MiniLookup)
                else _MiniLookup.model_validate_json((resp.text or "").strip())
            )
            return parsed.generic_name, parsed.therapeutic_class, parsed.visual_spec
        except Exception as exc:
            logger.warning("Catalog AI lookup failed on %s: %s", model_name, type(exc).__name__)
    raise RuntimeError("All Gemini models failed for catalog lookup.")


def _enrich_extraction(
    extraction: PrescriptionExtractionOutput,
    source: str,
    model_used: str,
    uploaded_thumbnail: str | None = None,
    extra_warnings: list[str] | None = None,
    db: Session | None = None,
    known_allergies: list[str] | None = None,
) -> ScanResponse:
    """Run deterministic Indian schedule + safety + vector visual enrichment on AI-extracted medicines."""
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

    per_med_flags, regimen_flags = evaluate_medicine_safety(
        med_dicts_for_safety,
        known_allergies=known_allergies,
    )

    enriched: list[EnrichedScannedMedicine] = []
    low_conf_count = 0
    is_single = len(parsed_entries) == 1

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

        color_tag = pick_pill_color_tag(slots, as_needed)
        strip_thumb, visual_source, resolved_generic, visual_spec = _resolve_medicine_visual(
            db=db,
            brand_name=med.brand_name,
            generic_name=med.generic_name,
            strength=med.strength,
            dosage_form=med.dosage_form,
            fallback_accent=color_tag,
            source_type=extraction.source_type,
            uploaded_thumbnail=uploaded_thumbnail,
            single_medicine=is_single,
            ai_shape=med.pill_shape,
            ai_primary_hex=med.pill_color_hex,
            ai_secondary_hex=med.pill_secondary_color_hex,
            ai_accent_hex=med.strip_accent_hex,
        )
        visual_desc = describe_visual_for_elder(
            visual_spec=visual_spec,
            dosage_form=med.dosage_form,
            strength=med.strength,
        )

        scripts = build_multilingual_instructions(
            brand_name=med.brand_name,
            strength=med.strength,
            dosage_form=med.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
            frequency_notes=med.frequency_notes,
            visual_desc=visual_desc,
        )

        enriched.append(
            EnrichedScannedMedicine(
                brand_name=med.brand_name,
                generic_name=resolved_generic,
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
                pill_color_tag=color_tag,
                strip_thumbnail=strip_thumb,
                visual_source=visual_source,  # type: ignore[arg-type]
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
        med_spec, _, _ = _resolve_visual_spec_and_source(
            db=db,
            brand_name=med.brand_name,
            generic_name=med.generic_name,
            dosage_form=med.dosage_form,
            fallback_accent=med.pill_color_tag,
        )
        visual_desc = describe_visual_for_elder(
            visual_spec=med_spec,
            dosage_form=med.dosage_form,
            strength=med.strength,
        )

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
                visual_desc=visual_desc,
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
        color_tag = pick_pill_color_tag(slots, as_needed)
        med_thumb, _, _, med_spec = _resolve_medicine_visual(
            db=db,
            brand_name=item["brand_name"],
            generic_name=item.get("generic_name"),
            strength=item.get("strength"),
            dosage_form=item["dosage_form"],
            fallback_accent=color_tag,
        )
        visual_desc = describe_visual_for_elder(
            visual_spec=med_spec,
            dosage_form=item["dosage_form"],
            strength=item.get("strength"),
        )
        scripts = build_multilingual_instructions(
            brand_name=item["brand_name"],
            strength=item.get("strength"),
            dosage_form=item["dosage_form"],
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
            visual_desc=visual_desc,
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
            strip_thumbnail=item.get("strip_thumbnail") or med_thumb,
            pill_color_tag=color_tag,
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
        _seed_medicine_catalog(db)
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
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)

_RATE_LIMITED_PATHS: frozenset[str] = frozenset(
    {"/scan", "/scan/verify-strip", "/tts", "/catalog/lookup"}
)
_RATE_LIMIT_WINDOW_SECONDS = 60.0
_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = {}


def _get_rate_limit_per_minute() -> int:
    raw = os.getenv("RATE_LIMIT_PER_MINUTE", "60").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 60


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next: Any) -> Response:
    """Apply baseline HTTP security headers and sliding-window rate limits on AI/TTS routes."""
    if request.method == "POST" and request.url.path in _RATE_LIMITED_PATHS:
        client_ip = (
            (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
            or (request.client.host if request.client else "unknown")
        )
        bucket_key = f"{client_ip}:{request.url.path}"
        now = time.monotonic()
        limit = _get_rate_limit_per_minute()
        timestamps = _RATE_LIMIT_BUCKETS.setdefault(bucket_key, deque())
        while timestamps and (now - timestamps[0]) > _RATE_LIMIT_WINDOW_SECONDS:
            timestamps.popleft()
        if len(timestamps) >= limit:
            retry_after = max(1, int(_RATE_LIMIT_WINDOW_SECONDS - (now - timestamps[0])))
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded. Please wait a moment and try again."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "DENY",
                },
            )
        timestamps.append(now)

    response: Response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(self), microphone=(self), geolocation=()"
    )
    return response


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
def get_demo_scan(db: Session = Depends(get_db)) -> ScanResponse:
    """Return a realistic Indian prescription extraction without uploading a file."""
    extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)
    return _enrich_extraction(
        extraction=extraction,
        source="demo_fallback",
        model_used="demo-payload",
        uploaded_thumbnail=None,
        db=db,
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
    share_code: str | None = Form(
        default=None,
        description="Optional share_code to run patient allergy cross-checks during scanning.",
    ),
    db: Session = Depends(get_db),
) -> ScanResponse:
    """Extract medicines from a prescription or blister strip via Gemini Vision + deterministic rules."""
    uploaded_thumbnail: str | None = None
    image_bytes: bytes | None = None
    mime_type = "image/jpeg"

    known_allergies: list[str] | None = None
    if share_code and share_code.strip():
        prof = db.scalar(select(Profile).where(Profile.share_code == share_code.strip().upper()))
        if prof and prof.known_allergies:
            known_allergies = list(prof.known_allergies)

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
            db=db,
            known_allergies=known_allergies,
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
            db=db,
            known_allergies=known_allergies,
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
            db=db,
            known_allergies=known_allergies,
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
    """Re-evaluate deterministic safety & allergy flags across all active medicines of a profile."""
    profile = db.get(Profile, profile_id)
    known_allergies = list(profile.known_allergies or []) if profile else None
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
    per_med_flags, regimen_flags = evaluate_medicine_safety(
        safety_inputs,
        known_allergies=known_allergies,
    )
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
            elder_name=payload.elder_name or "Family Member",
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
        color_tag = item.pill_color_tag or pick_pill_color_tag(slots, as_needed)
        resolved_thumb = item.strip_thumbnail
        resolved_generic = item.generic_name.strip() if item.generic_name else None
        computed_thumb, _, resolved_generic, resolved_spec = _resolve_medicine_visual(
            db=db,
            brand_name=item.brand_name.strip(),
            generic_name=resolved_generic,
            strength=item.strength.strip() if item.strength else None,
            dosage_form=item.dosage_form,
            fallback_accent=color_tag,
            source_type="prescription",
        )
        if not resolved_thumb:
            resolved_thumb = computed_thumb
        visual_desc = describe_visual_for_elder(
            visual_spec=resolved_spec,
            dosage_form=item.dosage_form,
            strength=item.strength,
        )
        generated_scripts = build_multilingual_instructions(
            brand_name=item.brand_name,
            strength=item.strength,
            dosage_form=item.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
            visual_desc=visual_desc,
        )

        med = Medicine(
            profile_id=profile.id,
            brand_name=item.brand_name.strip(),
            generic_name=resolved_generic,
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
            strip_thumbnail=resolved_thumb,
            pill_color_tag=color_tag,
            confidence=item.confidence,
            needs_review=False,
            safety_flags=[],
            verified_by_caregiver=True,
            is_active=True,
            prescribed_by=item.prescribed_by or payload.prescribed_by,
        )
        db.add(med)
        _upsert_catalog_on_confirm(db, med)
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
        med_spec, _, _ = _resolve_visual_spec_and_source(
            db=db,
            brand_name=med.brand_name,
            generic_name=med.generic_name,
            dosage_form=med.dosage_form,
            fallback_accent=med.pill_color_tag,
        )
        visual_desc = describe_visual_for_elder(
            visual_spec=med_spec,
            dosage_form=med.dosage_form,
            strength=med.strength,
        )
        generated = build_multilingual_instructions(
            brand_name=med.brand_name,
            strength=med.strength,
            dosage_form=med.dosage_form,
            meal_relation=effective_meal,
            schedule_slots=slots,
            as_needed=as_needed,
            visual_desc=visual_desc,
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

    # Collect refill alerts for active medicines nearing course end
    active_med_rows = list(
        db.scalars(
            select(Medicine)
            .where(and_(Medicine.profile_id == profile.id, Medicine.is_active.is_(True)))
            .order_by(Medicine.id.asc())
        )
    )
    refill_alerts: list[str] = []
    for med_row in active_med_rows:
        _, _, refill_status, msg_en, _, _ = compute_refill_status(
            brand_name=med_row.brand_name,
            created_at=med_row.created_at,
            duration_days=med_row.duration_days,
            today_ist=target_date,
        )
        if refill_status in ("refill_soon", "completed"):
            refill_alerts.append(msg_en)

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
        refill_alerts=refill_alerts,
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
        refill_alerts=refill_alerts,
        whatsapp_message=whatsapp_message,
        whatsapp_url=whatsapp_url,
    )


# =============================================================================
# 8. Medicine Visual Catalog, Refill Tracker, Strip Verifier & Trends APIs
# =============================================================================


@app.get(
    "/catalog/search",
    response_model=list[CatalogEntryResponse],
    tags=["Medicine Catalog"],
)
def search_medicine_catalog(
    q: str = Query(default="", max_length=120, description="Search brand, alias, or generic name."),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> list[CatalogEntryResponse]:
    """Zero-token instant search over the local Indian medicine visual catalog."""
    entries = list(db.scalars(select(MedicineCatalog).order_by(MedicineCatalog.brand_name.asc())))
    query = q.strip().lower()
    norm_q = normalize_medicine_key(query)
    if not query:
        return [_serialize_catalog_entry(e) for e in entries[:limit]]

    matches: list[MedicineCatalog] = []
    for entry in entries:
        haystack = " ".join(
            [
                entry.brand_name.lower(),
                entry.normalized_key,
                (entry.generic_name or "").lower(),
                (entry.therapeutic_class or "").lower(),
                " ".join(a.lower() for a in (entry.aliases or [])),
            ]
        )
        if query in haystack or (norm_q and norm_q in entry.normalized_key):
            matches.append(entry)
            if len(matches) >= limit:
                break
    return [_serialize_catalog_entry(e) for e in matches]


@app.post(
    "/catalog/lookup",
    response_model=CatalogLookupResponse,
    tags=["Medicine Catalog"],
)
def lookup_medicine_visual(
    payload: CatalogLookupRequest,
    db: Session = Depends(get_db),
) -> CatalogLookupResponse:
    """Resolve a medicine's visual vector & generic info via DB cache -> micro-AI -> generic fallback."""
    existing = _find_catalog_entry(db, payload.query)
    if existing is not None:
        return CatalogLookupResponse(
            found=True,
            cache_hit=True,
            visual_source="catalog_verified",
            entry=_serialize_catalog_entry(
                existing,
                display_brand=payload.query.strip(),
                strength=payload.strength,
            ),
        )

    api_key = _get_gemini_api_key()
    if payload.allow_ai and api_key:
        try:
            generic_name, therapeutic_class, spec = _call_gemini_catalog_lookup(
                query=payload.query.strip(),
                dosage_form=payload.dosage_form,
                api_key=api_key,
            )
            key = base_brand_root(payload.query) or normalize_medicine_key(payload.query)
            new_entry = MedicineCatalog(
                normalized_key=key or f"med{int(datetime.now(timezone.utc).timestamp())}",
                brand_name=payload.query.strip(),
                aliases=[payload.query.strip().lower()],
                generic_name=generic_name,
                therapeutic_class=therapeutic_class,
                dosage_form=payload.dosage_form,
                visual_spec=spec.model_dump(),
                source="ai_learned",
            )
            db.add(new_entry)
            db.commit()
            db.refresh(new_entry)
            return CatalogLookupResponse(
                found=True,
                cache_hit=False,
                visual_source="ai_inferred",
                entry=_serialize_catalog_entry(
                    new_entry,
                    display_brand=payload.query.strip(),
                    strength=payload.strength,
                ),
            )
        except Exception:
            logger.warning("Catalog micro-AI lookup fell back to deterministic vector")

    fallback_spec_dict = default_visual_spec_for_form(payload.dosage_form)
    fallback_spec = VisualSpec.model_validate(fallback_spec_dict)
    thumb = render_medicine_svg(
        brand_name=payload.query.strip(),
        strength=payload.strength,
        visual_spec=fallback_spec_dict,
        dosage_form=payload.dosage_form,
    )
    return CatalogLookupResponse(
        found=False,
        cache_hit=False,
        visual_source="generic_fallback",
        entry=CatalogEntryResponse(
            id=None,
            normalized_key=normalize_medicine_key(payload.query),
            brand_name=payload.query.strip(),
            aliases=[],
            generic_name=None,
            therapeutic_class=None,
            dosage_form=payload.dosage_form,
            visual_spec=fallback_spec,
            strip_thumbnail=thumb,
            source="generic_fallback",
        ),
    )


@app.get(
    "/profile/{share_code}/refills",
    response_model=RefillsResponse,
    tags=["Vitals & Family Loop"],
)
def get_profile_refills(
    share_code: str,
    db: Session = Depends(get_db),
) -> RefillsResponse:
    """Compute remaining course days and refill alerts for all active medicines (0 AI tokens)."""
    profile = _get_profile_or_404(db, share_code)
    today_ist = get_ist_today()
    active_meds = list(
        db.scalars(
            select(Medicine)
            .where(and_(Medicine.profile_id == profile.id, Medicine.is_active.is_(True)))
            .order_by(Medicine.id.asc())
        )
    )
    items: list[RefillItem] = []
    for med in active_meds:
        elapsed, remaining, status_val, msg_en, msg_hi, msg_mr = compute_refill_status(
            brand_name=med.brand_name,
            created_at=med.created_at,
            duration_days=med.duration_days,
            today_ist=today_ist,
        )
        items.append(
            RefillItem(
                medicine_id=med.id,
                brand_name=med.brand_name,
                strength=med.strength,
                duration_days=med.duration_days,
                days_elapsed=elapsed,
                days_remaining=remaining,
                status=status_val,  # type: ignore[arg-type]
                message_en=msg_en,
                message_hi=msg_hi,
                message_mr=msg_mr,
            )
        )

    items.sort(key=lambda i: (9999 if i.days_remaining is None else i.days_remaining, i.medicine_id))
    return RefillsResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        as_of_date=today_ist,
        refill_soon_count=sum(1 for i in items if i.status == "refill_soon"),
        completed_count=sum(1 for i in items if i.status == "completed"),
        items=items,
    )


@app.post(
    "/scan/verify-strip",
    response_model=StripVerifyResponse,
    tags=["Nani Mode"],
)
async def verify_medicine_strip(
    share_code: str = Form(default=DEFAULT_SHARE_CODE),
    file: UploadFile | None = File(default=None),
    demo: bool = Form(default=False),
    db: Session = Depends(get_db),
) -> StripVerifyResponse:
    """'Is this the right pill?' — matches a photographed blister strip against active verified medicines."""
    profile = _get_profile_or_404(db, share_code)
    active_meds = list(
        db.scalars(
            select(Medicine)
            .where(and_(Medicine.profile_id == profile.id, Medicine.is_active.is_(True)))
            .order_by(Medicine.id.asc())
        )
    )

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
                detail="Image exceeds 12 MB limit.",
            )
        _, mime_type = _create_thumbnail_data_uri(image_bytes)

    api_key = _get_gemini_api_key()
    if demo or image_bytes is None or api_key is None:
        extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)
    else:
        try:
            extraction, _, _ = _call_gemini_vision_with_fallback(
                image_bytes=image_bytes,
                mime_type=mime_type,
                api_key=api_key,
            )
        except Exception:
            logger.exception("Strip verification Gemini call failed; falling back to demo payload")
            extraction = PrescriptionExtractionOutput.model_validate(DEMO_PRESCRIPTION_PAYLOAD)

    if not extraction.medicines:
        return StripVerifyResponse(
            share_code=profile.share_code,
            matched=False,
            confidence=0.0,
            spoken_en="Sorry, I could not read the medicine name clearly. Please ask your caregiver.",
            spoken_hi="माफ़ कीजिए, दवाई का नाम साफ़ नहीं दिखा। कृपया अपने देखभालकर्ता से पूछें।",
            spoken_mr="माफ करा, औषधाचे नाव स्पष्ट दिसले नाही. कृपया तुमच्या काळजीवाहकाला विचारा.",
            warning="No readable medicine detected in the uploaded image.",
        )

    detected = extraction.medicines[0]
    det_key = normalize_medicine_key(detected.brand_name)
    det_root = base_brand_root(detected.brand_name)
    det_gen = normalize_medicine_key(detected.generic_name or "")

    best_match: Medicine | None = None
    for med in active_meds:
        m_key = normalize_medicine_key(med.brand_name)
        m_root = base_brand_root(med.brand_name)
        m_gen = normalize_medicine_key(med.generic_name or "")
        if (
            (det_key and det_key == m_key)
            or (det_root and m_root and det_root == m_root)
            or (det_gen and m_gen and det_gen == m_gen)
        ):
            best_match = med
            break

    if best_match is not None:
        slots = [ScheduleSlot.model_validate(s) for s in (best_match.schedule_slots or [])]
        slot_en = ", ".join(f"{s.label_en} ({s.time})" for s in slots) or "as advised"
        slot_hi = ", ".join(s.label_hi for s in slots) or "डॉक्टर की सलाह अनुसार"
        slot_mr = ", ".join(s.label_mr for s in slots) or "डॉक्टरांच्या सल्ल्यानुसार"
        med_spec, _, _ = _resolve_visual_spec_and_source(
            db=db,
            brand_name=best_match.brand_name,
            generic_name=best_match.generic_name,
            dosage_form=best_match.dosage_form,
            fallback_accent=best_match.pill_color_tag,
        )
        v_desc = describe_visual_for_elder(
            visual_spec=med_spec,
            dosage_form=best_match.dosage_form,
            strength=best_match.strength,
        )
        return StripVerifyResponse(
            share_code=profile.share_code,
            matched=True,
            confidence=round(float(detected.confidence), 3),
            detected_brand=detected.brand_name,
            detected_strength=detected.strength,
            matched_medicine=_serialize_medicine(best_match),
            next_slot_label=slot_en,
            spoken_en=(
                f"Yes, this is your {v_desc['en']} of {best_match.brand_name} "
                f"{best_match.strength or ''}. Scheduled for: {slot_en}."
            ).replace("  ", " "),
            spoken_hi=(
                f"हाँ, यह आपकी {best_match.brand_name} की {v_desc['hi']} है। "
                f"इसे {slot_hi} लेना है।"
            ),
            spoken_mr=(
                f"होय, ही तुमची {best_match.brand_name} ची {v_desc['mr']} आहे. "
                f"हे {slot_mr} घ्यायचे आहे."
            ),
        )

    return StripVerifyResponse(
        share_code=profile.share_code,
        matched=False,
        confidence=round(float(detected.confidence), 3),
        detected_brand=detected.brand_name,
        detected_strength=detected.strength,
        spoken_en=(
            f"Stop! {detected.brand_name} is NOT in your active verified schedule. "
            "Please check with your caregiver before taking it."
        ),
        spoken_hi=(
            f"रुकिए! {detected.brand_name} आपकी आज की सत्यापित सूची में नहीं है। "
            "इसे लेने से पहले अपने देखभालकर्ता से ज़रूर पूछें।"
        ),
        spoken_mr=(
            f"थांबा! {detected.brand_name} तुमच्या आजच्या प्रमाणित यादीत नाही. "
            "घेण्यापूर्वी कृपया तुमच्या काळजीवाहकाला विचारा."
        ),
        warning=f"'{detected.brand_name}' is not in {profile.share_code}'s active verified medicines.",
    )


@app.get(
    "/profile/{share_code}/trends",
    response_model=TrendsResponse,
    tags=["Vitals & Family Loop"],
)
def get_profile_trends(
    share_code: str,
    days: int = Query(default=7, ge=1, le=30),
    db: Session = Depends(get_db),
) -> TrendsResponse:
    """Return multi-day medication adherence & vitals trend analytics (0 AI tokens)."""
    profile = _get_profile_or_404(db, share_code)
    today_ist = get_ist_today()
    start_date = today_ist - timedelta(days=days - 1)

    active_meds = list(
        db.scalars(
            select(Medicine).where(
                and_(
                    Medicine.profile_id == profile.id,
                    Medicine.is_active.is_(True),
                    Medicine.as_needed.is_(False),
                )
            )
        )
    )
    scheduled_per_day = sum(len(m.schedule_slots or []) for m in active_meds)

    logs = list(
        db.scalars(
            select(DoseLog).where(
                and_(
                    DoseLog.profile_id == profile.id,
                    DoseLog.dose_date >= start_date,
                    DoseLog.dose_date <= today_ist,
                    DoseLog.status == "taken",
                )
            )
        )
    )
    taken_by_date: dict[date, int] = {}
    for log in logs:
        taken_by_date[log.dose_date] = taken_by_date.get(log.dose_date, 0) + 1

    daily_points: list[DailyAdherencePoint] = []
    for offset in range(days):
        d = start_date + timedelta(days=offset)
        taken = taken_by_date.get(d, 0)
        pct = round(min(100.0, (taken / scheduled_per_day) * 100.0), 1) if scheduled_per_day > 0 else 100.0
        daily_points.append(
            DailyAdherencePoint(
                date=d,
                taken=taken,
                total=scheduled_per_day,
                adherence_percent=pct,
            )
        )

    avg_pct = (
        round(sum(p.adherence_percent for p in daily_points) / len(daily_points), 1)
        if daily_points
        else 0.0
    )

    cutoff_utc = datetime.now(timezone.utc) - timedelta(days=days)
    vital_rows = list(
        db.scalars(
            select(VitalLog)
            .where(
                and_(
                    VitalLog.profile_id == profile.id,
                    VitalLog.recorded_at >= cutoff_utc,
                )
            )
            .order_by(VitalLog.recorded_at.asc())
        )
    )

    def _compute_direction(values: list[float], threshold: float) -> str:
        if len(values) < 2:
            return "insufficient_data"
        delta = values[-1] - values[0]
        if delta >= threshold:
            return "rising"
        if delta <= -threshold:
            return "falling"
        return "stable"

    systolics = [float(v.systolic_mmhg) for v in vital_rows if v.systolic_mmhg is not None]
    temps = [float(v.temperature_f) for v in vital_rows if v.temperature_f is not None]
    weights = [float(v.weight_kg) for v in vital_rows if v.weight_kg is not None]
    latest_v = vital_rows[-1] if vital_rows else None

    vitals_trend = VitalsTrendSummary(
        readings_count=len(vital_rows),
        latest_temperature_f=latest_v.temperature_f if latest_v else None,
        latest_systolic_mmhg=latest_v.systolic_mmhg if latest_v else None,
        latest_diastolic_mmhg=latest_v.diastolic_mmhg if latest_v else None,
        latest_weight_kg=latest_v.weight_kg if latest_v else None,
        systolic_trend=_compute_direction(systolics, 8.0),  # type: ignore[arg-type]
        temperature_trend=_compute_direction(temps, 0.8),  # type: ignore[arg-type]
        weight_delta_kg=round(weights[-1] - weights[0], 2) if len(weights) >= 2 else None,
        critical_events_count=sum(1 for v in vital_rows if v.overall_status == "critical"),
    )

    return TrendsResponse(
        share_code=profile.share_code,
        elder_name=profile.elder_name,
        days=days,
        average_adherence_percent=avg_pct,
        daily_adherence=daily_points,
        vitals_trend=vitals_trend,
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
_TTS_INFLIGHT: dict[tuple[str, str], asyncio.Task[bytes]] = {}


async def _run_edge_tts(text: str, voice: str) -> bytes:
    import edge_tts

    communicator = edge_tts.Communicate(text=text, voice=voice, rate="-6%")
    audio_buf = bytearray()
    async for chunk in communicator.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            audio_buf.extend(chunk["data"])

    audio_bytes = bytes(audio_buf)
    if not audio_bytes:
        raise RuntimeError(f"Empty audio stream from {voice}")
    return audio_bytes


async def _synthesize_neural_tts(text: str, language: str) -> tuple[bytes, str]:
    """Synthesize natural Indian neural speech (MP3) using edge-tts with LRU caching."""
    voice = _TTS_VOICE_MAP.get(language, _TTS_VOICE_MAP["en"])
    cache_key = (voice, text)
    if cache_key in _TTS_CACHE:
        _TTS_CACHE.move_to_end(cache_key)
        return _TTS_CACHE[cache_key], voice

    task = _TTS_INFLIGHT.get(cache_key)
    if task is None:
        task = asyncio.create_task(_run_edge_tts(text, voice))
        _TTS_INFLIGHT[cache_key] = task

    try:
        audio_bytes = await task
    finally:
        if _TTS_INFLIGHT.get(cache_key) is task and task.done():
            _TTS_INFLIGHT.pop(cache_key, None)

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
