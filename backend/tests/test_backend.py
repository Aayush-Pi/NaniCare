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
