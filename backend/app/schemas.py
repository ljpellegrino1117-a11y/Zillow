from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# City Schemas
class CityBase(BaseModel):
    city: str
    state: str


class CityCreate(CityBase):
    pass


class CityResponse(CityBase):
    id: int
    created_at: datetime
    last_scraped: Optional[datetime] = None

    class Config:
        from_attributes = True


# Amenities Schema
class AmenitiesFilter(BaseModel):
    """Filter for required/optional amenities"""
    has_pool: Optional[bool] = None
    has_waterview: Optional[bool] = None
    has_waterfront: Optional[bool] = None
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
    has_waterview: bool = False
    has_waterfront: bool = False
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
    scraped_at: datetime

    class Config:
        from_attributes = True


# AirDNA Schemas
class AirDNADataBase(BaseModel):
    bedrooms: int
    average_annual_revenue: float


class AirDNADataResponse(AirDNADataBase):
    id: int
    city_id: int
    updated_at: datetime

    class Config:
        from_attributes = True


class AirDNAInput(BaseModel):
    """Input schema for adding AirDNA data for a city"""
    city: str
    state: str
    data: List[AirDNADataBase]


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


class ScrapeRequest(BaseModel):
    city: str
    state: str
    min_bedrooms: int = 3
    max_bedrooms: int = 8


class ScrapeStatus(BaseModel):
    city: str
    state: str
    status: str
    listings_found: int = 0
    message: str = ""
