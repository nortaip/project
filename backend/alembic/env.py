"""Alembic mühiti — DATABASE_URL env-dən, sync psycopg üstündən deyil,
asyncpg DSN-i sync formaya çevirərək işləyir."""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None  # baseline SQL faylı ilə idarə olunur


def _sync_url() -> str:
    url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://ellit:ellit@localhost:5432/ellit")
    return url.replace("postgresql+asyncpg://", "postgresql://")


def run_migrations_offline() -> None:
    context.configure(url=_sync_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_sync_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
