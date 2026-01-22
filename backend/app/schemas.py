from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ZipCode Schemas
class ZipCodeBase(BaseModel):
    zip_code: str
    city: Optional[str] = None
    state: Optional[str] = None


class ZipCodeCreate(ZipCodeBase):
    pass


class ZipCodeResponse(ZipCodeBase):
    id: int
    created_at: datetime
    last_scraped: Optional[datetime] = None

    class Config:
        from_attributes = True


# Zillow Listing Schemas
class ZillowListingBase(BaseModel):
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    bedrooms: int
    bathrooms: Optional[float] = None
    price: float
    description: Optional[str] = None
    property_type: Optional[str] = None
    sqft: Optional[int] = None
    url: Optional[str] = None


class ZillowListingCreate(ZillowListingBase):
    zillow_id: str
    zip_code_id: int


class ZillowListingResponse(ZillowListingBase):
    id: int
    zillow_id: str
    zip_code_id: int
    scraped_at: datetime

    class Config:
        from_attributes = True


# AirDNA Schemas
class AirDNADataBase(BaseModel):
    bedrooms: int
    average_annual_revenue: float


class AirDNADataCreate(AirDNADataBase):
    zip_code_id: int


class AirDNADataResponse(AirDNADataBase):
    id: int
    zip_code_id: int
    updated_at: datetime

    class Config:
        from_attributes = True


class AirDNAInput(BaseModel):
    """Input schema for adding AirDNA data for a zip code"""
    zip_code: str
    data: List[AirDNADataBase]  # List of bedroom counts with their averages


# Discrepancy Analysis Schemas
class DiscrepancyResult(BaseModel):
    zip_code: str
    city: Optional[str]
    state: Optional[str]
    bedrooms: int
    airdna_annual_revenue: float
    airdna_monthly_revenue: float
    avg_rental_price: float
    bottom_10_avg_rental_price: float
    listing_count: int
    annual_profit_vs_avg: float  # AirDNA revenue - (avg rent * 12)
    annual_profit_vs_bottom: float  # AirDNA revenue - (bottom 10% rent * 12)
    roi_vs_avg: float  # Percentage return
    roi_vs_bottom: float


class ScrapeRequest(BaseModel):
    zip_code: str
    min_bedrooms: int = 3
    max_bedrooms: int = 8


class ScrapeStatus(BaseModel):
    zip_code: str
    status: str
    listings_found: int = 0
    message: str = ""
