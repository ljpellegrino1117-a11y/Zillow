from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class City(Base):
    __tablename__ = "cities"

    id = Column(Integer, primary_key=True, index=True)
    city = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    zip_code = Column(String(10), nullable=True)  # Optional zip code to narrow search
    # Surrounding cities options
    include_surrounding = Column(Boolean, default=False)  # Include surrounding cities
    surrounding_miles = Column(Integer, nullable=True)  # Radius in miles
    surrounding_only = Column(Boolean, default=False)  # ONLY surrounding, exclude main city
    # Price filters (null means no limit)
    rent_min = Column(Integer, nullable=True)  # Min monthly rent
    rent_max = Column(Integer, nullable=True)  # Max monthly rent
    purchase_price_min = Column(Integer, nullable=True)  # Min purchase price (for creative financing)
    purchase_price_max = Column(Integer, nullable=True)  # Max purchase price
    # HOA filter
    exclude_hoa = Column(Boolean, default=False)  # Exclude listings with HOA
    # Property types filter (JSON array of selected types)
    # Options: house, townhome, multi_family, condo, lot, apartment, manufactured
    property_types = Column(Text, nullable=True)  # JSON array like ["house", "townhome", "condo"]
    created_at = Column(DateTime, default=datetime.utcnow)
    last_scraped = Column(DateTime)

    __table_args__ = (
        UniqueConstraint('city', 'state', 'zip_code', name='unique_city_state_zip'),
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
    has_hot_tub = Column(Boolean, default=False, index=True)
    has_waterfront = Column(Boolean, default=False, index=True)  # Includes waterfront AND waterview
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
    
    # Extra rooms that could be used as bedrooms
    extra_rooms_count = Column(Integer, default=0)  # Number of extra rooms detected
    extra_rooms_details = Column(Text)  # JSON list of detected room types
    potential_bedrooms = Column(Integer)  # bedrooms + extra_rooms_count
    
    # Specific extra room types detected
    has_office = Column(Boolean, default=False)
    has_den = Column(Boolean, default=False)
    has_bonus_room = Column(Boolean, default=False)
    has_loft = Column(Boolean, default=False)
    has_flex_space = Column(Boolean, default=False)
    has_sunroom = Column(Boolean, default=False)
    has_media_room = Column(Boolean, default=False)
    has_game_room = Column(Boolean, default=False)
    has_guest_room = Column(Boolean, default=False)
    has_nursery = Column(Boolean, default=False)
    has_studio = Column(Boolean, default=False)
    has_attic = Column(Boolean, default=False)
    has_mother_in_law = Column(Boolean, default=False)  # Mother-in-law suite/apartment
    
    # Listing type and creative financing (for for-sale listings)
    listing_type = Column(String(20), default='rental', index=True)  # 'rental' or 'for_sale'
    sale_price = Column(Float)  # For for-sale listings
    has_creative_financing = Column(Boolean, default=False, index=True)
    financing_keywords = Column(Text)  # JSON list of matched keywords
    
    scraped_at = Column(DateTime, default=datetime.utcnow)

    city_rel = relationship("City", back_populates="listings")


class AirDNAData(Base):
    __tablename__ = "airdna_data"

    id = Column(Integer, primary_key=True, index=True)
    city_id = Column(Integer, ForeignKey("cities.id"), nullable=False)
    zip_code = Column(String(10), nullable=True, index=True)  # Optional zip code for granular data
    bedrooms_min = Column(Integer, nullable=False)  # Min bedrooms (or exact if max is same)
    bedrooms_max = Column(Integer, nullable=False)  # Max bedrooms (or exact if same as min)
    average_annual_revenue = Column(Float, nullable=False)  # Annual revenue from AirDNA
    
    # Amenity filters - tri-state: True=WITH, False=WITHOUT, None=ANY
    # NOTE: Extra rooms (office, den, loft) are NOT amenity filters - they determine potential bedrooms
    amenity_filter = Column(Text, nullable=True)  # JSON string of amenity requirements
    has_pool = Column(Boolean, nullable=True)  # None = any, True = required, False = excluded
    has_hot_tub = Column(Boolean, nullable=True)
    has_waterfront = Column(Boolean, nullable=True)  # Includes waterfront AND waterview
    has_basement = Column(Boolean, nullable=True)
    has_garage = Column(Boolean, nullable=True)
    has_yard = Column(Boolean, nullable=True)
    has_pet_friendly = Column(Boolean, nullable=True)
    has_mother_in_law = Column(Boolean, nullable=True)  # In-law suite (property feature)
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Note: We use a more flexible approach - no strict unique constraint
    # Multiple entries can exist for same city/bedrooms with different amenities

    city_rel = relationship("City", back_populates="airdna_data")
