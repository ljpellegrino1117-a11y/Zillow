from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class City(Base):
    __tablename__ = "cities"

    id = Column(Integer, primary_key=True, index=True)
    city = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_scraped = Column(DateTime)

    __table_args__ = (
        UniqueConstraint('city', 'state', name='unique_city_state'),
    )

    listings = relationship("ZillowListing", back_populates="city_rel")
    airdna_data = relationship("AirDNAData", back_populates="city_rel")


class ZillowListing(Base):
    __tablename__ = "zillow_listings"

    id = Column(Integer, primary_key=True, index=True)
    zillow_id = Column(String(50), unique=True, index=True)
    city_id = Column(Integer, ForeignKey("cities.id"), nullable=False)
    address = Column(String(255), nullable=False)
    city = Column(String(100))
    state = Column(String(50))
    zip_code = Column(String(10))
    bedrooms = Column(Integer, nullable=False, index=True)
    bathrooms = Column(Float)
    price = Column(Float, nullable=False, index=True)  # Monthly rental price
    description = Column(Text)
    property_type = Column(String(50))
    sqft = Column(Integer)
    url = Column(String(500))
    
    # Amenities - raw from Zillow
    amenities_raw = Column(Text)  # JSON string of all amenities from listing
    
    # Detected amenities (scanned from description + amenities)
    has_pool = Column(Boolean, default=False, index=True)
    has_waterview = Column(Boolean, default=False, index=True)
    has_waterfront = Column(Boolean, default=False, index=True)
    has_basement = Column(Boolean, default=False, index=True)
    has_unfinished_basement = Column(Boolean, default=False, index=True)
    has_finished_basement = Column(Boolean, default=False, index=True)
    has_garage = Column(Boolean, default=False, index=True)
    has_parking = Column(Boolean, default=False, index=True)
    has_laundry = Column(Boolean, default=False, index=True)
    has_ac = Column(Boolean, default=False, index=True)
    has_fireplace = Column(Boolean, default=False, index=True)
    has_yard = Column(Boolean, default=False, index=True)
    has_patio = Column(Boolean, default=False, index=True)
    has_balcony = Column(Boolean, default=False, index=True)
    has_gym = Column(Boolean, default=False, index=True)
    has_pet_friendly = Column(Boolean, default=False, index=True)
    
    scraped_at = Column(DateTime, default=datetime.utcnow)

    city_rel = relationship("City", back_populates="listings")


class AirDNAData(Base):
    __tablename__ = "airdna_data"

    id = Column(Integer, primary_key=True, index=True)
    city_id = Column(Integer, ForeignKey("cities.id"), nullable=False)
    zip_code = Column(String(10), nullable=True, index=True)  # Optional zip code for granular data
    bedrooms = Column(Integer, nullable=False)
    average_annual_revenue = Column(Float, nullable=False)  # Annual revenue from AirDNA
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('city_id', 'zip_code', 'bedrooms', name='unique_city_zip_bedroom'),
    )

    city_rel = relationship("City", back_populates="airdna_data")
