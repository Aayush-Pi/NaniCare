#!/usr/bin/env bash
# =============================================================================
# NaniCare Backend Smoke Test Script
# Verifies every endpoint end-to-end against a running uvicorn server.
#
# Usage:
#   ./test_api.sh                       # defaults to http://127.0.0.1:8000
#   BASE_URL=http://localhost:8000 ./test_api.sh
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
SHARE_CODE="DEMO01"

echo "============================================================"
echo " NaniCare API Smoke Test -> ${BASE_URL}"
echo "============================================================"

# Helper for pretty JSON output if jq is available
pp() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

echo ""
echo "[1/11] GET /health"
curl -fsS "${BASE_URL}/health" | pp

echo ""
echo "[2/11] GET /profile/${SHARE_CODE} (auto-seeded on startup)"
curl -fsS "${BASE_URL}/profile/${SHARE_CODE}" | pp

echo ""
echo "[3/11] GET /scan/demo (Caregiver Mode demo extraction)"
curl -fsS "${BASE_URL}/scan/demo" | pp

echo ""
echo "[4/11] POST /scan (multipart demo fallback / Gemini Vision)"
curl -fsS -X POST "${BASE_URL}/scan" \
  -F "demo=true" | pp

echo ""
echo "[5/11] POST /profile (create custom elder profile)"
CREATED_PROFILE=$(curl -fsS -X POST "${BASE_URL}/profile" \
  -H "Content-Type: application/json" \
  -d '{
    "share_code": "NANI99",
    "elder_name": "Savitri Aaji",
    "age": 76,
    "preferred_language": "mr",
    "caregiver_name": "Priya Deshmukh",
    "caregiver_phone": "+919820012345",
    "known_allergies": ["Penicillin"]
  }')
echo "${CREATED_PROFILE}" | pp

echo ""
echo "[6/11] POST /medicines/confirm (save verified prescription to Neon Postgres)"
CONFIRMED=$(curl -fsS -X POST "${BASE_URL}/medicines/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "share_code": "NANI99",
    "prescribed_by": "Dr. Sneha Joshi, Mumbai",
    "replace_existing": true,
    "medicines": [
      {
        "brand_name": "Thyronorm",
        "generic_name": "Levothyroxine Sodium",
        "strength": "50 mcg",
        "dosage_form": "tablet",
        "dosage_pattern": "1-0-0",
        "meal_relation": "empty_stomach",
        "duration_days": 30
      },
      {
        "brand_name": "Glycomet-500",
        "generic_name": "Metformin Hydrochloride",
        "strength": "500 mg",
        "dosage_form": "tablet",
        "dosage_pattern": "1-0-1",
        "meal_relation": "after_food",
        "duration_days": 30
      },
      {
        "brand_name": "Shelcal-500",
        "generic_name": "Calcium Carbonate + Vitamin D3",
        "strength": "500 mg",
        "dosage_form": "tablet",
        "dosage_pattern": "0-1-0",
        "meal_relation": "after_food",
        "duration_days": 30
      }
    ]
  }')
echo "${CONFIRMED}" | pp

FIRST_MED_ID=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["medicines"][0]["id"])' "${CONFIRMED}")
echo "Captured verified medicine_id=${FIRST_MED_ID}"

echo ""
echo "[7/11] GET /schedule/NANI99?lang=mr (Nani Mode Marathi cards)"
curl -fsS "${BASE_URL}/schedule/NANI99?lang=mr" | pp

echo ""
echo "[8/11] POST /doses/mark (mark empty_stomach dose as taken)"
curl -fsS -X POST "${BASE_URL}/doses/mark" \
  -H "Content-Type: application/json" \
  -d "{
    \"share_code\": \"NANI99\",
    \"medicine_id\": ${FIRST_MED_ID},
    \"scheduled_slot\": \"empty_stomach\",
    \"status\": \"taken\",
    \"marked_by\": \"nani\",
    \"notes\": \"Taken with warm water\"
  }" | pp

echo ""
echo "[9/13] PATCH /medicines/${FIRST_MED_ID} (update confirmed medicine strength & instructions)"
curl -fsS -X PATCH "${BASE_URL}/medicines/${FIRST_MED_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "strength": "75 mcg"
  }' | pp

echo ""
echo "[10/13] POST /vitals (log abnormal fever + elevated BP -> deterministic flags)"
CREATED_VITAL=$(curl -fsS -X POST "${BASE_URL}/vitals" \
  -H "Content-Type: application/json" \
  -d '{
    "share_code": "NANI99",
    "temperature_f": 101.6,
    "systolic_mmhg": 148,
    "diastolic_mmhg": 92,
    "weight_kg": 56.5,
    "pulse_bpm": 88,
    "notes": "Feeling slightly warm in the evening",
    "recorded_by": "caregiver"
  }')
echo "${CREATED_VITAL}" | pp

VITAL_ID=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["id"])' "${CREATED_VITAL}")

echo ""
echo "[11/13] GET /vitals/NANI99 (vitals history)"
curl -fsS "${BASE_URL}/vitals/NANI99" | pp

echo ""
echo "[12/13] GET /profile/NANI99/summary (daily report + WhatsApp https://wa.me/?text=... link)"
SUMMARY=$(curl -fsS "${BASE_URL}/profile/NANI99/summary")
echo "${SUMMARY}" | pp

WA_URL=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["whatsapp_url"].startswith("https://wa.me/?text="), d["whatsapp_url"]; print(d["whatsapp_url"])' "${SUMMARY}")
echo ""
echo "Verified WhatsApp Deep Link:"
echo "${WA_URL}"

echo ""
echo "[13/13] DELETE /vitals/${VITAL_ID} (remove disposable test vital)"
curl -fsS -X DELETE "${BASE_URL}/vitals/${VITAL_ID}" | pp
echo ""
echo "All 13 NaniCare backend smoke tests PASSED!"
