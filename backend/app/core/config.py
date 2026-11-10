"""Mərkəzi konfiqurasiya — bütün sirlər ENV-dən oxunur, kodda saxlanmır."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ──
    APP_NAME: str = "Ellit API"
    ENV: str = "development"  # development | staging | production
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # ── DB ──
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://ellit:ellit@localhost:5432/ellit",
        description="asyncpg DSN",
    )
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # ── SSH tuneli (PostgreSQL başqa serverdədirsə) ──
    # SSH_HOST boşdursa tunel açılmır, DATABASE_URL birbaşa istifadə olunur.
    # Doludursa: DATABASE_URL-dəki host/port SSH SERVERİNDƏN görünən ünvandır
    # (adətən 127.0.0.1:5432); backend ora SSH üzərindən şifrəli qoşulur və
    # PostgreSQL portu internetə açılmır.
    SSH_HOST: str = ""
    SSH_PORT: int = 22
    SSH_USER: str = ""
    SSH_PASSWORD: str = ""            # açar istifadə olunursa boş qalır
    SSH_KEY_PATH: str = ""            # məs. /etc/ellit/id_ed25519
    SSH_KEY_PASSPHRASE: str = ""
    SSH_KNOWN_HOSTS: str = ""         # boş → ~/.ssh/known_hosts
    SSH_HOST_FINGERPRINT: str = ""    # məs. SHA256:AbC… (known_hosts əvəzi)
    SSH_STRICT_HOST_KEY: bool = True  # False = host açarı yoxlanmır (yalnız test!)
    SSH_LOCAL_PORT: int = 0           # 0 = boş port avtomatik seçilir
    SSH_KEEPALIVE: int = 15           # saniyə
    SSH_CONNECT_TIMEOUT: int = 15

    # ── Redis (rate-limit, pub/sub, refresh-token blacklist) ──
    REDIS_URL: str = "redis://localhost:6379/0"
    CRON_ENABLED: bool = True
    STORAGE_DIR: str = "./storage"
    REDIS_MAX_CONNECTIONS: int = 200   # API əmrləri + WS pubsub bağlantıları

    # ── JWT ──
    JWT_SECRET: str = Field(default="CHANGE_ME_IN_PRODUCTION_64_BYTES_MIN")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 30

    # ── OAuth ──
    GOOGLE_CLIENT_IDS: str = ""  # vergüllə: web,ios,android client id-ləri
    APPLE_BUNDLE_ID: str = "az.ellit.booking"
    APPLE_SERVICE_ID: str = ""   # veb üçün Services ID

    # ── CORS ──
    CORS_ORIGINS: str = "https://ellit.az,http://localhost:5173"

    # ── Rate limit ──
    RATE_LIMIT_DEFAULT: str = "120/minute"
    RATE_LIMIT_AUTH: str = "10/minute"      # login/register brute-force qoruması

    # ── Storage (S3-uyğunlu) ──
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_BUCKET: str = "ellit"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"

    # ── Epoint ödəniş ──
    EPOINT_PUBLIC_KEY: str = ""
    EPOINT_PRIVATE_KEY: str = ""

    # ── FCM ──
    FIREBASE_CREDENTIALS_PATH: str = ""

    # ── E-poçt (parol bərpası kodu) ──
    # SMTP_HOST boşdursa e-poçt göndərilmir (kod yalnız tətbiq bildirişi ilə gedir).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Ellit <no-reply@ellit.az>"
    SMTP_SECURITY: str = "starttls"   # starttls | ssl | none

    # ── Parol bərpası ──
    OTP_TTL_MINUTES: int = 5
    OTP_MAX_PER_HOUR: int = 3
    OTP_MAX_ATTEMPTS: int = 5

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def google_client_ids_list(self) -> list[str]:
        return [c.strip() for c in self.GOOGLE_CLIENT_IDS.split(",") if c.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
