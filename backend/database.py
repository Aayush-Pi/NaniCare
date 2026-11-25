"""Neon PostgreSQL SQLAlchemy engine, session dependency, and DB initializer."""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger("nanicare.database")

# Load .env located next to backend files (or in current working directory)
_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH if _ENV_PATH.exists() else None)

_DEFAULT_SQLITE_PATH = Path(__file__).resolve().parent / "nanicare_local.db"
_FALLBACK_SQLITE_URL = f"sqlite:///{_DEFAULT_SQLITE_PATH}"


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 declarative base for all NaniCare ORM models."""


def _is_placeholder_url(url: str) -> bool:
    lowered = url.lower()
    return any(
        token in lowered
        for token in (
            "ep-your-project",
            "user:password@",
            "your_database_url",
            "placeholder",
        )
    )


def _normalize_database_url(raw_url: str | None) -> tuple[str, bool]:
    """Normalize Neon/Postgres URLs for SQLAlchemy + psycopg2.

    Returns:
        Tuple of (normalized_url, is_sqlite).
    """
    if not raw_url or not raw_url.strip() or _is_placeholder_url(raw_url):
        logger.warning(
            "DATABASE_URL is not configured with a live Neon URL; "
            "using local SQLite fallback at %s",
            _DEFAULT_SQLITE_PATH,
        )
        return _FALLBACK_SQLITE_URL, True

    url = raw_url.strip()
    if url.startswith("sqlite"):
        return url, True

    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://") :]

    # Ensure Neon serverless connections enforce TLS if not explicitly specified
    parsed = urlparse(url)
    if parsed.hostname and "neon.tech" in parsed.hostname:
        query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))
        if "sslmode" not in query_params:
            query_params["sslmode"] = "require"
            url = urlunparse(parsed._replace(query=urlencode(query_params)))

    return url, False


DATABASE_URL, IS_SQLITE = _normalize_database_url(os.getenv("DATABASE_URL"))


def _build_engine(url: str, is_sqlite: bool) -> Engine:
    if is_sqlite:
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=10,
        future=True,
    )


engine: Engine = _build_engine(DATABASE_URL, IS_SQLITE)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped SQLAlchemy session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they do not exist yet (idempotent)."""
    # Import models inside init_db so metadata is always registered before create_all
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    logger.info(
        "Database initialized (%s)",
        "SQLite local fallback" if IS_SQLITE else "Neon PostgreSQL",
    )


def check_db_connection() -> tuple[bool, str]:
    """Run a lightweight SELECT 1 probe for /health diagnostics."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "sqlite" if IS_SQLITE else "postgresql"
    except Exception as exc:  # pragma: no cover - defensive runtime check
        logger.exception("Database health probe failed")
        return False, str(exc)
