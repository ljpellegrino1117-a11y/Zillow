from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./zillow_arbitrage.db")

# Optimized engine with connection pooling
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

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
