"""Application configuration.

All settings are environment-driven so the same image can run locally, in CI,
and inside the nex portal / AWS Lambda.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    app_name: str = "standup"
    environment: str = "local"
    auto_init_db: bool = False

    # --- Database ---------------------------------------------------------
    database_url: str = "sqlite:///./standup.db"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 300

    # --- Authentication ---------------------------------------------------
    # "dev" trusts X-Dev-User; "nex" trusts the SSO headers injected by the nex
    # portal gateway. Never run "dev" in a deployed environment.
    auth_mode: str = "dev"
    dev_default_user_email: str = "manager@nex.local"
    nex_user_header: str = "X-Nex-User-Id"
    nex_email_header: str = "X-Nex-Email"
    nex_name_header: str = "X-Nex-Name"
    nex_roles_header: str = "X-Nex-Roles"

    # --- HTTP -------------------------------------------------------------
    # Comma-separated list; kept as a string so pydantic-settings does not try
    # to JSON-decode it from the environment.
    cors_origins: str = "http://localhost:5173"
    api_prefix: str = "/api/v1"

    # --- AI transcript reconciliation (Phase 4) ---------------------------
    ai_provider: str = "mock"  # mock | bedrock
    ai_processing_inline: bool = True
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_region: str = "us-east-1"
    transcript_bucket: str = ""  # empty -> local filesystem storage
    transcript_local_dir: str = ".transcripts"
    # When AI_PROCESSING_INLINE=false and this is set, uploads are queued for the
    # worker Lambda instead of being processed inside the request.
    sqs_queue_url: str = ""
    max_transcript_bytes: int = 2 * 1024 * 1024

    # --- Product rules ----------------------------------------------------
    # A task due within this many days counts as "upcoming" on the standup board.
    upcoming_due_days: int = 3

    @property
    def cors_origin_list(self) -> list[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
