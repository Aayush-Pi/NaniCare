"""Token-efficient parametric SVG vector renderer & Indian medicine catalog helpers.

Renders crisp, high-contrast, elder-friendly vector thumbnails (< 1.5 KB each)
from a tiny 6-field VisualSpec so Nani Mode cards display recognizable tablets,
two-tone capsules, syrup bottles, droppers, inhalers, tubes, or vials with
zero external media storage and zero image-generation token overhead.
"""

from __future__ import annotations

import base64
import json
import re
from html import escape
from pathlib import Path
from typing import Any

_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "indian_medicines_catalog.json"
_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

_VALID_SHAPES = {
    "round",
    "oval",
    "oblong",
    "capsule_bicolor",
    "bottle",
    "dropper",
    "inhaler",
    "tube",
    "vial",
}

_FORM_DEFAULT_SHAPE: dict[str, str] = {
    "tablet": "round",
    "capsule": "capsule_bicolor",
    "syrup": "bottle",
    "drops": "dropper",
    "inhaler": "inhaler",
    "ointment": "tube",
    "injection": "vial",
    "other": "round",
}


def normalize_medicine_key(text: str) -> str:
    """Normalize a medicine name to a compact alphanumeric lookup key."""
    cleaned = text.strip().lower()
    cleaned = re.sub(r"^(tab\.?|cap\.?|syp\.?|inj\.?|drops?|gel|oint\.?|t\.)\s+", "", cleaned)
    return re.sub(r"[^a-z0-9]+", "", cleaned)


def base_brand_root(text: str) -> str:
    """Strip trailing numeric strength tokens (e.g. 'Glycomet-500' -> 'glycomet')."""
    cleaned = text.strip().lower()
    cleaned = re.sub(r"^(tab\.?|cap\.?|syp\.?|inj\.?|drops?|gel|oint\.?|t\.)\s+", "", cleaned)
    cleaned = re.sub(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|gm|g|iu|k)?\b", "", cleaned)
    cleaned = re.sub(r"\b(sr|xr|er|cr|ds|duo|forte|plus|advance|new|tablet|capsule|syrup)\b", "", cleaned)
    return re.sub(r"[^a-z0-9]+", "", cleaned)


def sanitize_hex(color: str | None, fallback: str) -> str:
    if color and _HEX_RE.match(color.strip()):
        return color.strip().upper()
    return fallback


def default_visual_spec_for_form(
    dosage_form: str = "tablet",
    accent_hex: str | None = None,
) -> dict[str, Any]:
    """Deterministic zero-token fallback visual spec for any dosage form."""
    form = (dosage_form or "tablet").strip().lower()
    shape = _FORM_DEFAULT_SHAPE.get(form, "round")
    accent = sanitize_hex(accent_hex, "#2563EB")
    if shape == "capsule_bicolor":
        return {
            "shape": "capsule_bicolor",
            "primary_color": accent,
            "secondary_color": "#FFFFFF",
            "strip_accent": accent,
            "imprint": None,
        }
    if shape in ("bottle", "dropper", "tube", "vial"):
        return {
            "shape": shape,
            "primary_color": "#E0F2FE",
            "secondary_color": accent,
            "strip_accent": accent,
            "imprint": None,
        }
    if shape == "inhaler":
        return {
            "shape": "inhaler",
            "primary_color": "#38BDF8",
            "secondary_color": "#FFFFFF",
            "strip_accent": accent,
            "imprint": None,
        }
    return {
        "shape": shape,
        "primary_color": "#FFFFFF",
        "secondary_color": None,
        "strip_accent": accent,
        "imprint": None,
    }


def load_seed_catalog() -> list[dict[str, Any]]:
    """Load the bundled curated Indian medicine visual catalog JSON."""
    if not _CATALOG_PATH.exists():
        return []
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else []


def _text_color_for_fill(hex_color: str) -> str:
    """Return high-contrast dark or light ink for a pill imprint."""
    try:
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
        luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        return "#1E293B" if luminance > 0.55 else "#FFFFFF"
    except Exception:
        return "#1E293B"


def render_medicine_svg(
    brand_name: str,
    strength: str | None,
    visual_spec: dict[str, Any] | None = None,
    dosage_form: str = "tablet",
    fallback_accent: str = "#2563EB",
) -> str:
    """Render a compact, XML-safe parametric SVG thumbnail encoded as a data URI."""
    spec = visual_spec or default_visual_spec_for_form(dosage_form, fallback_accent)
    shape = str(spec.get("shape") or _FORM_DEFAULT_SHAPE.get(dosage_form, "round")).lower()
    if shape not in _VALID_SHAPES:
        shape = _FORM_DEFAULT_SHAPE.get(dosage_form, "round")

    primary = sanitize_hex(spec.get("primary_color"), "#FFFFFF")
    secondary = sanitize_hex(spec.get("secondary_color"), "#E2E8F0")
    accent = sanitize_hex(spec.get("strip_accent"), sanitize_hex(fallback_accent, "#2563EB"))
    imprint = escape(str(spec.get("imprint") or "").strip()[:5])
    ink = _text_color_for_fill(primary)

    safe_brand = escape((brand_name or "Medicine").strip()[:18])
    safe_strength = escape((strength or "").strip()[:12])

    header = (
        f'<rect width="220" height="114" rx="14" fill="#F8FAFC" stroke="{accent}" stroke-width="3.5"/>'
        f'<rect x="0" y="0" width="220" height="32" rx="11" fill="{accent}"/>'
        f'<rect x="0" y="20" width="220" height="12" fill="{accent}"/>'
        f'<text x="12" y="21" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#FFFFFF">{safe_brand}</text>'
        f'<text x="208" y="21" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#E2E8F0">{safe_strength}</text>'
    )

    body_parts: list[str] = []

    if shape == "round":
        for cx in (40, 88, 136, 184):
            body_parts.append(
                f'<circle cx="{cx}" cy="73" r="17" fill="{primary}" stroke="#64748B" stroke-width="2"/>'
                f'<line x1="{cx - 11}" y1="73" x2="{cx + 11}" y2="73" stroke="#94A3B8" stroke-width="1.2" opacity="0.65"/>'
            )
            if imprint:
                body_parts.append(
                    f'<text x="{cx}" y="69" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="{ink}">{imprint}</text>'
                )
    elif shape in ("oval", "oblong"):
        rx = 22 if shape == "oblong" else 20
        ry = 12 if shape == "oblong" else 14
        for cx in (42, 110, 178):
            body_parts.append(
                f'<rect x="{cx - rx}" y="{73 - ry}" width="{rx * 2}" height="{ry * 2}" rx="{ry}" fill="{primary}" stroke="#64748B" stroke-width="2"/>'
            )
            if imprint:
                body_parts.append(
                    f'<text x="{cx}" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="{ink}">{imprint}</text>'
                )
    elif shape == "capsule_bicolor":
        for cx in (42, 110, 178):
            body_parts.append(
                f'<rect x="{cx - 22}" y="60" width="44" height="26" rx="13" fill="{secondary}" stroke="#64748B" stroke-width="2"/>'
                f'<path d="M{cx - 9} 60 H{cx} V86 H{cx - 9} A13 13 0 0 1 {cx - 22} 73 A13 13 0 0 1 {cx - 9} 60 Z" fill="{primary}"/>'
                f'<line x1="{cx}" y1="60" x2="{cx}" y2="86" stroke="#64748B" stroke-width="1.5"/>'
            )
            if imprint:
                body_parts.append(
                    f'<text x="{cx}" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#0F172A">{imprint}</text>'
                )
    elif shape == "bottle":
        body_parts.append(
            f'<rect x="86" y="38" width="28" height="10" rx="3" fill="{accent}"/>'
            f'<rect x="76" y="48" width="48" height="56" rx="10" fill="{primary}" stroke="#475569" stroke-width="2"/>'
            f'<rect x="78" y="64" width="44" height="24" fill="{accent}" opacity="0.9"/>'
            f'<text x="100" y="79" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#FFFFFF">{imprint or "SYRUP"}</text>'
            f'<path d="M142 74 H168 L164 102 H146 Z" fill="#FFFFFF" stroke="#64748B" stroke-width="2"/>'
            f'<line x1="147" y1="84" x2="163" y2="84" stroke="{accent}" stroke-width="2"/>'
            f'<line x1="148" y1="92" x2="162" y2="92" stroke="#94A3B8" stroke-width="1.5"/>'
        )
    elif shape == "dropper":
        body_parts.append(
            f'<polygon points="104,37 116,37 113,50 107,50" fill="{accent}"/>'
            f'<rect x="92" y="50" width="36" height="54" rx="9" fill="{primary}" stroke="#475569" stroke-width="2"/>'
            f'<rect x="94" y="68" width="32" height="20" fill="{accent}"/>'
            f'<text x="110" y="81" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#FFFFFF">{imprint or "DROPS"}</text>'
        )
    elif shape == "inhaler":
        body_parts.append(
            f'<rect x="92" y="38" width="28" height="18" rx="4" fill="#CBD5E1" stroke="#475569" stroke-width="2"/>'
            f'<path d="M88 52 H124 V86 H150 V102 H96 A8 8 0 0 1 88 94 Z" fill="{primary}" stroke="#334155" stroke-width="2"/>'
            f'<text x="108" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="{ink}">{imprint or "INH"}</text>'
        )
    elif shape == "tube":
        body_parts.append(
            f'<polygon points="48,60 156,64 156,82 48,86" fill="{primary}" stroke="#475569" stroke-width="2"/>'
            f'<rect x="156" y="67" width="16" height="12" rx="2" fill="{accent}"/>'
            f'<rect x="76" y="65" width="54" height="16" rx="3" fill="{accent}"/>'
            f'<text x="103" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#FFFFFF">{imprint or "GEL"}</text>'
        )
    elif shape == "vial":
        body_parts.append(
            f'<rect x="52" y="64" width="96" height="18" rx="5" fill="{primary}" stroke="#475569" stroke-width="2"/>'
            f'<rect x="148" y="68" width="22" height="10" rx="2" fill="{accent}"/>'
            f'<line x1="170" y1="73" x2="184" y2="73" stroke="#475569" stroke-width="2"/>'
            f'<rect x="74" y="66" width="48" height="14" fill="{accent}"/>'
            f'<text x="98" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#FFFFFF">{imprint or "INJ"}</text>'
        )

    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="114" viewBox="0 0 220 114">'
        + header
        + "".join(body_parts)
        + "</svg>"
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


_COLOR_PALETTE: list[tuple[tuple[int, int, int], dict[str, str]]] = [
    ((255, 255, 255), {"en": "white", "hi": "सफेद", "mr": "पांढरी"}),
    ((254, 243, 199), {"en": "pale yellow", "hi": "हल्की पीली", "mr": "फिकट पिवळी"}),
    ((254, 240, 138), {"en": "yellow", "hi": "पीली", "mr": "पिवळी"}),
    ((254, 215, 170), {"en": "light orange", "hi": "हल्की नारंगी", "mr": "फिकट नारिंगी"}),
    ((249, 115, 22), {"en": "orange", "hi": "नारंगी", "mr": "नारिंगी"}),
    ((219, 234, 254), {"en": "light blue", "hi": "हल्की नीली", "mr": "फिकट निळी"}),
    ((37, 99, 235), {"en": "blue", "hi": "नीली", "mr": "निळी"}),
    ((2, 132, 199), {"en": "sky blue", "hi": "आसमानी नीली", "mr": "आकाशी निळी"}),
    ((204, 251, 241), {"en": "light green", "hi": "हल्की हरी", "mr": "फिकट हिरवी"}),
    ((22, 163, 74), {"en": "green", "hi": "हरी", "mr": "हिरवी"}),
    ((251, 207, 232), {"en": "pink", "hi": "गुलाबी", "mr": "गुलाबी"}),
    ((220, 38, 38), {"en": "red", "hi": "लाल", "mr": "लाल"}),
    ((153, 27, 27), {"en": "dark red", "hi": "गहरी लाल", "mr": "गडद लाल"}),
    ((124, 58, 237), {"en": "purple", "hi": "बैंगनी", "mr": "जांभळी"}),
    ((217, 119, 6), {"en": "golden brown", "hi": "सुनहरी भूरी", "mr": "सोनेरी तपकिरी"}),
]

_STRIP_LOCATIVE: dict[str, tuple[str, str]] = {
    "white": ("सफेद पट्टी में", "पांढऱ्या पट्टीत"),
    "pale yellow": ("हल्की पीली पट्टी में", "फिकट पिवळ्या पट्टीत"),
    "yellow": ("पीली पट्टी में", "पिवळ्या पट्टीत"),
    "light orange": ("हल्की नारंगी पट्टी में", "फिकट नारिंगी पट्टीत"),
    "orange": ("नारंगी पट्टी में", "नारिंगी पट्टीत"),
    "light blue": ("हल्की नीली पट्टी में", "फिकट निळ्या पट्टीत"),
    "blue": ("नीली पट्टी में", "निळ्या पट्टीत"),
    "sky blue": ("आसमानी नीली पट्टी में", "आकाशी निळ्या पट्टीत"),
    "light green": ("हल्की हरी पट्टी में", "फिकट हिरव्या पट्टीत"),
    "green": ("हरी पट्टी में", "हिरव्या पट्टीत"),
    "pink": ("गुलाबी पट्टी में", "गुलाबी पट्टीत"),
    "red": ("लाल पट्टी में", "लाल पट्टीत"),
    "dark red": ("गहरी लाल पट्टी में", "गडद लाल पट्टीत"),
    "purple": ("बैंगनी पट्टी में", "जांभळ्या पट्टीत"),
    "golden brown": ("सुनहरी पट्टी में", "सोनेरी पट्टीत"),
}


def _nearest_color_names(hex_color: str | None) -> dict[str, str]:
    clean = sanitize_hex(hex_color, "#FFFFFF")
    r, g, b = int(clean[1:3], 16), int(clean[3:5], 16), int(clean[5:7], 16)
    best_dist = float("inf")
    best_names = _COLOR_PALETTE[0][1]
    for (pr, pg, pb), names in _COLOR_PALETTE:
        dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if dist < best_dist:
            best_dist = dist
            best_names = names
    return best_names


def _infer_pill_size(strength: str | None, shape: str) -> dict[str, str] | None:
    """Infer elder-friendly size cue (small / medium / large) from strength or oblong shape."""
    if shape not in ("round", "oval", "oblong", "capsule_bicolor"):
        return None
    if strength:
        match = re.search(r"(\d+(?:\.\d+)?)\s*(mcg|ug|mg)\b", strength, flags=re.IGNORECASE)
        if match:
            val = float(match.group(1))
            unit = match.group(2).lower()
            if unit in ("mcg", "ug") or val <= 50:
                return {"en": "small", "hi": "छोटी", "mr": "लहान"}
            if val >= 500:
                return {"en": "large", "hi": "बड़ी", "mr": "मोठी"}
            return {"en": "medium-sized", "hi": "मध्यम आकार की", "mr": "मध्यम आकाराची"}
    if shape == "oblong":
        return {"en": "long", "hi": "लंबी", "mr": "लांबट"}
    return None


def _mr_color_oblique(color_mr: str) -> str:
    """Convert feminine Marathi color adjective to natural oblique form before 'रंगाचा'."""
    overrides = {
        "पांढरी": "पांढऱ्या",
        "फिकट पिवळी": "फिकट पिवळ्या",
        "पिवळी": "पिवळ्या",
        "फिकट निळी": "फिकट निळ्या",
        "निळी": "निळ्या",
        "आकाशी निळी": "आकाशी निळ्या",
        "फिकट हिरवी": "फिकट हिरव्या",
        "हिरवी": "हिरव्या",
        "जांभळी": "जांभळ्या",
        "सुनहरी भूरी": "सोनेरी तपकिरी",
        "सोनेरी तपकिरी": "सोनेरी तपकिरी",
    }
    return overrides.get(color_mr, color_mr)


def describe_visual_for_elder(
    visual_spec: dict[str, Any] | None,
    dosage_form: str = "tablet",
    strength: str | None = None,
) -> dict[str, str]:
    """Generate clear EN/HI/MR visual cues (size, color, shape, strip color) for TTS."""
    spec = visual_spec or default_visual_spec_for_form(dosage_form)
    shape = str(spec.get("shape") or _FORM_DEFAULT_SHAPE.get(dosage_form, "round")).lower()
    primary = _nearest_color_names(spec.get("primary_color"))
    secondary = _nearest_color_names(spec.get("secondary_color")) if spec.get("secondary_color") else None
    accent = _nearest_color_names(spec.get("strip_accent"))
    size = _infer_pill_size(strength, shape)
    accent_hi, accent_mr = _STRIP_LOCATIVE.get(accent["en"], ("पट्टी में", "पट्टीत"))

    if shape == "capsule_bicolor":
        p_mr = _mr_color_oblique(primary["mr"])
        if secondary and secondary["en"] != primary["en"]:
            s_mr = _mr_color_oblique(secondary["mr"])
            en = f"{primary['en']}-and-{secondary['en']} capsule (in the {accent['en']} strip)"
            hi = f"{primary['hi']} और {secondary['hi']} रंग का कैप्सूल ({accent_hi})"
            mr = f"{p_mr} आणि {s_mr} रंगाचा कॅप्सूल ({accent_mr})"
        else:
            en = f"{primary['en']} capsule (in the {accent['en']} strip)"
            hi = f"{primary['hi']} रंग का कैप्सूल ({accent_hi})"
            mr = f"{p_mr} रंगाचा कॅप्सूल ({accent_mr})"
        return {"en": en, "hi": hi, "mr": mr}

    if shape in ("round", "oval", "oblong"):
        shape_en = {"round": "round tablet", "oval": "oval tablet", "oblong": "oblong tablet"}[shape]
        shape_hi = {"round": "गोल गोली", "oval": "अंडाकार गोली", "oblong": "लंबी गोली"}[shape]
        shape_mr = {"round": "गोल गोळी", "oval": "अंडाकृती गोळी", "oblong": "लांबट गोळी"}[shape]
        size_en = f"{size['en']} " if size else ""
        size_hi = f"{size['hi']} " if size and not (shape == "oblong" and size["en"] == "long") else ""
        size_mr = f"{size['mr']} " if size and not (shape == "oblong" and size["en"] == "long") else ""
        en = f"{size_en}{primary['en']} {shape_en} (in the {accent['en']} strip)"
        hi = f"{size_hi}{primary['hi']} {shape_hi} ({accent_hi})"
        mr = f"{size_mr}{primary['mr']} {shape_mr} ({accent_mr})"
        return {"en": en, "hi": hi, "mr": mr}

    non_pill_labels = {
        "bottle": (f"{accent['en']}-label syrup bottle", f"{accent['hi']} लेबल वाली दवा की शीशी", f"{accent['mr']} लेबल असलेली औषधाची बाटली"),
        "dropper": (f"{accent['en']}-cap dropper bottle", f"{accent['hi']} ढक्कन वाली ड्रॉप की शीशी", f"{accent['mr']} झाकणाची ड्रॉपची बाटली"),
        "inhaler": (f"{primary['en']} inhaler", f"{primary['hi']} रंग का इनहेलर", f"{primary['mr']} रंगाचा इनहेलर"),
        "tube": (f"{accent['en']}-band ointment tube", f"{accent['hi']} पट्टी वाली मरहम की ट्यूब", f"{accent['mr']} पट्टीची मलमाची ट्यूब"),
        "vial": (f"{accent['en']}-label injection", f"{accent['hi']} लेबल वाला इंजेक्शन", f"{accent['mr']} लेबल असलेले इंजेक्शन"),
    }
    en, hi, mr = non_pill_labels.get(
        shape,
        (f"{primary['en']} medicine", f"{primary['hi']} दवाई", f"{primary['mr']} औषध"),
    )
    return {"en": en, "hi": hi, "mr": mr}
