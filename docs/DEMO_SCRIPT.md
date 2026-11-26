# NaniCare — 3-Minute Hackathon Demo Runbook

## 1. Pre-Demo Check (20 seconds)
1. Start local servers with `./start.sh` (`http://localhost:3000` frontend, `http://localhost:8000` backend) or open live `https://nani-care.vercel.app/` (`DEMO01`).
2. Confirm the top-right status badge shows **FastAPI · Neon** (or **FastAPI · SQLite**).
3. In **Caregiver Mode → Schedule**, click **Reset DEMO01** if needed so **Kamla Sharma (`DEMO01`)** starts fresh with 5 Indian medicines and recorded **Sulfa drugs** allergy.

## 2. Caregiver Mode: AI Vision + Clinical Safety Gate (65 seconds)
1. Open **Caregiver Mode → Scan & Verify**.
2. Click **Upload or Capture Photo** (shows **Take Photo** vs **Choose from Files / Gallery** on mobile) or click **Scan Sample Clinic Prescription**.
3. Highlight the 3-layer deterministic safety gate before anything reaches the elder:
   - **Yellow OCR Gate (`< 80%` confidence):** `Amlong-5` (smudged strength/frequency) is locked in amber until the caregiver verifies it against the side-by-side prescription photo.
   - **Red Allergy & Interaction Gate:** Automatically catches patient **Allergy Alerts** (`DEMO01` Sulfa cross-check at scan time), **Hidden Duplicate Paracetamol** across Indian FDCs (e.g., `Zerodol-P` + `Dolo 650`), **Thyroid + Calcium 4-hour absorption conflict**, **Blood Thinner + NSAID bleeding risk**, and **AGS Beers Criteria Geriatric Fall Risk**.
   - **Zero-Token Parametric Pill Strips:** Crisp vector blister strips + size/color/shape descriptions generated deterministically for 60+ Indian brands.
4. Confirm the medicines and click **Replace & Publish** to push the verified regimen to PostgreSQL.

## 3. Grandparents Mode: Assistive Access + Pill Safety Check (55 seconds)
1. Tap **Grandparents Mode** (`DEMO01`) — zero login, app chrome disappears into oversized iOS Assistive Access tiles with root `rem` scaling and AAA High Contrast.
2. Switch between **English**, **हिन्दी**, and **मराठी**, tap **Hear Medicines** for Indian neural voice guidance (`edge-tts` describing exact pill size, color, shape, and meal icon), or tap **Talk** for hands-free voice commands.
3. Tap **I Took It (`✓`)** on a due card to show haptic confirmation and instant database sync.
4. Open **Check My Pill** and snap/upload a blister strip:
   - Matching strip + strength → **Green "YES, THIS IS YOUR PILL"** with spoken slot timing.
   - Wrong drug OR **Wrong Strength** (e.g., `Thyronorm 100 mcg` instead of prescribed `50 mcg`) → **Red "STOP" alert** spoken in Hindi/Marathi/English.

## 4. Vitals, Trends & Family WhatsApp Loop (40 seconds)
1. Open **Vitals & Summary** and log e.g. Temp `101.6°F`, BP `148/92`, Weight `58.6 kg`.
2. Show the colorblind-safe SVG trend charts (with screen-reader `<table>` fallbacks), deterministic caution/critical alert banner, and **Medicine Refill Countdown**.
3. Click **Share on WhatsApp** on the **Daily Family WhatsApp Report** to open a pre-formatted `wa.me` family update in one tap.
