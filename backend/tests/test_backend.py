"""Unit and API integration tests for NaniCare backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import scheduler  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide a FastAPI TestClient backed by an isolated temporary SQLite database."""
    test_db = tmp_path / "test_nanicare.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db}")
    monkeypatch.setenv("GEMINI_API_KEY", "placeholder")

    import importlib
    import database
    import models
    import engine as engine_module

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(engine_module)

    with TestClient(engine_module.app) as test_client:
        yield test_client


# =============================================================================
# 1. Deterministic Scheduler & Clinical Rule Engine Tests
# =============================================================================


def test_parse_indian_dosage_patterns():
    slots, as_needed, pattern, meal = scheduler.parse_indian_dosage_pattern(
        dosage_pattern="½-0-½",
        meal_relation="after_food",
        brand_name="Glycomet-500",
    )
    assert not as_needed
    assert pattern == "0.5-0-0.5"
    assert meal == "after_food"
    assert [s.slot for s in slots] == ["morning", "night"]
    assert all(s.dose_qty == 0.5 for s in slots)

    thyroid_slots, _, _, thyroid_meal = scheduler.parse_indian_dosage_pattern(
        dosage_pattern="OD",
        meal_relation="after_food",
        brand_name="Thyronorm",
        generic_name="Levothyroxine",
    )
    assert thyroid_meal == "empty_stomach"
    assert [s.slot for s in thyroid_slots] == ["empty_stomach"]

    sos_slots, is_sos, sos_pattern, _ = scheduler.parse_indian_dosage_pattern(
        dosage_pattern="SOS",
        meal_relation="after_food",
        brand_name="Dolo 650",
    )
    assert is_sos
    assert sos_pattern == "SOS"
    assert [s.slot for s in sos_slots] == ["sos"]


def test_evaluate_medicine_safety_interactions_and_duplicates():
    per_med, regimen = scheduler.evaluate_medicine_safety(
        [
            {
                "brand_name": "Ecosprin 75",
                "generic_name": "Aspirin",
                "strength": "75 mg",
                "dosage_pattern": "0-1-0",
                "meal_relation": "after_food",
                "confidence": 0.95,
                "low_confidence_fields": [],
            },
            {
                "brand_name": "Brufen 400",
                "generic_name": "Ibuprofen",
                "strength": "400 mg",
                "dosage_pattern": "SOS",
                "meal_relation": "after_food",
                "confidence": 0.70,
                "low_confidence_fields": ["dosage_pattern"],
            },
            {
                "brand_name": "Thyronorm",
                "generic_name": "Levothyroxine",
                "strength": "50 mcg",
                "dosage_pattern": "1-0-0",
                "meal_relation": "empty_stomach",
                "confidence": 0.95,
                "low_confidence_fields": [],
            },
            {
                "brand_name": "Shelcal-500",
                "generic_name": "Calcium Carbonate",
                "strength": "500 mg",
                "dosage_pattern": "0-1-0",
                "meal_relation": "after_food",
                "confidence": 0.95,
                "low_confidence_fields": [],
            },
        ]
    )
    regimen_codes = {f.code for f in regimen}
    assert "INTERACTION_BLEEDING_RISK" in regimen_codes
    assert "INTERACTION_THYROID_ABSORPTION" in regimen_codes
    brufen_codes = {f.code for f in per_med[1]}
    assert "LOW_CONFIDENCE_OCR" in brufen_codes


def test_evaluate_vitals_thresholds():
    status, flags, *_ = scheduler.evaluate_vitals(
        temperature_f=103.2,
        systolic_mmhg=184,
        diastolic_mmhg=122,
        weight_kg=62.5,
        previous_weight_kg=59.5,
        days_since_previous_weight=3.0,
    )
    assert status == "critical"
    codes = {f.code for f in flags}
    assert "HIGH_FEVER" in codes
    assert "HYPERTENSIVE_CRISIS" in codes
    assert "RAPID_WEIGHT_GAIN" in codes


# =============================================================================
# 2. FastAPI Endpoint Integration Tests
# =============================================================================


def test_health_and_demo_seed(client: TestClient):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["database_connected"] is True
    assert body["database_backend"] == "sqlite"

    profile = client.get("/profile/DEMO01")
    assert profile.status_code == 200
    assert profile.json()["share_code"] == "DEMO01"

    reset_res = client.post("/demo/seed?reset=true")
    assert reset_res.status_code == 200
    assert reset_res.json()["active_medicine_count"] >= 4


def test_scan_demo_and_fallback(client: TestClient):
    demo_res = client.get("/scan/demo")
    assert demo_res.status_code == 200
    assert demo_res.json()["source"] == "demo_fallback"
    assert len(demo_res.json()["medicines"]) >= 1

    post_res = client.post("/scan", data={"demo": "true"})
    assert post_res.status_code == 200
    assert post_res.json()["source"] == "demo_fallback"

    empty_res = client.post(
        "/scan",
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )
    assert empty_res.status_code == 400


def test_profile_medicines_patch_delete_and_dose_alias(client: TestClient):
    # Create profile with auto-generated share_code
    prof_res = client.post(
        "/profile",
        json={
            "elder_name": "Asha Tai",
            "age": 74,
            "preferred_language": "mr",
            "caregiver_name": "Rohan",
            "caregiver_phone": "+919820000001",
            "known_allergies": ["Sulfa"],
        },
    )
    assert prof_res.status_code == 201
    share_code = prof_res.json()["share_code"]
    assert len(share_code) == 6

    # Confirm medicines (Thyronorm resolves to empty_stomach slot)
    confirm_res = client.post(
        "/medicines/confirm",
        json={
            "share_code": share_code,
            "replace_existing": True,
            "medicines": [
                {
                    "brand_name": "Thyronorm",
                    "generic_name": "Levothyroxine",
                    "strength": "50 mcg",
                    "dosage_form": "tablet",
                    "dosage_pattern": "1-0-0",
                    "meal_relation": "empty_stomach",
                    "duration_days": 30,
                },
                {
                    "brand_name": "Shelcal-500",
                    "generic_name": "Calcium Carbonate",
                    "strength": "500 mg",
                    "dosage_form": "tablet",
                    "dosage_pattern": "0-1-0",
                    "meal_relation": "after_food",
                    "duration_days": 30,
                },
            ],
        },
    )
    assert confirm_res.status_code == 201
    meds = confirm_res.json()["medicines"]
    assert len(meds) == 2
    thyroid_id = meds[0]["id"]
    shelcal_id = meds[1]["id"]
    assert any(
        f["code"] == "INTERACTION_THYROID_ABSORPTION"
        for f in confirm_res.json()["regimen_safety_flags"]
    )

    # PATCH medicine updates strength and regenerates instructions
    patch_res = client.patch(
        f"/medicines/{thyroid_id}",
        json={"strength": "75 mcg"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["strength"] == "75 mcg"
    assert "75 mcg" in (patch_res.json()["instructions_en"] or "")

    # Simplified client sends scheduled_slot="morning" for an empty_stomach medicine
    mark_res = client.post(
        "/doses/mark",
        json={
            "share_code": share_code,
            "medicine_id": thyroid_id,
            "scheduled_slot": "morning",
            "status": "taken",
            "marked_by": "nani",
        },
    )
    assert mark_res.status_code == 200
    assert mark_res.json()["scheduled_slot"] == "empty_stomach"

    # Schedule reflects taken status on the empty_stomach card
    sched_res = client.get(f"/schedule/{share_code}?lang=mr")
    assert sched_res.status_code == 200
    thyroid_card = next(
        c for c in sched_res.json()["cards"] if c["medicine_id"] == thyroid_id
    )
    assert thyroid_card["status"] == "taken"

    # Soft-delete second medicine
    del_med = client.delete(f"/medicines/{shelcal_id}")
    assert del_med.status_code == 200
    active_meds = client.get(f"/medicines/{share_code}").json()
    assert [m["id"] for m in active_meds] == [thyroid_id]


def test_vitals_create_history_delete_and_summary(client: TestClient):
    vital_res = client.post(
        "/vitals",
        json={
            "share_code": "DEMO01",
            "temperature_f": 101.4,
            "systolic_mmhg": 146,
            "diastolic_mmhg": 92,
            "weight_kg": 58.6,
            "pulse_bpm": 88,
            "spo2_percent": 97,
            "blood_sugar_mgdl": 135,
            "recorded_by": "caregiver",
        },
    )
    assert vital_res.status_code == 201
    vital_id = vital_res.json()["id"]
    assert vital_res.json()["overall_status"] == "caution"

    summary_res = client.get("/profile/DEMO01/summary")
    assert summary_res.status_code == 200
    assert summary_res.json()["whatsapp_url"].startswith("https://wa.me/?text=")

    del_res = client.delete(f"/vitals/{vital_id}")
    assert del_res.status_code == 200
    assert del_res.json() == {"deleted": True, "vital_id": vital_id}

    del_again = client.delete(f"/vitals/{vital_id}")
    assert del_again.status_code == 404


def test_list_profiles_replace_and_flush_medicines(client: TestClient):
    profiles = client.get("/profiles").json()
    assert any(p["share_code"] == "DEMO01" for p in profiles)

    # Append a new medicine to DEMO01 (replace_existing=False)
    append_res = client.post(
        "/medicines/confirm",
        json={
            "share_code": "DEMO01",
            "replace_existing": False,
            "medicines": [
                {
                    "brand_name": "ExtraMed-10",
                    "strength": "10 mg",
                    "dosage_form": "tablet",
                    "dosage_pattern": "0-0-1",
                    "meal_relation": "after_food",
                }
            ],
        },
    )
    assert append_res.status_code == 201
    after_append = client.get("/medicines/DEMO01").json()
    assert any(m["brand_name"] == "ExtraMed-10" for m in after_append)
    assert len(after_append) > 1

    # Replace existing medicines (replace_existing=True)
    replace_res = client.post(
        "/medicines/confirm",
        json={
            "share_code": "DEMO01",
            "replace_existing": True,
            "medicines": [
                {
                    "brand_name": "FreshOnly-500",
                    "strength": "500 mg",
                    "dosage_form": "tablet",
                    "dosage_pattern": "1-0-0",
                    "meal_relation": "after_food",
                }
            ],
        },
    )
    assert replace_res.status_code == 201
    after_replace = client.get("/medicines/DEMO01").json()
    assert [m["brand_name"] for m in after_replace] == ["FreshOnly-500"]

    # Flush all active medicines for DEMO01
    flush_res = client.delete("/profile/DEMO01/medicines")
    assert flush_res.status_code == 200
    assert flush_res.json() == {
        "flushed": True,
        "share_code": "DEMO01",
        "deactivated_count": 1,
    }
    assert client.get("/medicines/DEMO01").json() == []


def test_visuals_svg_renderer_and_xss_escaping():
    import base64
    import visuals

    shapes = [
        "round",
        "oval",
        "oblong",
        "capsule_bicolor",
        "bottle",
        "dropper",
        "inhaler",
        "tube",
        "vial",
    ]
    for shape in shapes:
        uri = visuals.render_medicine_svg(
            brand_name="<script>Dolo</script>",
            strength="650 mg",
            visual_spec={
                "shape": shape,
                "primary_color": "#FEF3C7",
                "secondary_color": "#2563EB",
                "strip_accent": "#0284C7",
                "imprint": "650",
            },
        )
        assert uri.startswith("data:image/svg+xml;base64,")
        assert len(uri) < 2800
        decoded = base64.b64decode(uri.split(",", 1)[1]).decode("utf-8")
        assert decoded.startswith("<svg ")
        assert "<script>" not in decoded
        assert "&lt;script&gt;" in decoded


def test_catalog_seed_search_lookup_and_confirm_autocache(client: TestClient):
    # Pre-seeded catalog returns hits with 0 AI tokens
    search_res = client.get("/catalog/search?q=dolo&limit=5")
    assert search_res.status_code == 200
    items = search_res.json()
    assert len(items) >= 1
    assert any("Dolo" in item["brand_name"] for item in items)
    assert items[0]["strip_thumbnail"].startswith("data:image/svg+xml;base64,")

    # POST /catalog/lookup hits local DB cache for seeded brand
    hit_res = client.post(
        "/catalog/lookup",
        json={"query": "Pan-D", "dosage_form": "capsule", "allow_ai": False},
    )
    assert hit_res.status_code == 200
    hit_body = hit_res.json()
    assert hit_body["found"] is True
    assert hit_body["cache_hit"] is True
    assert hit_body["visual_source"] == "catalog_verified"
    assert hit_body["entry"]["visual_spec"]["shape"] == "capsule_bicolor"

    # Unknown brand falls back cleanly when AI disabled
    miss_res = client.post(
        "/catalog/lookup",
        json={"query": "ZetaBrandX-100", "dosage_form": "syrup", "allow_ai": False},
    )
    assert miss_res.status_code == 200
    assert miss_res.json()["visual_source"] == "generic_fallback"
    assert miss_res.json()["entry"]["visual_spec"]["shape"] == "bottle"

    # Confirming an unknown medicine auto-caches it into medicine_catalog
    confirm_res = client.post(
        "/medicines/confirm",
        json={
            "share_code": "DEMO01",
            "replace_existing": False,
            "medicines": [
                {
                    "brand_name": "ZetaBrandX-100",
                    "strength": "100 mg",
                    "dosage_form": "syrup",
                    "dosage_pattern": "1-0-1",
                    "meal_relation": "after_food",
                }
            ],
        },
    )
    assert confirm_res.status_code == 201
    assert confirm_res.json()["medicines"][0]["strip_thumbnail"].startswith(
        "data:image/svg+xml;base64,"
    )

    cached_res = client.post(
        "/catalog/lookup",
        json={"query": "ZetaBrandX-100", "dosage_form": "syrup", "allow_ai": False},
    )
    assert cached_res.status_code == 200
    assert cached_res.json()["cache_hit"] is True


def test_allergy_conflict_detection(client: TestClient):
    # Direct scheduler unit test
    per_med, regimen = scheduler.evaluate_medicine_safety(
        [
            {
                "brand_name": "Augmentin 625 Duo",
                "generic_name": "Amoxicillin + Clavulanic Acid",
                "strength": "625 mg",
                "dosage_pattern": "1-0-1",
                "meal_relation": "after_food",
                "confidence": 0.95,
                "low_confidence_fields": [],
            }
        ],
        known_allergies=["Penicillin"],
    )
    assert any(f.code == "ALLERGY_CONFLICT" and f.severity == "critical" for f in per_med[0])
    assert any(f.code == "ALLERGY_CONFLICT" for f in regimen)

    # API confirm test with profile allergy
    prof = client.post(
        "/profile",
        json={
            "share_code": "ALRG01",
            "elder_name": "Mohan Dada",
            "preferred_language": "hi",
            "known_allergies": ["Sulfa drugs"],
        },
    )
    assert prof.status_code == 201

    conf = client.post(
        "/medicines/confirm",
        json={
            "share_code": "ALRG01",
            "replace_existing": True,
            "medicines": [
                {
                    "brand_name": "Septran DS",
                    "generic_name": "Sulfamethoxazole + Trimethoprim",
                    "strength": "800 mg",
                    "dosage_form": "tablet",
                    "dosage_pattern": "1-0-1",
                    "meal_relation": "after_food",
                }
            ],
        },
    )
    assert conf.status_code == 201
    assert any(f["code"] == "ALLERGY_CONFLICT" for f in conf.json()["regimen_safety_flags"])


def test_refills_strip_verifier_and_trends(client: TestClient):
    from datetime import datetime, timedelta, timezone

    # Refill math unit test
    four_days_ago = datetime.now(timezone.utc) - timedelta(days=4)
    elapsed, remaining, status_val, msg_en, _, _ = scheduler.compute_refill_status(
        brand_name="Opox-CV",
        created_at=four_days_ago,
        duration_days=5,
    )
    assert elapsed >= 3
    assert remaining is not None and remaining <= 2
    assert status_val == "refill_soon"
    assert "Opox-CV" in msg_en

    # Refills endpoint
    refills_res = client.get("/profile/DEMO01/refills")
    assert refills_res.status_code == 200
    assert len(refills_res.json()["items"]) >= 4

    # Strip verifier on DEMO01 (demo payload's first med is Thyronorm -> matches DEMO01)
    verify_match = client.post(
        "/scan/verify-strip",
        data={"share_code": "DEMO01", "demo": "true"},
    )
    assert verify_match.status_code == 200
    assert verify_match.json()["matched"] is True
    assert "Thyronorm" in verify_match.json()["spoken_en"]

    # Strip verifier on an empty profile -> matched=False + stop warning
    client.post(
        "/profile",
        json={"share_code": "EMPT01", "elder_name": "Lata Nani", "preferred_language": "mr"},
    )
    verify_miss = client.post(
        "/scan/verify-strip",
        data={"share_code": "EMPT01", "demo": "true"},
    )
    assert verify_miss.status_code == 200
    assert verify_miss.json()["matched"] is False
    assert verify_miss.json()["warning"] is not None

    # 7-day trends endpoint
    trends_res = client.get("/profile/DEMO01/trends?days=7")
    assert trends_res.status_code == 200
    trends = trends_res.json()
    assert len(trends["daily_adherence"]) == 7
    assert trends["vitals_trend"]["readings_count"] >= 2


def test_elder_friendly_visual_tts_includes_size_color_and_shape(client: TestClient):
    # Thyronorm 50 mcg -> small pale yellow round tablet (in the sky blue strip)
    sched_en = client.get("/schedule/DEMO01?lang=en").json()
    thyro_en = next(c for c in sched_en["cards"] if c["brand_name"] == "Thyronorm")
    assert "small" in thyro_en["spoken_text"].lower()
    assert "yellow" in thyro_en["spoken_text"].lower()
    assert "round tablet" in thyro_en["spoken_text"].lower()
    assert "strip" in thyro_en["spoken_text"].lower()

    # Check Hindi avoids duplicate 'खाली पेट खाली पेट' and includes size/color/shape
    sched_hi = client.get("/schedule/DEMO01?lang=hi").json()
    thyro_hi = next(c for c in sched_hi["cards"] if c["brand_name"] == "Thyronorm")
    assert "खाली पेट खाली पेट" not in thyro_hi["spoken_text"]
    assert "छोटी" in thyro_hi["spoken_text"]
    assert "गोल गोली" in thyro_hi["spoken_text"]

    # Check Marathi avoids duplicate 'उपाशीपोटी उपाशीपोटी' and includes size/color/shape
    sched_mr = client.get("/schedule/DEMO01?lang=mr").json()
    thyro_mr = next(c for c in sched_mr["cards"] if c["brand_name"] == "Thyronorm")
    assert "उपाशीपोटी उपाशीपोटी" not in thyro_mr["spoken_text"]
    assert "लहान" in thyro_mr["spoken_text"]
    assert "गोल गोळी" in thyro_mr["spoken_text"]

    # Check bicolor capsule (Pan-D -> orange-and-white capsule)
    conf_res = client.post(
        "/medicines/confirm",
        json={
            "share_code": "DEMO01",
            "replace_existing": False,
            "medicines": [
                {
                    "brand_name": "Pan-D",
                    "strength": "40 mg",
                    "dosage_form": "capsule",
                    "dosage_pattern": "1-0-0",
                    "meal_relation": "empty_stomach",
                }
            ],
        },
    )
    assert conf_res.status_code == 201
    pan_med = conf_res.json()["medicines"][0]
    assert "orange-and-white capsule" in pan_med["instructions_en"].lower()
    assert "नारंगी और सफेद" in pan_med["instructions_hi"]
    assert "नारिंगी आणि पांढऱ्या" in pan_med["instructions_mr"]


