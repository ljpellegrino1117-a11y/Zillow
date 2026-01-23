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

# Optimize SQLite for speed
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging for concurrency
    cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes
    cursor.execute("PRAGMA cache_size=10000")  # Larger cache (10MB)
    cursor.execute("PRAGMA temp_store=MEMORY")  # Store temp tables in memory
    cursor.execute("PRAGMA mmap_size=268435456")  # Memory-mapped I/O (256MB)
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
