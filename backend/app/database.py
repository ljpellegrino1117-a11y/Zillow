from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
import os
import sys
import logging
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Rental data retention period (days)
LISTING_RETENTION_DAYS = 45

# PostgreSQL is REQUIRED for production use
# SQLite is only allowed for development/testing with explicit opt-in
ALLOW_SQLITE = os.getenv("ALLOW_SQLITE", "false").lower() == "true"

if not DATABASE_URL:
    if ALLOW_SQLITE:
        DATABASE_URL = "sqlite:///./zillow_arbitrage.db"
        logger.warning("⚠️  No DATABASE_URL set. Using SQLite for development. Set DATABASE_URL for PostgreSQL in production.")
    else:
        print("\n" + "="*70)
        print("❌ DATABASE_URL environment variable is required!")
        print("="*70)
        print("\nPostgreSQL is required for rental data storage.")
        print("\nSet up PostgreSQL and add to your .env file:")
        print("  DATABASE_URL=postgresql://user:password@localhost:5432/zillow")
        print("\nFor development/testing only, you can enable SQLite:")
        print("  ALLOW_SQLITE=true")
        print("="*70 + "\n")
        sys.exit(1)

# Detect database type
is_sqlite = DATABASE_URL.startswith("sqlite")
is_postgres = DATABASE_URL.startswith("postgresql")

if is_sqlite and not ALLOW_SQLITE:
    print("\n" + "="*70)
    print("❌ SQLite is not allowed in production!")
    print("="*70)
    print("\nRental data requires PostgreSQL for proper 45-day retention.")
    print("\nSet DATABASE_URL to a PostgreSQL connection string:")
    print("  DATABASE_URL=postgresql://user:password@localhost:5432/zillow")
    print("\nFor development only, set ALLOW_SQLITE=true")
    print("="*70 + "\n")
    sys.exit(1)

# Configure engine based on database type
if is_sqlite:
    logger.warning("🔶 Running with SQLite - NOT recommended for production!")
    # SQLite configuration with thread safety and optimizations
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        echo=False,  # Disable SQL logging for speed
    )

    # Optimize SQLite for maximum speed
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # Core optimizations
        cursor.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging for concurrency
        cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes (safe for WAL mode)
        cursor.execute("PRAGMA cache_size=-50000")  # 50MB cache (negative = KB)
        cursor.execute("PRAGMA temp_store=MEMORY")  # Store temp tables in memory
        cursor.execute("PRAGMA mmap_size=536870912")  # Memory-mapped I/O (512MB)
        # Additional performance pragmas
        cursor.execute("PRAGMA page_size=4096")  # Optimal page size
        cursor.execute("PRAGMA busy_timeout=5000")  # 5 second timeout for locks
        cursor.execute("PRAGMA wal_autocheckpoint=1000")  # Checkpoint every 1000 pages
        cursor.execute("PRAGMA read_uncommitted=ON")  # Faster reads (ok for this use case)
        cursor.close()
else:
    # PostgreSQL configuration (recommended for production)
    logger.info("✅ Using PostgreSQL database")
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        echo=False,  # Disable SQL logging for speed
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
