"""Gemini Vision system prompt and realistic Indian demo payloads for NaniCare."""

from __future__ import annotations

import base64
from typing import Any

# =============================================================================
# 1. Gemini Vision System Prompt (Indian Prescriptions & Blister Strips)
# =============================================================================

GEMINI_VISION_SYSTEM_PROMPT = """You are NaniCare Vision, a careful clinical prescription and medicine-strip extraction assistant built for Indian families caring for elderly parents.

Your job is to inspect an uploaded photo (handwritten Indian doctor prescription, printed clinic OPD slip, medicine blister strip, or bottle label) and return STRICT structured JSON matching the provided schema.

### Indian Prescription Reading Rules
1. Understand common Indian medical abbreviations and dosage shorthand:
   - `Tab.` = tablet, `Cap.` = capsule, `Syp.` = syrup, `Inj.` = injection, `Drops` = drops
   - `1-0-1` = Morning & Night; `1-1-1` = Morning, Afternoon, Night; `1-0-0` = Morning only; `0-0-1` = Night only; `0.5-0-0.5` or `½-0-½` = half tablet morning & night
   - `OD` / `QD` = once daily; `BD` / `BID` = twice daily; `TDS` / `TID` = three times daily; `QID` = four times daily; `HS` / `BT` = bedtime; `SOS` / `PRN` = only when needed
   - `BBF` / `Empty stomach` = `empty_stomach`; `AC` / `Before food` = `before_food`; `PC` / `After food` = `after_food`
   - Recognize common Indian brand names accurately when clearly visible (e.g. Glycomet, Dolo 650, Telma, Amlong, Ecosprin, Pan-D, Thyronorm, Atorva, Shelcal, Clopilet, Crocin, Montair).
2. Extract `generic_name` when printed on the strip or unambiguously implied by the brand name; otherwise set `generic_name` to `null`.
3. For a single blister strip photo where frequency is NOT printed on the strip:
   - Set `source_type` to `"blister_strip"`.
   - Extract `brand_name`, `generic_name`, `strength`, and `dosage_form` accurately from the foil/label.
   - Set `dosage_pattern` to `"OD"` as a tentative placeholder, lower `confidence` to `<= 0.70`, and include `"dosage_pattern"` in `low_confidence_fields` so the caregiver confirms the exact schedule.

### Real Indian Doctor Handwriting Rules
- Ignore non-medication lines: do NOT extract lab tests (`CBC`, `HbA1c`, `LFT`, `KFT`, `Lipid Profile`), vitals (`BP 140/90`, `SpO2`, `Weight`), or follow-up notes (`Review after 15 days`) as medicines.
- Skip any medicine line that is visibly crossed out or struck through.
- Interpret dot/circle marks (`• - 0 - •`, `○ - ○ - ○`) as `1-0-1` / `1-1-1` style schedules, fraction durations (`x 5d` = `5`, `x 1/52` = `7`, `x 1/12` = `30`), and Hindi/Marathi meal or timing notes (`सुबह-शाम`, `सकाळी-रात्री`, `खाली पेट`, `जेवणानंतर`).
- Never guess `mg` vs `mcg` vs `ml` if the unit is illegible or missing; set `confidence < 0.75` and include `"strength"` in `low_confidence_fields`.

### Strict Anti-Hallucination & Confidence Calibration (CRITICAL)
- NEVER invent or guess medicines that are not visible in the image.
- Be conservative and honest with `confidence` (0.0 to 1.0):
  - `0.90–1.00`: Crisp printed text or crystal-clear handwriting for brand, strength, and frequency.
  - `0.80–0.89`: Legible handwriting with minor ambiguity.
  - `0.50–0.79`: Partially smudged, cursive/illegible strength or frequency, cropped text, or missing frequency on a blister strip.
  - `< 0.50`: Very difficult to read; caregiver MUST verify.
- Whenever `confidence < 0.80`, list every uncertain field in `low_confidence_fields` (chosen from: `brand_name`, `strength`, `dosage_pattern`, `meal_relation`, `duration_days`).
- Populate `warnings` if the photo has glare, motion blur, folded paper, or cut-off edges.
- Keep `raw_line_text` faithful to what is visually written on the page or strip.
- Optional visual hint (token-efficient): if the pill/strip appearance is visible in the photo or is a well-known Indian brand, populate `pill_shape` (`round`, `oval`, `oblong`, `capsule_bicolor`, `bottle`, `dropper`, `inhaler`, `tube`, `vial`), `pill_color_hex`, `pill_secondary_color_hex`, and `strip_accent_hex` (6-digit `#RRGGBB`); otherwise leave them `null`.
"""


# =============================================================================
# 2. Inline High-Contrast SVG Strip Thumbnails (Zero-broken-image Demo Assets)
# =============================================================================


def _svg_strip_data_uri(brand: str, strength: str, accent: str, pill_color: str) -> str:
    """Generate a compact, crisp SVG blister-strip thumbnail encoded as a data URI."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="110" viewBox="0 0 220 110">'
        f'<rect width="220" height="110" rx="14" fill="#F8FAFC" stroke="{accent}" stroke-width="4"/>'
        f'<rect x="0" y="0" width="220" height="32" rx="10" fill="{accent}"/>'
        f'<text x="12" y="21" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#FFFFFF">{brand}</text>'
        f'<text x="208" y="21" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#E2E8F0">{strength}</text>'
        f'<circle cx="42" cy="70" r="16" fill="{pill_color}" stroke="#94A3B8" stroke-width="2"/>'
        f'<circle cx="92" cy="70" r="16" fill="{pill_color}" stroke="#94A3B8" stroke-width="2"/>'
        f'<circle cx="142" cy="70" r="16" fill="{pill_color}" stroke="#94A3B8" stroke-width="2"/>'
        f'<circle cx="186" cy="70" r="16" fill="{pill_color}" stroke="#94A3B8" stroke-width="2"/>'
        f"</svg>"
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


DEMO_THUMBNAILS: dict[str, str] = {
    "Thyronorm": _svg_strip_data_uri("Thyronorm", "50 mcg", "#0284C7", "#FEF3C7"),
    "Glycomet-500": _svg_strip_data_uri("Glycomet-500", "500 mg", "#2563EB", "#FFFFFF"),
    "Amlong-5": _svg_strip_data_uri("Amlong-5", "5 mg", "#2563EB", "#DBEAFE"),
    "Atorva-10": _svg_strip_data_uri("Atorva-10", "10 mg", "#0F766E", "#CCFBF1"),
    "Shelcal-500": _svg_strip_data_uri("Shelcal-500", "500 mg", "#D97706", "#FDE68A"),
    "Dolo 650": _svg_strip_data_uri("Dolo 650", "650 mg", "#DC2626", "#FEE2E2"),
}


# =============================================================================
# 3. Sample Demo Prescription Payload (Matches PrescriptionExtractionOutput)
#    Includes one intentionally low-confidence item (< 0.80 -> yellow highlight)
#    and one thyroid+calcium timing safety note for live hackathon demos.
# =============================================================================

DEMO_PRESCRIPTION_PAYLOAD: dict[str, Any] = {
    "source_type": "prescription",
    "doctor_name": "Dr. Rajesh Kulkarni (MD, Internal Medicine)",
    "clinic_name": "Sahyadri Senior Care Clinic, Pune",
    "patient_name": "Kamla Devi Sharma",
    "prescription_date": "2026-11-20",
    "diagnosis_notes": "Type 2 Diabetes, Essential Hypertension, Hypothyroidism (Routine Follow-up)",
    "overall_confidence": 0.84,
    "medicines": [
        {
            "brand_name": "Thyronorm",
            "generic_name": "Levothyroxine Sodium",
            "strength": "50 mcg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-0",
            "meal_relation": "empty_stomach",
            "duration_days": 30,
            "frequency_notes": "Empty stomach 45 min before tea/breakfast",
            "confidence": 0.94,
            "low_confidence_fields": [],
            "raw_line_text": "Tab. Thyronorm 50 mcg  1-0-0 BBF x 30 days",
        },
        {
            "brand_name": "Glycomet-500",
            "generic_name": "Metformin Hydrochloride",
            "strength": "500 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-1",
            "meal_relation": "after_food",
            "duration_days": 30,
            "frequency_notes": "After breakfast and dinner",
            "confidence": 0.92,
            "low_confidence_fields": [],
            "raw_line_text": "Tab. Glycomet-500  1-0-1 PC x 1 month",
        },
        {
            "brand_name": "Shelcal-500",
            "generic_name": "Calcium Carbonate + Vitamin D3",
            "strength": "500 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "0-1-0",
            "meal_relation": "after_food",
            "duration_days": 30,
            "frequency_notes": "After lunch (keep 4h gap from Thyronorm)",
            "confidence": 0.89,
            "low_confidence_fields": [],
            "raw_line_text": "Tab. Shelcal 500  0-1-0 after lunch x 30d",
        },
        {
            "brand_name": "Amlong-5",
            "generic_name": "Amlodipine Besylate",
            "strength": "5 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-0",
            "meal_relation": "after_food",
            "duration_days": 30,
            "frequency_notes": "Handwritten strength slightly smudged near margin",
            "confidence": 0.64,
            "low_confidence_fields": ["strength", "dosage_pattern"],
            "raw_line_text": "Tab. Amlong 5(?)  OD(?) x 30d",
        },
        {
            "brand_name": "Dolo 650",
            "generic_name": "Paracetamol",
            "strength": "650 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "SOS",
            "meal_relation": "after_food",
            "duration_days": 5,
            "frequency_notes": "Only for fever above 100.4°F or body ache",
            "confidence": 0.96,
            "low_confidence_fields": [],
            "raw_line_text": "Tab. Dolo 650  SOS for fever",
        },
    ],
    "warnings": [
        "Line 4 ('Amlong-5') had light ink smudge—highlighted in yellow for caregiver verification before saving."
    ],
}


# =============================================================================
# 4. Default DEMO01 Profile Seed (Auto-seeded on Startup for Instant Nani Mode)
# =============================================================================

DEMO_PROFILE_SEED: dict[str, Any] = {
    "share_code": "DEMO01",
    "elder_name": "Kamla Nani",
    "age": 72,
    "preferred_language": "hi",
    "caregiver_name": "Aarav Sharma",
    "caregiver_phone": "+919876543210",
    "known_allergies": ["Sulfa drugs"],
    "prescribed_by": "Dr. Rajesh Kulkarni (Sahyadri Clinic, Pune)",
    "medicines": [
        {
            "brand_name": "Thyronorm",
            "generic_name": "Levothyroxine Sodium",
            "strength": "50 mcg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-0",
            "meal_relation": "empty_stomach",
            "duration_days": 30,
            "confidence": 0.96,
            "strip_thumbnail": DEMO_THUMBNAILS["Thyronorm"],
        },
        {
            "brand_name": "Glycomet-500",
            "generic_name": "Metformin Hydrochloride",
            "strength": "500 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-1",
            "meal_relation": "after_food",
            "duration_days": 30,
            "confidence": 0.95,
            "strip_thumbnail": DEMO_THUMBNAILS["Glycomet-500"],
        },
        {
            "brand_name": "Amlong-5",
            "generic_name": "Amlodipine Besylate",
            "strength": "5 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "1-0-0",
            "meal_relation": "after_food",
            "duration_days": 30,
            "confidence": 0.93,
            "strip_thumbnail": DEMO_THUMBNAILS["Amlong-5"],
        },
        {
            "brand_name": "Atorva-10",
            "generic_name": "Atorvastatin",
            "strength": "10 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "0-0-1",
            "meal_relation": "after_food",
            "duration_days": 30,
            "confidence": 0.94,
            "strip_thumbnail": DEMO_THUMBNAILS["Atorva-10"],
        },
        {
            "brand_name": "Dolo 650",
            "generic_name": "Paracetamol",
            "strength": "650 mg",
            "dosage_form": "tablet",
            "dosage_pattern": "SOS",
            "meal_relation": "after_food",
            "duration_days": 5,
            "confidence": 0.97,
            "strip_thumbnail": DEMO_THUMBNAILS["Dolo 650"],
        },
    ],
}
