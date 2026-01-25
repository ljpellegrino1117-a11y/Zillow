from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import json


# City Schemas
class CityBase(BaseModel):
    city: str
    state: str
    zip_code: Optional[str] = None  # Optional zip code to narrow search
    include_surrounding: bool = False  # Include surrounding cities
    surrounding_miles: Optional[int] = None  # Radius in miles
    surrounding_only: bool = False  # ONLY surrounding, exclude main city
    # Price filters (null/None means no limit)
    rent_min: Optional[int] = None  # Min monthly rent
    rent_max: Optional[int] = None  # Max monthly rent
    purchase_price_min: Optional[int] = None  # Min purchase price (for creative financing)
    purchase_price_max: Optional[int] = None  # Max purchase price
    # HOA filter
    exclude_hoa: bool = False  # Exclude listings with HOA
    # Property types filter - list of: house, townhome, multi_family, condo, lot, apartment, manufactured
    property_types: Optional[List[str]] = None  # If None or empty, include all types


class CityCreate(CityBase):
    pass


class CityResponse(CityBase):
    id: int
    created_at: datetime
    last_scraped: Optional[datetime] = None

    @field_validator('property_types', mode='before')
    @classmethod
    def parse_property_types(cls, v):
        """Convert JSON string from database to list"""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return None
        return v

    class Config:
        from_attributes = True


# Amenities Schema
class AmenitiesFilter(BaseModel):
    """Filter for required/optional amenities"""
    has_pool: Optional[bool] = None
    has_waterfront: Optional[bool] = None  # Includes waterfront AND waterview
    has_basement: Optional[bool] = None
    has_unfinished_basement: Optional[bool] = None
    has_finished_basement: Optional[bool] = None
    has_garage: Optional[bool] = None
    has_parking: Optional[bool] = None
    has_laundry: Optional[bool] = None
    has_ac: Optional[bool] = None
    has_fireplace: Optional[bool] = None
    has_yard: Optional[bool] = None
    has_patio: Optional[bool] = None
    has_balcony: Optional[bool] = None
    has_gym: Optional[bool] = None
    has_pet_friendly: Optional[bool] = None


# Zillow Listing Schemas
class ZillowListingBase(BaseModel):
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    bedrooms: int
    bathrooms: Optional[float] = None
    price: float
    description: Optional[str] = None
    property_type: Optional[str] = None
    sqft: Optional[int] = None
    url: Optional[str] = None


class ZillowListingResponse(ZillowListingBase):
    id: int
    zillow_id: str
    city_id: int
    amenities_raw: Optional[str] = None
    has_pool: bool = False
    has_hot_tub: bool = False
    has_waterfront: bool = False  # Includes waterfront AND waterview
    has_basement: bool = False
    has_unfinished_basement: bool = False
    has_finished_basement: bool = False
    has_garage: bool = False
    has_parking: bool = False
    has_laundry: bool = False
    has_ac: bool = False
    has_fireplace: bool = False
    has_yard: bool = False
    has_patio: bool = False
    has_balcony: bool = False
    has_gym: bool = False
    has_pet_friendly: bool = False
    # Extra rooms that could be bedrooms
    extra_rooms_count: int = 0
    extra_rooms_details: Optional[str] = None
    potential_bedrooms: Optional[int] = None
    has_office: bool = False
    has_den: bool = False
    has_bonus_room: bool = False
    has_loft: bool = False
    has_flex_space: bool = False
    has_sunroom: bool = False
    has_media_room: bool = False
    has_game_room: bool = False
    has_guest_room: bool = False
    has_nursery: bool = False
    has_studio: bool = False
    has_attic: bool = False
    has_mother_in_law: bool = False
    # Listing type and creative financing
    listing_type: str = 'rental'
    sale_price: Optional[float] = None
    has_creative_financing: bool = False
    financing_keywords: Optional[str] = None
    # Agent/Contact information
    agent_name: Optional[str] = None
    agent_phone: Optional[str] = None
    agent_email: Optional[str] = None
    agent_company: Optional[str] = None
    listing_source: str = 'zillow'  # 'zillow', 'realtor', 'both', 'manual'
    photos: Optional[str] = None  # JSON array of photo URLs
    # Listing lifecycle tracking
    status: str = 'active'  # 'active', 'rented', 'expired'
    first_seen: Optional[datetime] = None  # When listing was first discovered
    last_seen: Optional[datetime] = None  # Last time listing was seen in API
    scraped_at: datetime
    marked_rented_at: Optional[datetime] = None  # When marked as rented

    class Config:
        from_attributes = True


class ListingsStatsResponse(BaseModel):
    """Statistics about listings in the database"""
    total_listings: int
    active_listings: int
    rented_listings: int
    expired_listings: int
    listings_by_source: dict  # {'zillow': 100, 'realtor': 50}
    oldest_listing_date: Optional[datetime] = None
    newest_listing_date: Optional[datetime] = None
    retention_days: int = 45  # How long listings are kept


# AirDNA Schemas
class AirDNAAmenities(BaseModel):
    """
    Amenity filters for AirDNA data (property features, NOT extra rooms)
    
    Tri-state values:
    - True = WITH (property must have this amenity)
    - False = WITHOUT (property must NOT have this amenity)
    - None = ANY (no filter, don't care)
    """
    has_pool: Optional[bool] = None
    has_hot_tub: Optional[bool] = None
    has_waterfront: Optional[bool] = None  # Includes waterfront AND waterview
    has_basement: Optional[bool] = None
    has_garage: Optional[bool] = None
    has_yard: Optional[bool] = None
    has_pet_friendly: Optional[bool] = None
    has_mother_in_law: Optional[bool] = None  # In-law suite (counts as feature, not bedroom)


class AirDNADataBase(BaseModel):
    bedrooms_min: int
    bedrooms_max: int
    average_annual_revenue: float
    amenities: Optional[AirDNAAmenities] = None


class AirDNADataResponse(BaseModel):
    id: int
    city_id: int
    zip_code: Optional[str] = None
    bedrooms_min: int
    bedrooms_max: int
    average_annual_revenue: float
    # Revenue percentiles (annual values)
    revenue_p25: Optional[float] = None
    revenue_p50: Optional[float] = None
    revenue_p75: Optional[float] = None
    revenue_p90: Optional[float] = None
    # Data source
    source: str = 'manual'  # 'manual', 'airbtics', 'screenshot'
    airbtics_market_id: Optional[str] = None
    last_api_fetch: Optional[datetime] = None
    amenity_filter: Optional[str] = None
    # Tri-state amenities: True = WITH, False = WITHOUT, None = ANY
    has_pool: Optional[bool] = None
    has_hot_tub: Optional[bool] = None
    has_waterfront: Optional[bool] = None  # Includes waterfront AND waterview
    has_basement: Optional[bool] = None
    has_garage: Optional[bool] = None
    has_yard: Optional[bool] = None
    has_pet_friendly: Optional[bool] = None
    has_mother_in_law: Optional[bool] = None
    created_at: Optional[datetime] = None  # For showing data age
    updated_at: datetime

    class Config:
        from_attributes = True


class AirDNAInput(BaseModel):
    """Input schema for adding AirDNA data for a city"""
    city: str
    state: str
    zip_code: Optional[str] = None  # Optional zip code for granular data
    bedrooms_min: int
    bedrooms_max: int
    average_annual_revenue: float
    amenities: Optional[AirDNAAmenities] = None


# Discrepancy Analysis Schemas
class DiscrepancyResult(BaseModel):
    city: str
    state: str
    bedrooms: int
    airdna_annual_revenue: float
    airdna_monthly_revenue: float
    avg_rental_price: float
    bottom_10_avg_rental_price: float
    listing_count: int
    annual_profit_vs_avg: float
    annual_profit_vs_bottom: float
    roi_vs_avg: float
    roi_vs_bottom: float
    # Enhanced profitability metrics
    estimated_occupancy_rate: float = 0.65  # Default 65% occupancy
    adjusted_annual_revenue: float = 0  # Revenue * occupancy rate
    estimated_annual_expenses: float = 0  # Operating costs estimate
    net_annual_profit: float = 0  # Adjusted revenue - rent - expenses
    net_monthly_cashflow: float = 0  # Net profit / 12
    break_even_occupancy: float = 0  # Minimum occupancy to break even
    expense_ratio: float = 0  # Expenses as % of gross revenue
    # Data quality indicators
    data_confidence: str = "low"  # low, medium, high based on listing count
    airdna_data_count: int = 0  # Number of AirDNA entries used
    # AI Analysis
    opportunity_score: int = 0  # 1-100 score
    strengths: List[str] = []  # List of positive factors
    weaknesses: List[str] = []  # List of risk factors
    recommendation: str = ""  # AI-generated recommendation


class ScrapeRequest(BaseModel):
    city: str
    state: str
    zip_code: Optional[str] = None  # Optional zip code to narrow search
    include_surrounding: bool = False  # Include surrounding cities
    surrounding_miles: Optional[int] = None  # Radius in miles
    surrounding_only: bool = False  # ONLY surrounding, exclude main city
    min_bedrooms: int = 3
    max_bedrooms: int = 8


class ScrapeStatus(BaseModel):
    city: str
    state: str
    zip_code: Optional[str] = None
    status: str
    listings_found: int = 0
    message: str = ""


# AI Screenshot Analysis Schemas
class AIScreenshotAnalysisResponse(BaseModel):
    id: int
    image_type: str
    user_context: Optional[str] = None
    ai_response: str
    extracted_city: Optional[str] = None
    extracted_state: Optional[str] = None
    extracted_bedrooms: Optional[int] = None
    extracted_annual_revenue: Optional[float] = None
    extracted_monthly_revenue: Optional[float] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


# Airbtics API Schemas
class AirbticsMarketResponse(BaseModel):
    id: int
    city: str
    state: str
    zip_code: Optional[str] = None
    market_id: str
    market_name: Optional[str] = None
    last_updated: datetime
    
    class Config:
        from_attributes = True


class AirbticsSyncRequest(BaseModel):
    """Request to sync Airbtics data"""
    city_ids: Optional[List[int]] = None  # If None, sync all cities
    force_refresh: bool = False  # Ignore 6-month check


class AirbticsSyncStatus(BaseModel):
    """Status of Airbtics sync operation"""
    status: str  # 'idle', 'syncing', 'completed', 'error'
    total_cities: int = 0
    synced_cities: int = 0
    failed_cities: int = 0
    current_city: Optional[str] = None
    last_sync: Optional[datetime] = None
    message: str = ""
    errors: List[str] = []


class AirbticsCityStatus(BaseModel):
    """Status of Airbtics data for a specific city"""
    city_id: int
    city: str
    state: str
    zip_code: Optional[str] = None
    has_airbtics_data: bool = False
    market_id: Optional[str] = None
    last_fetch: Optional[datetime] = None
    entries_count: int = 0
    needs_refresh: bool = False  # True if >6 months old


# Opportunity Finder Schemas
class OpportunitySearchRequest(BaseModel):
    """Request to find arbitrage opportunities"""
    # Search mode: "nationwide", "cities", "city_radius", "zip_code"
    search_mode: str = "cities"
    
    # For "cities" mode - select specific cities
    cities: Optional[List[str]] = None  # List of "City, ST" strings
    
    # For "city_radius" mode - search city + surrounding area
    city: Optional[str] = None  # Single city e.g., "Austin, TX"
    radius_miles: Optional[int] = None  # Radius in miles
    include_center_city: bool = True  # Include the main city or only surrounding
    
    # For "zip_code" mode - search by zip codes
    zip_codes: Optional[List[str]] = None  # List of zip codes
    
    # Common filters
    min_bedrooms: int = 3
    max_bedrooms: int = 8
    min_profit: float = 0  # Minimum annual profit threshold
    amenities: Optional[List[str]] = None  # Required amenities
    max_results: int = 20  # Max opportunities to return


class OpportunityListing(BaseModel):
    """A rental listing with calculated opportunity metrics"""
    # Listing details
    listing_id: int
    address: str
    city: str
    state: str
    zip_code: Optional[str] = None
    bedrooms: int
    bathrooms: Optional[float] = None
    sqft: Optional[int] = None
    monthly_rent: float
    url: Optional[str] = None
    photos: Optional[List[str]] = None
    
    # Agent contact info
    agent_name: Optional[str] = None
    agent_phone: Optional[str] = None
    agent_email: Optional[str] = None
    agent_company: Optional[str] = None
    listing_source: str = 'realtor'
    
    # Amenities
    has_pool: bool = False
    has_waterfront: bool = False
    has_garage: bool = False
    has_yard: bool = False
    
    # Revenue estimates (from Airbtics)
    estimated_annual_revenue: float  # Occupancy-adjusted realistic estimate
    potential_annual_revenue: Optional[float] = None  # Raw 100% occupancy potential
    occupancy_rate: Optional[float] = None  # Expected occupancy (e.g., 0.58 = 58%)
    revenue_source: str = 'airbtics'  # 'airbtics', 'airdna', 'estimated'
    revenue_confidence: str = 'medium'  # 'low', 'medium', 'high'
    
    # Calculated profitability
    annual_rent: float  # monthly_rent * 12
    estimated_expenses: float  # Annual operating expenses
    estimated_profit: float  # Revenue - rent - expenses
    roi_score: int  # 1-100 opportunity score
    break_even_occupancy: float  # Minimum occupancy to break even
    
    # Risk factors
    strengths: List[str] = []
    weaknesses: List[str] = []


class OpportunitySearchResponse(BaseModel):
    """Response from opportunity search"""
    opportunities: List[OpportunityListing]
    total_found: int
    markets_searched: int
    ai_analysis: Optional[str] = None  # AI-generated summary
    search_criteria: dict
    generated_at: datetime
    
    # Data quality info
    listings_analyzed: int
    revenue_data_sources: dict  # Count by source
    warnings: List[str] = []


# ==================== Event Schemas ====================

class EventCreate(BaseModel):
    """Schema for creating a custom event"""
    name: str
    city: str
    state: str
    start_date: datetime
    end_date: datetime
    event_type: str = 'other'  # sports, conference, festival, holiday, cultural, political, other
    demand_multiplier: float = 1.5
    recurrence: str = 'one_time'  # one_time, annual, varies
    description: Optional[str] = None
    affects_radius_miles: int = 25


class EventResponse(BaseModel):
    """Response schema for an event (curated or custom)"""
    id: Optional[int] = None
    name: str
    city: str
    state: str
    start_date: str  # ISO format
    end_date: str
    event_type: str
    demand_multiplier: float
    recurrence: str
    description: str
    affects_radius_miles: int
    is_custom: bool = False
    days_until: int
    urgency: str  # 'past', 'urgent', 'high', 'medium', 'strategic'

    class Config:
        from_attributes = True


class EventsListResponse(BaseModel):
    """Response for listing all events"""
    events: List[EventResponse]
    total_curated: int
    total_custom: int
    markets_with_events: int


class MarketEventsResponse(BaseModel):
    """Events for a specific market"""
    city: str
    state: str
    events: List[EventResponse]
    total_events: int
    highest_demand_multiplier: float
    nearest_event_days: Optional[int] = None
