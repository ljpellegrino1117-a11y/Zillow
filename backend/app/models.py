from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class ZipCode(Base):
    __tablename__ = "zip_codes"

    id = Column(Integer, primary_key=True, index=True)
    zip_code = Column(String(10), unique=True, index=True, nullable=False)
    city = Column(String(100))
    state = Column(String(50))
    created_at = Column(DateTime, default=datetime.utcnow)
    last_scraped = Column(DateTime)

    listings = relationship("ZillowListing", back_populates="zip_code_rel")
    airdna_data = relationship("AirDNAData", back_populates="zip_code_rel")


class ZillowListing(Base):
    __tablename__ = "zillow_listings"

    id = Column(Integer, primary_key=True, index=True)
    zillow_id = Column(String(50), unique=True, index=True)
    zip_code_id = Column(Integer, ForeignKey("zip_codes.id"), nullable=False)
    address = Column(String(255), nullable=False)
    city = Column(String(100))
    state = Column(String(50))
    bedrooms = Column(Integer, nullable=False, index=True)
    bathrooms = Column(Float)
    price = Column(Float, nullable=False, index=True)  # Monthly rental price
    description = Column(Text)
    property_type = Column(String(50))
    sqft = Column(Integer)
    url = Column(String(500))
    scraped_at = Column(DateTime, default=datetime.utcnow)

    zip_code_rel = relationship("ZipCode", back_populates="listings")


class AirDNAData(Base):
    __tablename__ = "airdna_data"

    id = Column(Integer, primary_key=True, index=True)
    zip_code_id = Column(Integer, ForeignKey("zip_codes.id"), nullable=False)
    bedrooms = Column(Integer, nullable=False)
    average_annual_revenue = Column(Float, nullable=False)  # Annual revenue from AirDNA
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('zip_code_id', 'bedrooms', name='unique_zip_bedroom'),
    )

    zip_code_rel = relationship("ZipCode", back_populates="airdna_data")
