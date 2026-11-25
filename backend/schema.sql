-- =============================================================================
-- NaniCare PostgreSQL Schema (Neon Serverless Postgres Compatible)
-- Idempotent DDL matching backend/models.py exactly.
-- Safe to run repeatedly in Neon SQL Editor or via MCP/psql.
-- =============================================================================

-- 1. Elder Profiles (keyed by 6-char share_code, zero-auth Nani Mode)
CREATE TABLE IF NOT EXISTS profiles (
    id                  BIGSERIAL PRIMARY KEY,
    share_code          VARCHAR(12) NOT NULL UNIQUE,
    elder_name          VARCHAR(120) NOT NULL,
    age                 INTEGER,
    preferred_language  VARCHAR(8) NOT NULL DEFAULT 'hi',
    caregiver_name      VARCHAR(120),
    caregiver_phone     VARCHAR(24),
    known_allergies     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_share_code
    ON profiles (share_code);

-- 2. Verified & Scheduled Medicines
CREATE TABLE IF NOT EXISTS medicines (
    id                      BIGSERIAL PRIMARY KEY,
    profile_id              BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    brand_name              VARCHAR(160) NOT NULL,
    generic_name            VARCHAR(160),
    strength                VARCHAR(64),
    dosage_form             VARCHAR(48) NOT NULL DEFAULT 'tablet',
    dosage_pattern          VARCHAR(32) NOT NULL DEFAULT 'OD',
    meal_relation           VARCHAR(32) NOT NULL DEFAULT 'after_food',
    schedule_slots          JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_days           INTEGER,
    as_needed               BOOLEAN NOT NULL DEFAULT FALSE,
    instructions_en         TEXT,
    instructions_hi         TEXT,
    instructions_mr         TEXT,
    strip_thumbnail         TEXT,
    pill_color_tag          VARCHAR(32) NOT NULL DEFAULT '#2563EB',
    confidence              DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    needs_review            BOOLEAN NOT NULL DEFAULT FALSE,
    safety_flags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified_by_caregiver   BOOLEAN NOT NULL DEFAULT TRUE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    prescribed_by           VARCHAR(120),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medicines_profile_active
    ON medicines (profile_id, is_active);

-- 3. Daily Dose Adherence Logs (idempotent per medicine + date + slot)
CREATE TABLE IF NOT EXISTS dose_logs (
    id              BIGSERIAL PRIMARY KEY,
    profile_id      BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    medicine_id     BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    dose_date       DATE NOT NULL,
    scheduled_slot  VARCHAR(32) NOT NULL,
    scheduled_time  VARCHAR(8) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'taken',
    taken_at        TIMESTAMPTZ,
    marked_by       VARCHAR(32) NOT NULL DEFAULT 'nani',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dose_log_medicine_date_slot
        UNIQUE (medicine_id, dose_date, scheduled_slot)
);

CREATE INDEX IF NOT EXISTS idx_dose_logs_profile_date
    ON dose_logs (profile_id, dose_date);

-- 4. Vitals & Deterministic Alert Logs
CREATE TABLE IF NOT EXISTS vitals_logs (
    id                  BIGSERIAL PRIMARY KEY,
    profile_id          BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature_f       DOUBLE PRECISION,
    systolic_mmhg       INTEGER,
    diastolic_mmhg      INTEGER,
    weight_kg           DOUBLE PRECISION,
    pulse_bpm           INTEGER,
    spo2_percent        INTEGER,
    blood_sugar_mgdl    DOUBLE PRECISION,
    overall_status      VARCHAR(16) NOT NULL DEFAULT 'normal',
    flags               JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes               TEXT,
    recorded_by         VARCHAR(32) NOT NULL DEFAULT 'caregiver'
);

CREATE INDEX IF NOT EXISTS idx_vitals_logs_profile_recorded
    ON vitals_logs (profile_id, recorded_at DESC);
