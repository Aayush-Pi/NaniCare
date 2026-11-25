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

# Load root Neon .env.local first (pulled by `neon deploy` / `neon env pull`), then fallback .env files.
# Existing real environment variables (e.g. Render/Railway or pytest monkeypatch) always take precedence.
_BACKEND_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _BACKEND_DIR.parent
_ENV_CANDIDATES = (
    _ROOT_DIR / ".env.local",
    _ROOT_DIR / ".env",
    _BACKEND_DIR / ".env",
)


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


if _is_placeholder_url(os.getenv("DATABASE_URL", "")):
    os.environ.pop("DATABASE_URL", None)

for _env_file in _ENV_CANDIDATES:
    if _env_file.exists():
        load_dotenv(dotenv_path=_env_file, override=False)

_DEFAULT_SQLITE_PATH = _BACKEND_DIR / "nanicare_local.db"
_FALLBACK_SQLITE_URL = f"sqlite:///{_DEFAULT_SQLITE_PATH}"


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 declarative base for all NaniCare ORM models."""


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
_RAW_UNPOOLED_URL = os.getenv("DATABASE_URL_UNPOOLED")
DATABASE_URL_UNPOOLED, _ = (
    _normalize_database_url(_RAW_UNPOOLED_URL)
    if (not IS_SQLITE and _RAW_UNPOOLED_URL and not _is_placeholder_url(_RAW_UNPOOLED_URL))
    else (DATABASE_URL, IS_SQLITE)
)


def _build_engine(url: str, is_sqlite: bool) -> Engine:
    if is_sqlite:
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )
    # Neon PgBouncer handles large connection fan-out; keep SQLAlchemy pool compact with pre_ping
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
    """Create all tables idempotently, preferring Neon's unpooled direct connection for DDL."""
    # Import models inside init_db so metadata is always registered before create_all
    import models  # noqa: F401

    if not IS_SQLITE and DATABASE_URL_UNPOOLED != DATABASE_URL:
        ddl_engine = create_engine(DATABASE_URL_UNPOOLED, pool_pre_ping=True, future=True)
        try:
            Base.metadata.create_all(bind=ddl_engine)
        finally:
            ddl_engine.dispose()
    else:
        Base.metadata.create_all(bind=engine)

    branch = os.getenv("NEON_BRANCH")
    logger.info(
        "Database initialized (%s)",
        "SQLite local fallback"
        if IS_SQLITE
        else f"Neon PostgreSQL{f' [{branch}]' if branch else ''}",
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
