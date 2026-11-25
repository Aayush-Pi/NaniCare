"""SQLAlchemy 2.0 ORM models matching backend/schema.sql for Neon PostgreSQL."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

# Use native BIGSERIAL / JSONB on PostgreSQL while preserving SQLite local compatibility
BIGINT_PK = BigInteger().with_variant(Integer, "sqlite")
JSON_COL = JSON().with_variant(JSONB, "postgresql")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Profile(Base):
    """Elder patient profile accessed via zero-auth 6-character share_code."""

    __tablename__ = "profiles"
    __table_args__ = (Index("idx_profiles_share_code", "share_code"),)

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    share_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    elder_name: Mapped[str] = mapped_column(String(120), nullable=False)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preferred_language: Mapped[str] = mapped_column(
        String(8), nullable=False, default="hi"
    )
    caregiver_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    caregiver_phone: Mapped[str | None] = mapped_column(String(24), nullable=True)
    known_allergies: Mapped[list[str]] = mapped_column(
        JSON_COL, nullable=False, default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=func.now(),
    )

    medicines: Mapped[list[Medicine]] = relationship(
        "Medicine",
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="Medicine.id",
    )
    dose_logs: Mapped[list[DoseLog]] = relationship(
        "DoseLog",
        back_populates="profile",
        cascade="all, delete-orphan",
    )
    vitals_logs: Mapped[list[VitalLog]] = relationship(
        "VitalLog",
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="VitalLog.recorded_at.desc()",
    )


class Medicine(Base):
    """Verified prescription medicine with deterministic Indian schedule & audio scripts."""

    __tablename__ = "medicines"
    __table_args__ = (Index("idx_medicines_profile_active", "profile_id", "is_active"),)

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        BIGINT_PK, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    brand_name: Mapped[str] = mapped_column(String(160), nullable=False)
    generic_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    strength: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dosage_form: Mapped[str] = mapped_column(
        String(48), nullable=False, default="tablet"
    )
    dosage_pattern: Mapped[str] = mapped_column(
        String(32), nullable=False, default="OD"
    )
    meal_relation: Mapped[str] = mapped_column(
        String(32), nullable=False, default="after_food"
    )
    schedule_slots: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_COL, nullable=False, default=list
    )
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    as_needed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    instructions_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions_mr: Mapped[str | None] = mapped_column(Text, nullable=True)
    strip_thumbnail: Mapped[str | None] = mapped_column(Text, nullable=True)
    pill_color_tag: Mapped[str] = mapped_column(
        String(32), nullable=False, default="#2563EB"
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    safety_flags: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_COL, nullable=False, default=list
    )
    verified_by_caregiver: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    prescribed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=func.now(),
    )

    profile: Mapped[Profile] = relationship("Profile", back_populates="medicines")
    dose_logs: Mapped[list[DoseLog]] = relationship(
        "DoseLog", back_populates="medicine", cascade="all, delete-orphan"
    )


class DoseLog(Base):
    """Per-day, per-slot dose completion record (idempotent upsert key)."""

    __tablename__ = "dose_logs"
    __table_args__ = (
        UniqueConstraint(
            "medicine_id",
            "dose_date",
            "scheduled_slot",
            name="uq_dose_log_medicine_date_slot",
        ),
        Index("idx_dose_logs_profile_date", "profile_id", "dose_date"),
    )

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        BIGINT_PK, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[int] = mapped_column(
        BIGINT_PK, ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False
    )
    dose_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_slot: Mapped[str] = mapped_column(String(32), nullable=False)
    scheduled_time: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="taken")
    taken_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    marked_by: Mapped[str] = mapped_column(String(32), nullable=False, default="nani")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        server_default=func.now(),
    )

    profile: Mapped[Profile] = relationship("Profile", back_populates="dose_logs")
    medicine: Mapped[Medicine] = relationship("Medicine", back_populates="dose_logs")


class VitalLog(Base):
    """Temperature, blood pressure, weight, and deterministic clinical alert log."""

    __tablename__ = "vitals_logs"
    __table_args__ = (
        Index("idx_vitals_logs_profile_recorded", "profile_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        BIGINT_PK, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        server_default=func.now(),
    )
    temperature_f: Mapped[float | None] = mapped_column(Float, nullable=True)
    systolic_mmhg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_mmhg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    pulse_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blood_sugar_mgdl: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="normal"
    )
    flags: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_COL, nullable=False, default=list
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[str] = mapped_column(
        String(32), nullable=False, default="caregiver"
    )

    profile: Mapped[Profile] = relationship("Profile", back_populates="vitals_logs")
