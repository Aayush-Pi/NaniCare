"""Pure deterministic Python clinical logic for NaniCare.

Zero network or database I/O. Handles:
- IST (Asia/Kolkata) date/time utilities
- Indian prescription shorthand parsing (1-0-1, BD, TDS, HS, SOS, AC/PC/BBF)
- Meal-aligned schedule slot generation + high-contrast Nani UI colors
- Hindi, Marathi, and English elder-friendly spoken audio scripts
- Geriatric medication safety & interaction flagging
- Deterministic vitals rule engine (Temp °F, BP mmHg, Weight kg, Pulse, SpO2, Sugar)
- WhatsApp daily family digest & deep-link builder
"""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from schemas import (
    DoseStatus,
    MealRelation,
    SafetyFlag,
    ScheduleSlot,
    SlotName,
    VitalFlag,
    VitalStatus,
)

LOW_CONFIDENCE_THRESHOLD = 0.80

try:
    IST_TZ = ZoneInfo("Asia/Kolkata")
except ZoneInfoNotFoundError:  # pragma: no cover - fallback when tzdata missing
    IST_TZ = timezone(timedelta(hours=5, minutes=30))

# Unambiguous characters for elder-friendly share codes (excludes O/0, I/1/L)
_SHARE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

SLOT_METADATA: dict[SlotName, dict[str, str]] = {
    "empty_stomach": {
        "label_en": "Early Morning (Empty Stomach)",
        "label_hi": "सुबह खाली पेट",
        "label_mr": "सकाळी उपाशीपोटी",
        "color_hex": "#0284C7",  # High-contrast Sky Blue
    },
    "morning": {
        "label_en": "Morning",
        "label_hi": "सुबह",
        "label_mr": "सकाळी",
        "color_hex": "#2563EB",  # High-contrast Royal Blue
    },
    "afternoon": {
        "label_en": "Afternoon",
        "label_hi": "दोपहर",
        "label_mr": "दुपारी",
        "color_hex": "#D97706",  # High-contrast Amber
    },
    "evening": {
        "label_en": "Evening",
        "label_hi": "शाम",
        "label_mr": "संध्याकाळी",
        "color_hex": "#7C3AED",  # High-contrast Violet
    },
    "night": {
        "label_en": "Night",
        "label_hi": "रात",
        "label_mr": "रात्री",
        "color_hex": "#0F766E",  # High-contrast Deep Teal
    },
    "sos": {
        "label_en": "Only When Needed (SOS)",
        "label_hi": "केवल ज़रूरत पड़ने पर",
        "label_mr": "फक्त गरज असल्यास",
        "color_hex": "#DC2626",  # High-contrast Crimson
    },
}

SLOT_SORT_ORDER: dict[str, int] = {
    "empty_stomach": 0,
    "morning": 1,
    "afternoon": 2,
    "evening": 3,
    "night": 4,
    "sos": 5,
}

# Indian brand/generic keyword maps for deterministic clinical checks
_EMPTY_STOMACH_DRUGS = (
    "levothyroxine",
    "thyronorm",
    "eltroxin",
    "thyrox",
    "pantoprazole",
    "pan-d",
    "pan d",
    "pan 40",
    "pan40",
    "pantocid",
    "omeprazole",
    "omez",
    "rabeprazole",
    "razo",
    "esomeprazole",
    "nexpro",
)

_NIGHT_PREFERRED_DRUGS = (
    "atorvastatin",
    "atorva",
    "lipitor",
    "rosuvastatin",
    "rosuvas",
    "crestor",
    "simvastatin",
    "montelukast",
    "montair",
)

_MOLECULE_CLASS_MAP: dict[str, tuple[str, tuple[str, ...]]] = {
    "paracetamol": (
        "Paracetamol (Acetaminophen)",
        ("paracetamol", "acetaminophen", "dolo", "crocin", "calpol", "pacimol", "p-650", "p650"),
    ),
    "ppi": (
        "Acid-Suppressing PPI",
        ("pantoprazole", "pan-d", "pan d", "pan 40", "pan40", "pantocid", "omeprazole", "omez", "rabeprazole", "razo", "esomeprazole", "nexpro"),
    ),
    "nsaid": (
        "NSAID Painkiller",
        ("ibuprofen", "brufen", "combiflam", "diclofenac", "voveran", "aceclofenac", "zerodol", "naproxen", "piroxicam", "etoricoxib", "nucoxia"),
    ),
    "antiplatelet": (
        "Blood Thinner / Antiplatelet",
        ("aspirin", "ecosprin", "loprin", "clopidogrel", "clopilet", "deplatt", "ticagrelor", "brilinta"),
    ),
    "anticoagulant": (
        "Anticoagulant Blood Thinner",
        ("warfarin", "warf", "acitrom", "acenocoumarol", "apixaban", "eliquis", "rivaroxaban", "xarelto", "dabigatran"),
    ),
    "sulfonylurea": (
        "Sulfonylurea Diabetes Medicine",
        ("glimepiride", "amaryl", "glimy", "glipizide", "gliclazide", "glizid", "diamicron", "glibenclamide"),
    ),
    "insulin": (
        "Insulin",
        ("insulin", "mixtard", "lantus", "humalog", "novorapid", "glargine", "human actrapid"),
    ),
    "thyroid": (
        "Thyroid Hormone (Levothyroxine)",
        ("levothyroxine", "thyronorm", "eltroxin", "thyrox"),
    ),
    "calcium_iron": (
        "Calcium / Iron Supplement",
        ("calcium", "shelcal", "cipcal", "calcimax", "gemcal", "iron", "ferrous", "autrin", "dexorange", "orofer"),
    ),
    "arb_acei": (
        "BP Medicine (ACEi / ARB)",
        ("telmisartan", "telma", "tazloc", "losartan", "losar", "olmesartan", "ramipril", "cardace", "enalapril", "perindopril"),
    ),
    "statin": (
        "Cholesterol Statin",
        ("atorvastatin", "atorva", "rosuvastatin", "rosuvas", "simvastatin"),
    ),
    "digoxin": (
        "Digoxin (Cardiac Glycoside)",
        ("digoxin", "lanoxin"),
    ),
}

_HIGH_ALERT_RULES: dict[str, dict[str, str]] = {
    "anticoagulant": {
        "code": "HIGH_ALERT_ANTICOAGULANT",
        "severity": "critical",
        "title": "High-Alert Blood Thinner",
        "en": "High-alert blood thinner: never double a missed dose; watch for unusual bruising, gum bleeding, or dark stools.",
        "hi": "खून पतला करने की महत्वपूर्ण दवा: भूली हुई खुराक दोगुनी न करें; असामान्य नील या खून आने पर तुरंत डॉक्टर को बताएं।",
        "mr": "रक्त पातळ करणारे महत्त्वाचे औषध: चुकलेला डोस दुप्पट घेऊ नका; असामान्य रक्तस्त्राव झाल्यास डॉक्टरांना कळवा.",
    },
    "insulin": {
        "code": "HIGH_ALERT_INSULIN",
        "severity": "critical",
        "title": "High-Alert Insulin",
        "en": "High-alert insulin: double-check exact units before every injection and do not skip meals to avoid low blood sugar.",
        "hi": "इंसुलिन सावधानी: हर बार सही यूनिट जांचें और कम शुगर से बचने के लिए भोजन न छोड़ें।",
        "mr": "इन्सुलिन काळजी: प्रत्येक वेळी अचूक युनिट्स तपासा आणि कमी साखरेचा धोका टाळण्यासाठी जेवण चुकवू नका.",
    },
    "sulfonylurea": {
        "code": "HIGH_ALERT_HYPOGLYCEMIA",
        "severity": "warning",
        "title": "Low Blood Sugar Risk",
        "en": "Can lower blood sugar significantly in elders; always take with meals and keep glucose/sugar handy if dizziness or sweating occurs.",
        "hi": "बुजुर्गों में शुगर कम होने का खतरा: इसे भोजन के साथ लें और चक्कर या पसीना आने पर तुरंत मीठा/ग्लूकोज़ दें।",
        "mr": "ज्येष्ठांमध्ये साखर कमी होण्याचा धोका: हे औषध जेवणासोबत घ्या व चक्कर किंवा घाम आल्यास तात्काळ साखर/ग्लुकोज द्या.",
    },
    "digoxin": {
        "code": "HIGH_ALERT_DIGOXIN",
        "severity": "critical",
        "title": "Narrow-Margin Heart Medicine",
        "en": "Digoxin requires strict once-daily dosing; check pulse regularly and report nausea, confusion, or slow pulse (<60 bpm).",
        "hi": "दिल की संवेदनशील दवा (डिगॉक्सिन): तय खुराक ही दें; नब्ज़ 60 से कम हो या मितली हो तो डॉक्टर से संपर्क करें।",
        "mr": "हृदयाचे संवेदनशील औषध (डिगॉक्सिन): ठरलेलाच डोस द्या; नाडी 60 पेक्षा कमी असल्यास डॉक्टरांना कळवा.",
    },
    "thyroid": {
        "code": "THYROID_EMPTY_STOMACH",
        "severity": "info",
        "title": "Empty Stomach Required",
        "en": "Take first thing in the morning on an empty stomach with plain water; wait 30–45 minutes before tea, coffee, or breakfast.",
        "hi": "सुबह खाली पेट सादे पानी के साथ लें; चाय, कॉफी या नाश्ते से 30–45 मिनट पहले लें।",
        "mr": "सकाळी उपाशीपोटी साध्या पाण्यासोबत घ्या; चहा, कॉफी किंवा नाश्त्याआधी 30–45 मिनिटे थांबा.",
    },
}


# =============================================================================
# Time & Share-Code Helpers
# =============================================================================


def get_ist_now() -> datetime:
    """Return current timezone-aware datetime in Indian Standard Time (IST)."""
    return datetime.now(IST_TZ)


def get_ist_today() -> date:
    """Return current calendar date in IST."""
    return get_ist_now().date()


def generate_share_code(length: int = 6) -> str:
    """Generate a high-readability 6-character uppercase share code."""
    return "".join(secrets.choice(_SHARE_CODE_ALPHABET) for _ in range(length))


# =============================================================================
# Indian Dosage Pattern & Schedule Parser
# =============================================================================


def _parse_fraction(token: str) -> float:
    cleaned = token.strip().replace("½", "0.5").replace("¼", "0.25").replace("¾", "0.75")
    if "/" in cleaned:
        parts = cleaned.split("/", 1)
        try:
            denom = float(parts[1])
            if denom > 0:
                return round(float(parts[0]) / denom, 2)
        except ValueError:
            return 0.0
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return 0.0


def _slot_time(slot: SlotName, meal_relation: MealRelation) -> str:
    if slot == "empty_stomach":
        return "07:00"
    if slot == "morning":
        if meal_relation == "empty_stomach":
            return "07:00"
        if meal_relation == "before_food":
            return "07:30"
        if meal_relation in ("after_food", "with_food"):
            return "08:30"
        return "08:00"
    if slot == "afternoon":
        if meal_relation == "before_food":
            return "13:00"
        if meal_relation in ("after_food", "with_food"):
            return "14:00"
        return "13:30"
    if slot == "evening":
        return "17:30"
    if slot == "night":
        if meal_relation == "before_food":
            return "20:00"
        if meal_relation in ("after_food", "with_food"):
            return "21:00"
        return "21:30"
    return "00:00"


def _make_slot(slot: SlotName, meal_relation: MealRelation, dose_qty: float) -> ScheduleSlot:
    meta = SLOT_METADATA[slot]
    qty = max(0.25, min(10.0, float(dose_qty)))
    return ScheduleSlot(
        slot=slot,
        time=_slot_time(slot, meal_relation),
        dose_qty=qty,
        label_en=meta["label_en"],
        label_hi=meta["label_hi"],
        label_mr=meta["label_mr"],
        color_hex=meta["color_hex"],
    )


def _matches_any(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(kw in lowered for kw in keywords)


def parse_indian_dosage_pattern(
    dosage_pattern: str,
    meal_relation: MealRelation = "after_food",
    brand_name: str = "",
    generic_name: str | None = None,
) -> tuple[list[ScheduleSlot], bool, str, MealRelation]:
    """Deterministically convert Indian prescription shorthand into IST schedule slots.

    Handles numeric notation (`1-0-1`, `1-1-1`, `0.5-0-0.5`, `1-0-1-0`, `½-0-½`),
    Latin abbreviations (`OD`, `BD`, `BID`, `TDS`, `TID`, `QID`, `HS`, `SOS`, `PRN`,
    `STAT`, `BBF`, `AC`, `PC`), and clinical timing heuristics for common Indian drugs.

    Returns:
        Tuple of (schedule_slots, as_needed, normalized_pattern, effective_meal_relation).
    """
    raw = (dosage_pattern or "OD").strip()
    upper = re.sub(r"\s+", " ", raw.upper())
    drug_text = f"{brand_name} {generic_name or ''}".lower()

    effective_meal: MealRelation = meal_relation
    if any(tok in upper for tok in ("BBF", "EMPTY STOMACH", "FASTING")):
        effective_meal = "empty_stomach"
    elif re.search(r"\bAC\b", upper) or "BEFORE FOOD" in upper or "BEFORE MEAL" in upper:
        effective_meal = "before_food"
    elif re.search(r"\bPC\b", upper) or "AFTER FOOD" in upper or "AFTER MEAL" in upper:
        effective_meal = "after_food"

    # Drug-aware empty-stomach heuristic (e.g., Thyronorm, Pan-D, Omez)
    is_empty_stomach_drug = _matches_any(drug_text, _EMPTY_STOMACH_DRUGS)
    is_night_drug = _matches_any(drug_text, _NIGHT_PREFERRED_DRUGS)

    # 1. SOS / PRN (As needed)
    if any(tok in upper for tok in ("SOS", "PRN", "AS NEEDED", "WHEN NEEDED")):
        return [_make_slot("sos", effective_meal, 1.0)], True, "SOS", effective_meal

    # 2. Numeric Indian dash/dot notation: e.g. 1-0-1, 1-1-1-1, 0.5-0-0.5, ½-0-½
    dash_match = re.search(
        r"([0-9½¼¾./]+)\s*[-–—]\s*([0-9½¼¾./]+)\s*[-–—]\s*([0-9½¼¾./]+)(?:\s*[-–—]\s*([0-9½¼¾./]+))?",
        raw,
    )
    if dash_match:
        parts = [p for p in dash_match.groups() if p is not None]
        qtys = [_parse_fraction(p) for p in parts]
        if len(qtys) == 3:
            slot_names: list[SlotName] = ["morning", "afternoon", "night"]
        else:
            slot_names = ["morning", "afternoon", "evening", "night"]

        slots: list[ScheduleSlot] = []
        for slot_name, qty in zip(slot_names, qtys):
            if qty > 0:
                resolved_slot: SlotName = (
                    "empty_stomach"
                    if slot_name == "morning"
                    and (effective_meal == "empty_stomach" or is_empty_stomach_drug)
                    else slot_name
                )
                if resolved_slot == "empty_stomach":
                    effective_meal = "empty_stomach"
                slots.append(_make_slot(resolved_slot, effective_meal, qty))

        if slots:
            normalized = "-".join(
                str(int(q)) if float(q).is_integer() else str(q) for q in qtys
            )
            return slots, False, normalized, effective_meal

    # 3. Latin abbreviations & natural phrases
    if any(tok in upper for tok in ("QID", "FOUR TIMES", "4 TIMES")):
        slots = [
            _make_slot("morning", effective_meal, 1.0),
            _make_slot("afternoon", effective_meal, 1.0),
            _make_slot("evening", effective_meal, 1.0),
            _make_slot("night", effective_meal, 1.0),
        ]
        return slots, False, "1-1-1-1", effective_meal

    if any(tok in upper for tok in ("TDS", "TID", "THRICE", "THREE TIMES", "3 TIMES")):
        slots = [
            _make_slot("morning", effective_meal, 1.0),
            _make_slot("afternoon", effective_meal, 1.0),
            _make_slot("night", effective_meal, 1.0),
        ]
        return slots, False, "1-1-1", effective_meal

    if any(tok in upper for tok in ("BD", "BID", "TWICE", "TWO TIMES", "2 TIMES")):
        first_slot: SlotName = (
            "empty_stomach"
            if effective_meal == "empty_stomach" or is_empty_stomach_drug
            else "morning"
        )
        slots = [
            _make_slot(first_slot, effective_meal, 1.0),
            _make_slot("night", effective_meal, 1.0),
        ]
        return slots, False, "1-0-1", effective_meal

    if any(tok in upper for tok in ("HS", "QHS", "BEDTIME", "AT NIGHT", "NIGHT", "BT")):
        return [_make_slot("night", effective_meal, 1.0)], False, "0-0-1", effective_meal

    if "AFTERNOON" in upper or "NOON" in upper:
        return [_make_slot("afternoon", effective_meal, 1.0)], False, "0-1-0", effective_meal

    if "EVENING" in upper:
        return [_make_slot("evening", effective_meal, 1.0)], False, "0-0-1-0", effective_meal

    # Default: OD / QD / STAT / Once daily
    if is_empty_stomach_drug or effective_meal == "empty_stomach":
        effective_meal = "empty_stomach"
        return [_make_slot("empty_stomach", effective_meal, 1.0)], False, "1-0-0", effective_meal
    if is_night_drug and "MORNING" not in upper:
        return [_make_slot("night", effective_meal, 1.0)], False, "0-0-1", effective_meal
    return [_make_slot("morning", effective_meal, 1.0)], False, "1-0-0", effective_meal


def pick_pill_color_tag(schedule_slots: list[ScheduleSlot], as_needed: bool) -> str:
    """Choose primary high-contrast color tag for Nani Mode cards."""
    if as_needed or not schedule_slots:
        return SLOT_METADATA["sos"]["color_hex"]
    return schedule_slots[0].color_hex


# =============================================================================
# Multilingual Spoken Audio Scripts (Hindi / Marathi / English)
# =============================================================================


def _format_qty(qty: float) -> str:
    if qty == 0.5:
        return "half"
    if qty == 0.25:
        return "quarter"
    return str(int(qty)) if float(qty).is_integer() else str(qty)


def _format_qty_hi(qty: float) -> str:
    if qty == 0.5:
        return "आधी"
    if qty == 0.25:
        return "चौथाई"
    return str(int(qty)) if float(qty).is_integer() else str(qty)


def _format_qty_mr(qty: float) -> str:
    if qty == 0.5:
        return "अर्धी"
    if qty == 0.25:
        return "पाव"
    return str(int(qty)) if float(qty).is_integer() else str(qty)


_FORM_LABELS: dict[str, dict[str, str]] = {
    "tablet": {"en": "tablet", "hi": "गोली", "mr": "गोळी"},
    "capsule": {"en": "capsule", "hi": "कैप्सूल", "mr": "कॅप्सूल"},
    "syrup": {"en": "spoon of syrup", "hi": "चम्मच सिरप", "mr": "चमचा औषध"},
    "drops": {"en": "drop(s)", "hi": "बूंद", "mr": "थेंब"},
    "injection": {"en": "injection dose", "hi": "इंजेक्शन", "mr": "इंजेक्शन"},
    "inhaler": {"en": "puff of inhaler", "hi": "इनहेलर पफ", "mr": "इनहेलर पफ"},
    "ointment": {"en": "application of ointment", "hi": "मलहम", "mr": "मलम"},
    "other": {"en": "dose", "hi": "खुराक", "mr": "डोस"},
}

_MEAL_PHRASES: dict[MealRelation, dict[str, str]] = {
    "empty_stomach": {
        "en": "on an empty stomach with plain water",
        "hi": "खाली पेट सादे पानी के साथ",
        "mr": "उपाशीपोटी साध्या पाण्यासोबत",
    },
    "before_food": {
        "en": "30 minutes before food",
        "hi": "खाने से 30 मिनट पहले",
        "mr": "जेवणाआधी 30 मिनिटे",
    },
    "after_food": {
        "en": "after food with water",
        "hi": "खाने के बाद पानी के साथ",
        "mr": "जेवणानंतर पाण्यासोबत",
    },
    "with_food": {
        "en": "along with food",
        "hi": "खाने के साथ",
        "mr": "जेवणासोबत",
    },
    "anytime": {
        "en": "with a glass of water",
        "hi": "एक गिलास पानी के साथ",
        "mr": "एक ग्लास पाण्यासोबत",
    },
}


def build_multilingual_instructions(
    brand_name: str,
    strength: str | None,
    dosage_form: str,
    meal_relation: MealRelation,
    schedule_slots: list[ScheduleSlot],
    as_needed: bool,
    frequency_notes: str | None = None,
    visual_desc: dict[str, str] | None = None,
) -> dict[str, str]:
    """Generate warm, respectful elder-friendly TTS audio scripts (with pill size/color/shape) in EN, HI, and MR."""
    med_label = f"{brand_name} {strength}".strip() if strength else brand_name.strip()
    form = _FORM_LABELS.get(dosage_form, _FORM_LABELS["tablet"])
    meal = _MEAL_PHRASES.get(meal_relation, _MEAL_PHRASES["after_food"])
    qty = schedule_slots[0].dose_qty if schedule_slots else 1.0

    item_en = visual_desc["en"] if visual_desc and visual_desc.get("en") else form["en"]
    item_hi = visual_desc["hi"] if visual_desc and visual_desc.get("hi") else form["hi"]
    item_mr = visual_desc["mr"] if visual_desc and visual_desc.get("mr") else form["mr"]

    # Avoid repeating "empty stomach" twice when the slot label already says it
    has_empty_slot = any(s.slot == "empty_stomach" for s in schedule_slots)
    meal_hi = "सादे पानी के साथ" if (has_empty_slot and meal_relation == "empty_stomach") else meal["hi"]
    meal_mr = "साध्या पाण्यासोबत" if (has_empty_slot and meal_relation == "empty_stomach") else meal["mr"]

    if as_needed:
        note_en = f" ({frequency_notes})" if frequency_notes else ""
        en = (
            f"Take {_format_qty(qty)} {item_en} of {med_label} "
            f"only when you need it{note_en}, {meal['en']}."
        )
        hi = (
            f"कृपया {med_label} की {_format_qty_hi(qty)} {item_hi} "
            f"केवल ज़रूरत पड़ने पर {meal['hi']} लीजिए।"
        )
        mr = (
            f"कृपया {med_label} ची {_format_qty_mr(qty)} {item_mr} "
            f"फक्त गरज असल्यास {meal['mr']} घ्या."
        )
        return {"en": en, "hi": hi, "mr": mr}

    slots_en = ", ".join(f"{s.label_en} ({s.time})" for s in schedule_slots)
    slots_hi = " और ".join(s.label_hi for s in schedule_slots)
    slots_mr = " आणि ".join(s.label_mr for s in schedule_slots)

    en = (
        f"Please take {_format_qty(qty)} {item_en} of {med_label} "
        f"in the {slots_en}, {meal['en']}."
    )
    hi = (
        f"कृपया {slots_hi} {meal_hi} {med_label} की "
        f"{_format_qty_hi(qty)} {item_hi} लीजिए।"
    )
    mr = (
        f"कृपया {slots_mr} {meal_mr} {med_label} ची "
        f"{_format_qty_mr(qty)} {item_mr} घ्या."
    )
    return {"en": en, "hi": hi, "mr": mr}


def build_slot_spoken_text(
    brand_name: str,
    strength: str | None,
    dosage_form: str,
    meal_relation: MealRelation,
    slot: ScheduleSlot,
    language: str = "hi",
    visual_desc: dict[str, str] | None = None,
) -> str:
    """Build a focused single-slot spoken audio prompt (with pill size/color/shape) for Elder Mode."""
    med_label = f"{brand_name} {strength}".strip() if strength else brand_name.strip()
    form = _FORM_LABELS.get(dosage_form, _FORM_LABELS["tablet"])
    meal = _MEAL_PHRASES.get(meal_relation, _MEAL_PHRASES["after_food"])

    item_en = visual_desc["en"] if visual_desc and visual_desc.get("en") else form["en"]
    item_hi = visual_desc["hi"] if visual_desc and visual_desc.get("hi") else form["hi"]
    item_mr = visual_desc["mr"] if visual_desc and visual_desc.get("mr") else form["mr"]

    if slot.slot == "sos":
        scripts = build_multilingual_instructions(
            brand_name, strength, dosage_form, meal_relation, [slot], True, visual_desc=visual_desc
        )
        return scripts.get(language, scripts["hi"])

    meal_hi = "सादे पानी के साथ" if (slot.slot == "empty_stomach" and meal_relation == "empty_stomach") else meal["hi"]
    meal_mr = "साध्या पाण्यासोबत" if (slot.slot == "empty_stomach" and meal_relation == "empty_stomach") else meal["mr"]

    if language == "mr":
        return (
            f"कृपया {slot.label_mr} {meal_mr} {med_label} ची "
            f"{_format_qty_mr(slot.dose_qty)} {item_mr} घ्या."
        )
    if language == "en":
        return (
            f"For {slot.label_en} at {slot.time}, please take "
            f"{_format_qty(slot.dose_qty)} {item_en} of {med_label} {meal['en']}."
        )
    return (
        f"कृपया {slot.label_hi} {meal_hi} {med_label} की "
        f"{_format_qty_hi(slot.dose_qty)} {item_hi} लीजिए।"
    )


# =============================================================================
# Deterministic Medication Safety & Interaction Engine
# =============================================================================


def _detect_drug_classes(brand_name: str, generic_name: str | None) -> set[str]:
    text = f"{brand_name} {generic_name or ''}".lower()
    detected: set[str] = set()
    for class_key, (_, keywords) in _MOLECULE_CLASS_MAP.items():
        if any(kw in text for kw in keywords):
            detected.add(class_key)
    return detected


_ALLERGY_TRIGGERS: list[tuple[tuple[str, ...], str, tuple[str, ...]]] = [
    (
        ("penicillin", "amoxicillin", "beta-lactam", "beta lactam"),
        "Penicillin / Beta-Lactam",
        ("amoxicillin", "augmentin", "amoxyclav", "clavam", "moxikind", "ampicillin", "penicillin", "piperacillin"),
    ),
    (
        ("cephalosporin", "cefixime", "cefpodoxime"),
        "Cephalosporin",
        ("cefixime", "cefpodoxime", "opox", "taxim", "zifi", "ceftriaxone", "cefuroxime", "gudcef"),
    ),
    (
        ("sulfa", "sulfonamide", "cotrimoxazole"),
        "Sulfa Drug",
        ("sulfamethoxazole", "septran", "bactrim", "cotrimoxazole", "sulfasalazine", "glimepiride", "amaryl", "gemer", "glipizide", "gliclazide", "glibenclamide"),
    ),
    (
        ("aspirin", "salicylate"),
        "Aspirin",
        ("aspirin", "ecosprin", "loprin", "disprin"),
    ),
    (
        ("nsaid", "ibuprofen", "diclofenac", "painkiller"),
        "NSAID Painkiller",
        ("ibuprofen", "brufen", "combiflam", "diclofenac", "voveran", "aceclofenac", "zerodol", "altrase", "naproxen", "etoricoxib", "nucoxia"),
    ),
    (
        ("paracetamol", "acetaminophen"),
        "Paracetamol",
        ("paracetamol", "acetaminophen", "dolo", "crocin", "calpol", "pacimol"),
    ),
    (
        ("statin", "atorvastatin", "rosuvastatin"),
        "Statin",
        ("atorvastatin", "atorva", "rosuvastatin", "rosuvas", "simvastatin", "lipitor", "crestor"),
    ),
]


def _find_allergy_conflicts(
    brand_name: str,
    generic_name: str | None,
    known_allergies: list[str] | None,
) -> list[str]:
    """Return human-readable allergy labels that conflict with this medicine."""
    if not known_allergies:
        return []
    med_text = f"{brand_name} {generic_name or ''}".lower()
    matched_labels: list[str] = []

    for raw_allergy in known_allergies:
        allergy = str(raw_allergy or "").strip()
        if not allergy:
            continue
        allergy_lower = allergy.lower()

        matched_via_rule = False
        for allergy_keys, label, drug_tokens in _ALLERGY_TRIGGERS:
            if any(k in allergy_lower for k in allergy_keys):
                if any(tok in med_text for tok in drug_tokens):
                    if label not in matched_labels:
                        matched_labels.append(label)
                    matched_via_rule = True

        if not matched_via_rule and len(allergy_lower) >= 4 and allergy_lower in med_text:
            if allergy not in matched_labels:
                matched_labels.append(allergy)

    return matched_labels


def evaluate_medicine_safety(
    medicines: list[dict[str, Any]],
    known_allergies: list[str] | None = None,
) -> tuple[dict[int, list[SafetyFlag]], list[SafetyFlag]]:
    """Run deterministic OCR confidence, allergy, geriatric high-alert, duplicate, and interaction checks.

    Args:
        medicines: Sequence of medicine dicts with keys `brand_name`, `generic_name`,
            `strength`, `dosage_pattern`, `meal_relation`, `confidence`, `low_confidence_fields`.
        known_allergies: Optional list of patient allergies from Profile.known_allergies.

    Returns:
        Tuple of:
          - per_medicine_flags: dict mapping index -> list[SafetyFlag]
          - regimen_flags: list[SafetyFlag] covering regimen-wide allergies, duplicates & interactions
    """
    per_med: dict[int, list[SafetyFlag]] = {idx: [] for idx in range(len(medicines))}
    regimen_flags: list[SafetyFlag] = []
    class_members: dict[str, list[tuple[int, str]]] = {}

    for idx, med in enumerate(medicines):
        brand = str(med.get("brand_name") or "Unknown Medicine").strip()
        generic = med.get("generic_name")
        strength = med.get("strength")
        confidence = float(med.get("confidence", 1.0))
        low_fields = list(med.get("low_confidence_fields") or [])
        meal_relation = str(med.get("meal_relation") or "after_food")

        # 1. Low-confidence OCR review flag (triggers yellow highlight in Caregiver UI)
        if confidence < LOW_CONFIDENCE_THRESHOLD or low_fields:
            fields_text = ", ".join(low_fields) if low_fields else "handwriting / dosage"
            per_med[idx].append(
                SafetyFlag(
                    code="LOW_CONFIDENCE_OCR",
                    severity="warning",
                    title="Verify Handwritten Field",
                    message_en=(
                        f"AI confidence is {int(round(confidence * 100))}% for {brand}. "
                        f"Please verify {fields_text} against the prescription strip."
                    ),
                    message_hi=(
                        f"{brand} की स्कैन सटीकता {int(round(confidence * 100))}% है। "
                        f"कृपया पर्ची से {fields_text} की जांच करें।"
                    ),
                    message_mr=(
                        f"{brand} साठी स्कॅन अचूकता {int(round(confidence * 100))}% आहे. "
                        f"कृपया प्रिस्क्रिप्शनवरून {fields_text} तपासा."
                    ),
                    affected_medicines=[brand],
                )
            )

        # 2. Missing strength check
        if not strength or not str(strength).strip():
            per_med[idx].append(
                SafetyFlag(
                    code="MISSING_STRENGTH",
                    severity="warning",
                    title="Missing Medicine Strength",
                    message_en=f"Strength (mg/mcg/ml) was not detected for {brand}. Confirm exact strength before saving.",
                    message_hi=f"{brand} की मात्रा (mg/ml) स्पष्ट नहीं है। सेव करने से पहले सही मात्रा दर्ज करें।",
                    message_mr=f"{brand} ची ताकद (mg/ml) स्पष्ट नाही. सेव्ह करण्यापूर्वी अचूक मात्रा तपासा.",
                    affected_medicines=[brand],
                )
            )

        # 3. High-alert geriatric drug checks
        classes = _detect_drug_classes(brand, generic)
        for cls_key in classes:
            class_members.setdefault(cls_key, []).append((idx, brand))
            if cls_key in _HIGH_ALERT_RULES:
                rule = _HIGH_ALERT_RULES[cls_key]
                per_med[idx].append(
                    SafetyFlag(
                        code=rule["code"],
                        severity=rule["severity"],  # type: ignore[arg-type]
                        title=rule["title"],
                        message_en=rule["en"],
                        message_hi=rule["hi"],
                        message_mr=rule["mr"],
                        affected_medicines=[brand],
                    )
                )

        # 4. Sulfonylurea on empty stomach warning
        if "sulfonylurea" in classes and meal_relation == "empty_stomach":
            per_med[idx].append(
                SafetyFlag(
                    code="SULFONYLUREA_EMPTY_STOMACH",
                    severity="critical",
                    title="Take With Meals",
                    message_en=f"{brand} should not be taken without food due to severe low blood sugar risk.",
                    message_hi=f"{brand} को खाली पेट न लें, इससे शुगर बहुत कम हो सकती है।",
                    message_mr=f"{brand} उपाशीपोटी घेऊ नका, यामुळे साखर धोकादायकरीत्या कमी होऊ शकते.",
                    affected_medicines=[brand],
                )
            )

        # 4b. Known patient allergy conflict check (zero-token critical check)
        allergy_hits = _find_allergy_conflicts(brand, generic, known_allergies)
        for allergy_label in allergy_hits:
            allergy_flag = SafetyFlag(
                code="ALLERGY_CONFLICT",
                severity="critical",
                title=f"Allergy Alert ({allergy_label})",
                message_en=(
                    f"{brand} may conflict with recorded {allergy_label} allergy. "
                    "Do NOT give without doctor confirmation."
                ),
                message_hi=(
                    f"{brand} दर्ज एलर्जी ({allergy_label}) के कारण नुकसान कर सकती है। "
                    "डॉक्टर से पूछे बिना न दें।"
                ),
                message_mr=(
                    f"{brand} नोंदवलेल्या अ‍ॅलर्जीमुळे ({allergy_label}) धोकादायक ठरू शकते. "
                    "डॉक्टरांच्या सल्ल्याशिवाय देऊ नका."
                ),
                affected_medicines=[brand],
            )
            per_med[idx].append(allergy_flag)
            regimen_flags.append(allergy_flag)

    # 5. Duplicate active ingredient / therapeutic class checks
    for cls_key in ("paracetamol", "ppi", "nsaid", "statin", "sulfonylurea", "arb_acei"):
        members = class_members.get(cls_key, [])
        if len(members) >= 2:
            cls_label = _MOLECULE_CLASS_MAP[cls_key][0]
            names = [name for _, name in members]
            severity = "critical" if cls_key in ("paracetamol", "nsaid", "sulfonylurea") else "warning"
            flag = SafetyFlag(
                code=f"DUPLICATE_{cls_key.upper()}",
                severity=severity,  # type: ignore[arg-type]
                title=f"Duplicate {cls_label}",
                message_en=(
                    f"Possible duplicate {cls_label}: {', '.join(names)}. "
                    "Confirm with the doctor to avoid accidental double dosing."
                ),
                message_hi=(
                    f"एक ही प्रकार की दो दवाएं मिलीं ({', '.join(names)})। "
                    "दोहरी खुराक से बचने के लिए डॉक्टर से पुष्टि करें।"
                ),
                message_mr=(
                    f"एकाच प्रकारची दोन औषधे आढळली ({', '.join(names)}). "
                    "दुप्पट डोस टाळण्यासाठी डॉक्टरांशी खात्री करा."
                ),
                affected_medicines=names,
            )
            regimen_flags.append(flag)
            for idx, _ in members:
                per_med[idx].append(flag)

    # 6. Pairwise geriatric drug-drug & timing interactions
    if ("antiplatelet" in class_members or "anticoagulant" in class_members) and "nsaid" in class_members:
        bleed_members = (
            class_members.get("antiplatelet", [])
            + class_members.get("anticoagulant", [])
            + class_members.get("nsaid", [])
        )
        names = list(dict.fromkeys(name for _, name in bleed_members))
        flag = SafetyFlag(
            code="INTERACTION_BLEEDING_RISK",
            severity="critical",
            title="Stomach Bleeding Risk (Blood Thinner + Painkiller)",
            message_en=(
                f"Combining {', '.join(names)} increases stomach bleeding risk in older adults. "
                "Verify with the prescribing doctor."
            ),
            message_hi=(
                f"{', '.join(names)} को एक साथ लेने से पेट में रक्तस्राव का खतरा बढ़ता है। "
                "डॉक्टर से तुरंत पुष्टि करें।"
            ),
            message_mr=(
                f"{', '.join(names)} एकत्र घेतल्याने पोटातील रक्तस्त्रावाचा धोका वाढतो. "
                "डॉक्टरांशी त्वरित खात्री करा."
            ),
            affected_medicines=names,
        )
        regimen_flags.append(flag)
        for idx, _ in bleed_members:
            per_med[idx].append(flag)

    if "thyroid" in class_members and ("calcium_iron" in class_members or "ppi" in class_members):
        thyroid_members = (
            class_members.get("thyroid", [])
            + class_members.get("calcium_iron", [])
            + class_members.get("ppi", [])
        )
        names = list(dict.fromkeys(name for _, name in thyroid_members))
        flag = SafetyFlag(
            code="INTERACTION_THYROID_ABSORPTION",
            severity="warning",
            title="Keep 4-Hour Gap From Thyroid Tablet",
            message_en=(
                f"Calcium/Iron or acidity tablets can block absorption of thyroid medicine ({', '.join(names)}). "
                "Keep at least a 4-hour gap (take thyroid at 7:00 AM, calcium after lunch/dinner)."
            ),
            message_hi=(
                f"थायरॉइड की दवा और कैल्शियम/आयरन/एसिडिटी की गोली ({', '.join(names)}) के बीच "
                "कम से कम 4 घंटे का अंतर रखें।"
            ),
            message_mr=(
                f"थायरॉईडचे औषध आणि कॅल्शियम/लोह/अ‍ॅसिडिटीची गोळी ({', '.join(names)}) यामध्ये "
                "किमान 4 तासांचे अंतर ठेवा."
            ),
            affected_medicines=names,
        )
        regimen_flags.append(flag)
        for idx, _ in thyroid_members:
            per_med[idx].append(flag)

    if "arb_acei" in class_members and "nsaid" in class_members:
        renal_members = class_members["arb_acei"] + class_members["nsaid"]
        names = list(dict.fromkeys(name for _, name in renal_members))
        flag = SafetyFlag(
            code="INTERACTION_BP_NSAID",
            severity="warning",
            title="BP Medicine + Painkiller Caution",
            message_en=(
                f"NSAID painkillers can reduce BP control and strain kidneys when combined with {', '.join(names)}."
            ),
            message_hi=(
                f"दर्द निवारक दवाएं बीपी की दवा ({', '.join(names)}) का असर कम कर सकती हैं और किडनी पर दबाव डालती हैं।"
            ),
            message_mr=(
                f"वेदनाशामक औषधांमुळे बीपीच्या औषधाचा ({', '.join(names)}) परिणाम कमी होऊ शकतो व मूत्रपिंडावर ताण येतो."
            ),
            affected_medicines=names,
        )
        regimen_flags.append(flag)
        for idx, _ in renal_members:
            per_med[idx].append(flag)

    return per_med, regimen_flags


# =============================================================================
# Deterministic Vitals Clinical Rule Engine
# =============================================================================


_STATUS_RANK: dict[VitalStatus, int] = {"normal": 0, "caution": 1, "critical": 2}


def _worst_status(current: VitalStatus, candidate: VitalStatus) -> VitalStatus:
    return candidate if _STATUS_RANK[candidate] > _STATUS_RANK[current] else current


def evaluate_vitals(
    temperature_f: float | None = None,
    systolic_mmhg: int | None = None,
    diastolic_mmhg: int | None = None,
    weight_kg: float | None = None,
    pulse_bpm: int | None = None,
    spo2_percent: int | None = None,
    blood_sugar_mgdl: float | None = None,
    previous_weight_kg: float | None = None,
    days_since_previous_weight: float | None = None,
) -> tuple[VitalStatus, list[VitalFlag], str, str, str]:
    """Deterministically evaluate elder vitals into status + multilingual alerts."""
    flags: list[VitalFlag] = []
    overall: VitalStatus = "normal"

    # 1. Body Temperature (°F)
    if temperature_f is not None:
        val = f"{temperature_f:.1f}°F"
        if temperature_f >= 103.0:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="critical",
                    code="HIGH_FEVER",
                    value_display=val,
                    message_en=f"High fever ({val}). Contact a doctor urgently and ensure hydration.",
                    message_hi=f"तेज़ बुखार ({val})। तुरंत डॉक्टर से संपर्क करें और पानी पिलाते रहें।",
                    message_mr=f"तीव्र ताप ({val}). त्वरित डॉक्टरांशी संपर्क साधा आणि पाणी द्या.",
                )
            )
        elif temperature_f >= 100.4:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="caution",
                    code="FEVER",
                    value_display=val,
                    message_en=f"Fever detected ({val}). Monitor every 4 hours and consult doctor if persistent.",
                    message_hi=f"बुखार है ({val})। हर 4 घंटे में तापमान जांचें और डॉक्टर को सूचित करें।",
                    message_mr=f"ताप आला आहे ({val}). दर 4 तासांनी तापमान तपासा आणि डॉक्टरांचा सल्ला घ्या.",
                )
            )
        elif temperature_f >= 99.6:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="caution",
                    code="LOW_GRADE_FEVER",
                    value_display=val,
                    message_en=f"Mildly elevated temperature ({val}). Recheck in 2 hours.",
                    message_hi=f"हल्का बुखार ({val})। 2 घंटे बाद फिर जांचें।",
                    message_mr=f"सौम्य ताप ({val}). 2 तासांनी पुन्हा तपासा.",
                )
            )
        elif temperature_f < 95.0:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="critical",
                    code="HYPOTHERMIA",
                    value_display=val,
                    message_en=f"Dangerously low body temperature ({val}). Keep warm and seek urgent care.",
                    message_hi=f"शरीर का तापमान बहुत कम ({val})। तुरंत गर्म रखें और डॉक्टर से संपर्क करें।",
                    message_mr=f"शरीराचे तापमान खूप कमी ({val}). ऊबदार ठेवा आणि त्वरित वैद्यकीय मदत घ्या.",
                )
            )
        elif temperature_f < 97.0:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="caution",
                    code="LOW_TEMP",
                    value_display=val,
                    message_en=f"Slightly low body temperature ({val}). Keep warm and recheck.",
                    message_hi=f"तापमान थोड़ा कम है ({val})। गर्म कपड़ा ओढ़ाएं और दोबारा जांचें।",
                    message_mr=f"तापमान थोडे कमी आहे ({val}). ऊबदार ठेवा आणि पुन्हा तपासा.",
                )
            )
        else:
            flags.append(
                VitalFlag(
                    metric="temperature_f",
                    status="normal",
                    code="TEMP_NORMAL",
                    value_display=val,
                    message_en=f"Normal body temperature ({val}).",
                    message_hi=f"शरीर का तापमान सामान्य है ({val})।",
                    message_mr=f"शरीराचे तापमान सामान्य आहे ({val}).",
                )
            )

    # 2. Blood Pressure (mmHg)
    if systolic_mmhg is not None and diastolic_mmhg is not None:
        val = f"{systolic_mmhg}/{diastolic_mmhg} mmHg"
        if systolic_mmhg >= 180 or diastolic_mmhg >= 120:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="critical",
                    code="HYPERTENSIVE_CRISIS",
                    value_display=val,
                    message_en=f"Critically high blood pressure ({val}). Seek immediate medical attention.",
                    message_hi=f"बीपी अत्यधिक बढ़ा हुआ है ({val})। तुरंत डॉक्टर या अस्पताल ले जाएं।",
                    message_mr=f"रक्तदाब धोकादायकरीत्या जास्त आहे ({val}). तात्काळ वैद्यकीय मदत घ्या.",
                )
            )
        elif systolic_mmhg < 80 or diastolic_mmhg < 50:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="critical",
                    code="SEVERE_HYPOTENSION",
                    value_display=val,
                    message_en=f"Critically low blood pressure ({val}). High fainting/fall risk; seek urgent medical care.",
                    message_hi=f"बीपी बहुत कम है ({val})। चक्कर/गिरने का खतरा—तुरंत डॉक्टर को दिखाएं।",
                    message_mr=f"रक्तदाब खूप कमी आहे ({val}). चक्कर येण्याचा धोका—तात्काळ डॉक्टरांना दाखवा.",
                )
            )
        elif systolic_mmhg < 90 or diastolic_mmhg < 60:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="caution",
                    code="LOW_BP",
                    value_display=val,
                    message_en=f"Low blood pressure ({val}). Sit or lie down slowly and have water or ORS.",
                    message_hi=f"बीपी कम है ({val})। आराम से बैठ जाएं या लेट जाएं और पानी या ओआरएस पिएं।",
                    message_mr=f"रक्तदाब कमी आहे ({val}). आरामशीर बसा किंवा झोपा आणि पाणी किंवा ओआरएस प्या.",
                )
            )
        elif systolic_mmhg >= 140 or diastolic_mmhg >= 90:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="caution",
                    code="HIGH_BP_STAGE2",
                    value_display=val,
                    message_en=f"High blood pressure ({val}). Ensure BP medicine was taken and inform doctor.",
                    message_hi=f"बीपी बढ़ा हुआ है ({val})। जांचें कि बीपी की गोली ली गई है और डॉक्टर को बताएं।",
                    message_mr=f"रक्तदाब जास्त आहे ({val}). बीपीची गोळी घेतली का ते तपासा व डॉक्टरांना कळवा.",
                )
            )
        elif systolic_mmhg >= 130 or diastolic_mmhg >= 80:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="caution",
                    code="ELEVATED_BP",
                    value_display=val,
                    message_en=f"Mildly elevated BP ({val}). Rest 15 minutes and recheck.",
                    message_hi=f"बीपी हल्का बढ़ा है ({val})। 15 मिनट आराम के बाद फिर जांचें।",
                    message_mr=f"रक्तदाब किंचित जास्त आहे ({val}). 15 मिनिटे विश्रांतीनंतर पुन्हा तपासा.",
                )
            )
        else:
            flags.append(
                VitalFlag(
                    metric="blood_pressure",
                    status="normal",
                    code="BP_NORMAL",
                    value_display=val,
                    message_en=f"Blood pressure is in healthy range ({val}).",
                    message_hi=f"ब्लड प्रेशर सामान्य है ({val})।",
                    message_mr=f"रक्तदाब सामान्य आहे ({val}).",
                )
            )

    # 3. Weight (kg) + Rapid Fluid Retention / Weight Loss Trend
    if weight_kg is not None:
        val = f"{weight_kg:.1f} kg"
        weight_flagged = False
        if previous_weight_kg is not None and days_since_previous_weight is not None:
            delta = round(weight_kg - previous_weight_kg, 2)
            if delta >= 2.0 and days_since_previous_weight <= 7.0:
                weight_flagged = True
                flags.append(
                    VitalFlag(
                        metric="weight_kg",
                        status="caution",
                        code="RAPID_WEIGHT_GAIN",
                        value_display=f"{val} (+{delta:.1f} kg)",
                        message_en=(
                            f"Rapid weight gain of +{delta:.1f} kg in {max(1, int(days_since_previous_weight))} day(s) "
                            f"({val}). Check for ankle swelling / fluid retention and inform doctor."
                        ),
                        message_hi=(
                            f"वज़न तेज़ी से +{delta:.1f} किग्रा बढ़ा है ({val})। "
                            "पैरों में सूजन जांचें और डॉक्टर को बताएं।"
                        ),
                        message_mr=(
                            f"वजन झपाट्याने +{delta:.1f} किलो वाढले आहे ({val}). "
                            "पायांवर सूज आहे का तपासा आणि डॉक्टरांना कळवा."
                        ),
                    )
                )
            elif delta <= -2.5 and days_since_previous_weight <= 14.0:
                weight_flagged = True
                flags.append(
                    VitalFlag(
                        metric="weight_kg",
                        status="caution",
                        code="RAPID_WEIGHT_LOSS",
                        value_display=f"{val} ({delta:.1f} kg)",
                        message_en=(
                            f"Noticeable weight drop of {delta:.1f} kg ({val}). "
                            "Check appetite/hydration and mention to doctor."
                        ),
                        message_hi=f"वज़न {abs(delta):.1f} किग्रा कम हुआ है ({val})। खान-पान पर ध्यान दें और डॉक्टर को बताएं।",
                        message_mr=f"वजन {abs(delta):.1f} किलो कमी झाले आहे ({val}). आहाराकडे लक्ष द्या व डॉक्टरांना सांगा.",
                    )
                )

        if not weight_flagged:
            if weight_kg < 35.0:
                flags.append(
                    VitalFlag(
                        metric="weight_kg",
                        status="caution",
                        code="LOW_WEIGHT",
                        value_display=val,
                        message_en=f"Very low recorded weight ({val}). Verify scale reading and nutritional intake.",
                        message_hi=f"वज़न काफी कम दर्ज हुआ है ({val})। दोबारा जांचें और पोषण का ध्यान रखें।",
                        message_mr=f"वजन खूप कमी नोंदवले आहे ({val}). पुन्हा तपासा आणि आहाराची काळजी घ्या.",
                    )
                )
            else:
                flags.append(
                    VitalFlag(
                        metric="weight_kg",
                        status="normal",
                        code="WEIGHT_RECORDED",
                        value_display=val,
                        message_en=f"Weight logged ({val}).",
                        message_hi=f"वज़न दर्ज किया गया ({val})।",
                        message_mr=f"वजन नोंदवले आहे ({val}).",
                    )
                )

    # 4. Optional Pulse (bpm)
    if pulse_bpm is not None:
        val = f"{pulse_bpm} bpm"
        if pulse_bpm < 45 or pulse_bpm > 130:
            flags.append(
                VitalFlag(
                    metric="pulse_bpm",
                    status="critical",
                    code="ABNORMAL_PULSE_CRITICAL",
                    value_display=val,
                    message_en=f"Critical pulse rate ({val}). Seek prompt medical review.",
                    message_hi=f"नब्ज़ असामान्य है ({val})। तुरंत डॉक्टर से संपर्क करें।",
                    message_mr=f"नाडीचे ठोके असामान्य आहेत ({val}). तात्काळ डॉक्टरांना भेटा.",
                )
            )
        elif pulse_bpm < 55 or pulse_bpm > 105:
            flags.append(
                VitalFlag(
                    metric="pulse_bpm",
                    status="caution",
                    code="ABNORMAL_PULSE",
                    value_display=val,
                    message_en=f"Pulse outside typical resting range ({val}). Rest and recheck.",
                    message_hi=f"नब्ज़ सामान्य से अलग है ({val})। आराम करके दोबारा जांचें।",
                    message_mr=f"नाडीचे ठोके सामान्यपेक्षा वेगळे आहेत ({val}). विश्रांतीनंतर पुन्हा तपासा.",
                )
            )
        else:
            flags.append(
                VitalFlag(
                    metric="pulse_bpm",
                    status="normal",
                    code="PULSE_NORMAL",
                    value_display=val,
                    message_en=f"Normal pulse ({val}).",
                    message_hi=f"नब्ज़ सामान्य है ({val})।",
                    message_mr=f"नाडीचे ठोके सामान्य आहेत ({val}).",
                )
            )

    # 5. Optional SpO2 (%)
    if spo2_percent is not None:
        val = f"{spo2_percent}%"
        if spo2_percent < 90:
            flags.append(
                VitalFlag(
                    metric="spo2_percent",
                    status="critical",
                    code="LOW_SPO2_CRITICAL",
                    value_display=val,
                    message_en=f"Critically low oxygen level ({val}). Seek emergency medical care immediately.",
                    message_hi=f"ऑक्सीजन स्तर बहुत कम है ({val})। तुरंत आपातकालीन चिकित्सा सहायता लें।",
                    message_mr=f"ऑक्सिजन पातळी खूप कमी आहे ({val}). तात्काळ आपत्कालीन वैद्यकीय मदत घ्या.",
                )
            )
        elif spo2_percent < 94:
            flags.append(
                VitalFlag(
                    metric="spo2_percent",
                    status="caution",
                    code="LOW_SPO2",
                    value_display=val,
                    message_en=f"Below-normal oxygen ({val}). Warm fingers, recheck, and call doctor.",
                    message_hi=f"ऑक्सीजन थोड़ा कम है ({val})। दोबारा जांचें और डॉक्टर से बात करें।",
                    message_mr=f"ऑक्सिजन थोडा कमी आहे ({val}). पुन्हा तपासा आणि डॉक्टरांशी बोला.",
                )
            )
        else:
            flags.append(
                VitalFlag(
                    metric="spo2_percent",
                    status="normal",
                    code="SPO2_NORMAL",
                    value_display=val,
                    message_en=f"Normal oxygen saturation ({val}).",
                    message_hi=f"ऑक्सीजन स्तर सामान्य है ({val})।",
                    message_mr=f"ऑक्सिजन पातळी सामान्य आहे ({val}).",
                )
            )

    # 6. Optional Blood Sugar (mg/dL)
    if blood_sugar_mgdl is not None:
        val = f"{blood_sugar_mgdl:.0f} mg/dL"
        if blood_sugar_mgdl < 70:
            flags.append(
                VitalFlag(
                    metric="blood_sugar_mgdl",
                    status="critical",
                    code="HYPOGLYCEMIA",
                    value_display=val,
                    message_en=f"Low blood sugar ({val})! Give 15g fast glucose/juice immediately and recheck in 15 min.",
                    message_hi=f"शुगर बहुत कम है ({val})! तुरंत ग्लूकोज़ या मीठा जूस दें और 15 मिनट में दोबारा जांचें।",
                    message_mr=f"रक्तातील साखर खूप कमी आहे ({val})! तात्काळ ग्लुकोज किंवा गोड रस द्या.",
                )
            )
        elif blood_sugar_mgdl >= 300:
            flags.append(
                VitalFlag(
                    metric="blood_sugar_mgdl",
                    status="critical",
                    code="SEVERE_HYPERGLYCEMIA",
                    value_display=val,
                    message_en=f"Very high blood sugar ({val}). Hydrate and contact doctor urgently.",
                    message_hi=f"शुगर बहुत अधिक है ({val})। पानी पिलाएं और तुरंत डॉक्टर से संपर्क करें।",
                    message_mr=f"रक्तातील साखर खूप जास्त आहे ({val}). पाणी द्या आणि तात्काळ डॉक्टरांना संपर्क करा.",
                )
            )
        elif blood_sugar_mgdl >= 200:
            flags.append(
                VitalFlag(
                    metric="blood_sugar_mgdl",
                    status="caution",
                    code="HIGH_BLOOD_SUGAR",
                    value_display=val,
                    message_en=f"Elevated blood sugar ({val}). Monitor meals and diabetes medicines.",
                    message_hi=f"शुगर बढ़ी हुई है ({val})। भोजन और दवा की जांच करें।",
                    message_mr=f"रक्तातील साखर वाढली आहे ({val}). आहार आणि औषधांची तपासणी करा.",
                )
            )
        else:
            flags.append(
                VitalFlag(
                    metric="blood_sugar_mgdl",
                    status="normal",
                    code="SUGAR_NORMAL",
                    value_display=val,
                    message_en=f"Blood sugar within acceptable range ({val}).",
                    message_hi=f"ब्लड शुगर सामान्य सीमा में है ({val})।",
                    message_mr=f"रक्तातील साखर सामान्य मर्यादेत आहे ({val}).",
                )
            )

    for flag in flags:
        overall = _worst_status(overall, flag.status)

    abnormal = [f for f in flags if f.status != "normal"]
    if abnormal:
        summary_en = " ".join(f.message_en for f in abnormal)
        summary_hi = " ".join(f.message_hi for f in abnormal)
        summary_mr = " ".join(f.message_mr for f in abnormal)
    else:
        summary_en = "All recorded vitals are within normal range."
        summary_hi = "सभी दर्ज वाइटल्स सामान्य सीमा में हैं।"
        summary_mr = "नोंदवलेले सर्व व्हायटल्स सामान्य मर्यादेत आहेत."

    return overall, flags, summary_en, summary_hi, summary_mr


# =============================================================================
# Dose Status Calculation
# =============================================================================


def compute_dose_status(
    scheduled_time: str,
    dose_date: date,
    existing_status: str | None = None,
    as_needed: bool = False,
    now_ist: datetime | None = None,
) -> DoseStatus:
    """Compute real-time status for a scheduled dose slot in IST."""
    if existing_status in ("taken", "skipped", "snoozed"):
        return existing_status  # type: ignore[return-value]
    if as_needed:
        return "upcoming"

    now = now_ist or get_ist_now()
    today = now.date()

    if dose_date > today:
        return "upcoming"
    if dose_date < today:
        return "missed"

    try:
        hour_str, min_str = scheduled_time.split(":", 1)
        scheduled_dt = datetime.combine(
            dose_date, time(int(hour_str), int(min_str)), tzinfo=IST_TZ
        )
    except (ValueError, TypeError):
        return "upcoming"

    delta_minutes = (now - scheduled_dt).total_seconds() / 60.0
    if delta_minutes > 120:
        return "missed"
    if -45 <= delta_minutes <= 120:
        return "due_now"
    return "upcoming"


# =============================================================================
# WhatsApp Daily Family Digest Builder
# =============================================================================


def _clean_phone_for_wa(phone: str | None) -> str:
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return "91" + digits  # Default Indian country code for 10-digit mobile numbers
    return digits


def compute_refill_status(
    brand_name: str,
    created_at: datetime,
    duration_days: int | None,
    today_ist: date | None = None,
) -> tuple[int, int | None, str, str, str, str]:
    """Compute elapsed days, remaining days, status, and EN/HI/MR refill messages."""
    ref_today = today_ist or get_ist_today()
    ts = created_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    start_date_ist = ts.astimezone(IST_TZ).date()
    days_elapsed = max(0, (ref_today - start_date_ist).days)

    if duration_days is None:
        return (
            days_elapsed,
            None,
            "ongoing",
            f"{brand_name}: Ongoing daily medicine.",
            f"{brand_name}: नियमित चलने वाली दवा।",
            f"{brand_name}: नियमित चालणारे औषध.",
        )

    days_remaining = max(0, duration_days - days_elapsed)
    if days_remaining == 0:
        return (
            days_elapsed,
            0,
            "completed",
            f"{brand_name}: {duration_days}-day course completed. Check with doctor if refill is needed.",
            f"{brand_name}: {duration_days} दिन का कोर्स पूरा हुआ। रिफिल के लिए डॉक्टर से पूछें।",
            f"{brand_name}: {duration_days} दिवसांचा कोर्स पूर्ण झाला आहे. रिफिलसाठी डॉक्टरांचा सल्ला घ्या.",
        )
    if days_remaining <= 3:
        return (
            days_elapsed,
            days_remaining,
            "refill_soon",
            f"{brand_name}: Only {days_remaining} day(s) left — arrange refill soon.",
            f"{brand_name}: केवल {days_remaining} दिन की दवा बची है — जल्द रिफिल मंगाएँ।",
            f"{brand_name}: फक्त {days_remaining} दिवसांचे औषध शिल्लक आहे — लवकर रिफिल आणा.",
        )
    return (
        days_elapsed,
        days_remaining,
        "ok",
        f"{brand_name}: {days_remaining} days remaining out of {duration_days}.",
        f"{brand_name}: {duration_days} में से {days_remaining} दिन बाकी हैं।",
        f"{brand_name}: {duration_days} पैकी {days_remaining} दिवस शिल्लक आहेत.",
    )


def build_whatsapp_summary(
    elder_name: str,
    share_code: str,
    report_date: date,
    adherence_percent: float,
    doses_taken: int,
    doses_total: int,
    taken_medicines: list[str],
    pending_medicines: list[str],
    missed_medicines: list[str],
    latest_vital_lines: list[str],
    abnormal_vital_flags: list[VitalFlag],
    active_safety_flags: list[SafetyFlag],
    caregiver_phone: str | None = None,
    refill_alerts: list[str] | None = None,
) -> tuple[str, str]:
    """Generate a clean family WhatsApp daily report and ready-to-click wa.me deep link."""
    date_label = report_date.strftime("%d %b %Y")
    lines: list[str] = [
        f"NaniCare Daily Health Report - {elder_name}",
        f"Date: {date_label} | Code: {share_code}",
        "",
        f"Medicine Adherence: {doses_taken}/{doses_total} doses taken ({adherence_percent:.0f}%)",
    ]

    if taken_medicines:
        lines.append(f"Taken: {', '.join(taken_medicines)}")
    if pending_medicines:
        lines.append(f"Upcoming/Due: {', '.join(pending_medicines)}")
    if missed_medicines:
        lines.append(f"Missed: {', '.join(missed_medicines)}")

    lines.append("")
    if latest_vital_lines:
        lines.append("Latest Vitals: " + " | ".join(latest_vital_lines))
    else:
        lines.append("Latest Vitals: Not logged yet today.")

    if abnormal_vital_flags:
        lines.append("")
        lines.append("Vitals Alerts:")
        for flag in abnormal_vital_flags:
            tag = "URGENT" if flag.status == "critical" else "ATTENTION"
            lines.append(f"- [{tag}] {flag.message_en}")

    important_safety = [f for f in active_safety_flags if f.severity in ("warning", "critical")]
    if important_safety:
        lines.append("")
        lines.append("Medicine Safety Notes:")
        for flag in important_safety[:3]:
            lines.append(f"- {flag.title}: {flag.message_en}")

    if refill_alerts:
        lines.append("")
        lines.append("Refill Reminders:")
        for note in refill_alerts[:4]:
            lines.append(f"- {note}")

    lines.append("")
    lines.append("Sent via NaniCare Family Companion")

    message = "\n".join(lines)
    encoded = quote(message, safe="")
    clean_phone = _clean_phone_for_wa(caregiver_phone)
    if clean_phone:
        url = f"https://wa.me/{clean_phone}?text={encoded}"
    else:
        url = f"https://wa.me/?text={encoded}"

    return message, url
