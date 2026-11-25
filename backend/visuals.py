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
