from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import datetime
from functools import lru_cache
import asyncio
import logging
import time
import base64
import os

from .database import engine, get_db, Base, DATABASE_URL, is_sqlite
from .models import City, ZillowListing, AirDNAData, AIScreenshotAnalysis, AirbticsMarket
from .schemas import (
    CityCreate, CityResponse,
    ZillowListingResponse,
    AirDNAInput, AirDNADataResponse,
    DiscrepancyResult,
    ScrapeRequest, ScrapeStatus,
    AIScreenshotAnalysisResponse,
    AirbticsSyncRequest, AirbticsSyncStatus, AirbticsCityStatus,
    OpportunitySearchRequest, OpportunitySearchResponse, OpportunityListing
)
from .scraper import scrape_zillow
from . import airbtics
from . import realtor_api
from . import geocoding
import math
import json
from datetime import timedelta

# Create tables
Base.metadata.create_all(bind=engine)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# High-performance in-memory cache with TTL
class SimpleCache:
    def __init__(self, ttl_seconds: int = 30):
        self.cache: Dict[str, Any] = {}
        self.timestamps: Dict[str, float] = {}
        self.ttl = ttl_seconds
        self._lock = asyncio.Lock() if asyncio else None
    
    def get(self, key: str) -> Optional[Any]:
        if key in self.cache:
            if time.time() - self.timestamps[key] < self.ttl:
                return self.cache[key]
            else:
                # Expired - clean up
                self.cache.pop(key, None)
                self.timestamps.pop(key, None)
        return None
    
    def set(self, key: str, value: Any):
        self.cache[key] = value
        self.timestamps[key] = time.time()
        # Limit cache size to prevent memory bloat
        if len(self.cache) > 500:
            self._cleanup_oldest()
    
    def _cleanup_oldest(self):
        """Remove oldest 20% of entries when cache is full"""
        if len(self.cache) > 400:
            sorted_keys = sorted(self.timestamps.keys(), key=lambda k: self.timestamps[k])
            for k in sorted_keys[:100]:
                self.cache.pop(k, None)
                self.timestamps.pop(k, None)
    
    def invalidate(self, pattern: str = None):
        if pattern is None:
            self.cache.clear()
            self.timestamps.clear()
        else:
            keys_to_delete = [k for k in self.cache if pattern in k]
            for k in keys_to_delete:
                self.cache.pop(k, None)
                self.timestamps.pop(k, None)

# Global cache instances with different TTLs
cache = SimpleCache(ttl_seconds=120)  # Cities cache - 2 minutes
listings_cache = SimpleCache(ttl_seconds=60)  # Listings cache - 1 minute (more dynamic)
analysis_cache = SimpleCache(ttl_seconds=180)  # Analysis cache - 3 minutes (expensive queries)

def make_cache_key(*args) -> str:
    """Create a cache key from arguments"""
    return ":".join(str(a) if a is not None else "_" for a in args)

app = FastAPI(
    title="Zillow Arbitrage API",
    description="API for scraping Zillow rentals and analyzing arbitrage opportunities",
    version="2.0.0"
)

# Add GZip compression for responses > 500 bytes
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track scraping jobs
scrape_jobs = {}


# ==================== City Endpoints ====================

@app.get("/api/cities", response_model=List[CityResponse])
def get_cities(db: Session = Depends(get_db)):
    """Get all cities in the database (cached)."""
    cached = cache.get("cities")
    if cached is not None:
        return cached
    
    result = db.query(City).all()
    cache.set("cities", result)
    return result


@app.post("/api/cities", response_model=CityResponse)
def create_city(city_data: CityCreate, db: Session = Depends(get_db)):
    """Add a new city to track."""
    import json
    
    # Check for existing city with same city, state, and zip_code
    query = db.query(City).filter(
        City.city == city_data.city,
        City.state == city_data.state
    )
    if city_data.zip_code:
        query = query.filter(City.zip_code == city_data.zip_code)
    else:
        query = query.filter(City.zip_code.is_(None))
    
    existing = query.first()
    if existing:
        return existing
    
    # Convert property_types list to JSON string for storage
    data = city_data.model_dump()
    if data.get('property_types'):
        data['property_types'] = json.dumps(data['property_types'])
    
    city = City(**data)
    db.add(city)
    db.commit()
    db.refresh(city)
    cache.invalidate("cities")  # Invalidate cache
    return city


@app.delete("/api/cities/{city}/{state}")
def delete_city(city: str, state: str, zip_code: Optional[str] = None, db: Session = Depends(get_db)):
    """Delete a city and all associated data."""
    query = db.query(City).filter(
        City.city == city,
        City.state == state
    )
    if zip_code:
        query = query.filter(City.zip_code == zip_code)
    else:
        query = query.filter(City.zip_code.is_(None))
    
    city_obj = query.first()
    if not city_obj:
        raise HTTPException(status_code=404, detail="City not found")
    
    # Delete associated data
    db.query(ZillowListing).filter(ZillowListing.city_id == city_obj.id).delete()
    db.query(AirDNAData).filter(AirDNAData.city_id == city_obj.id).delete()
    db.delete(city_obj)
    db.commit()
    cache.invalidate()  # Invalidate all caches
    zip_info = f" {zip_code}" if zip_code else ""
    return {"message": f"Deleted {city}, {state}{zip_info} and all associated data"}


# ==================== Scraping Endpoints ====================

async def run_scrape_job(
    city: str, 
    state: str, 
    min_bedrooms: int, 
    max_bedrooms: int, 
    db_session_factory, 
    zip_code: str = None,
    include_surrounding: bool = False,
    surrounding_miles: int = None,
    surrounding_only: bool = False
):
    """Background task to run scraping job."""
    job_key = f"{city}_{state}" + (f"_{zip_code}" if zip_code else "")
    scrape_jobs[job_key] = {"status": "running", "listings_found": 0, "message": "Scraping in progress..."}
    
    try:
        listings = await scrape_zillow(
            city, state, min_bedrooms, max_bedrooms, 
            zip_code=zip_code,
            include_surrounding=include_surrounding,
            surrounding_miles=surrounding_miles,
            surrounding_only=surrounding_only
        )
        
        db = db_session_factory()
        try:
            # Get or create city
            query = db.query(City).filter(
                City.city == city,
                City.state == state
            )
            if zip_code:
                query = query.filter(City.zip_code == zip_code)
            else:
                query = query.filter(City.zip_code.is_(None))
            
            city_obj = query.first()
            if not city_obj:
                city_obj = City(city=city, state=state, zip_code=zip_code)
                db.add(city_obj)
                db.commit()
                db.refresh(city_obj)
            
            # Clear old listings
            db.query(ZillowListing).filter(ZillowListing.city_id == city_obj.id).delete()
            
            # Add new listings
            for listing_data in listings:
                listing = ZillowListing(
                    zillow_id=listing_data['zillow_id'],
                    city_id=city_obj.id,
                    address=listing_data['address'],
                    city=listing_data.get('city'),
                    state=listing_data.get('state'),
                    zip_code=listing_data.get('zip_code'),
                    bedrooms=listing_data['bedrooms'],
                    bathrooms=listing_data.get('bathrooms'),
                    price=listing_data['price'],
                    description=listing_data.get('description'),
                    property_type=listing_data.get('property_type'),
                    sqft=listing_data.get('sqft'),
                    url=listing_data.get('url'),
                    amenities_raw=listing_data.get('amenities_raw'),
                    has_pool=listing_data.get('has_pool', False),
                    has_waterfront=listing_data.get('has_waterfront', False),  # Includes waterfront AND waterview
                    has_basement=listing_data.get('has_basement', False),
                    has_unfinished_basement=listing_data.get('has_unfinished_basement', False),
                    has_finished_basement=listing_data.get('has_finished_basement', False),
                    has_garage=listing_data.get('has_garage', False),
                    has_parking=listing_data.get('has_parking', False),
                    has_laundry=listing_data.get('has_laundry', False),
                    has_ac=listing_data.get('has_ac', False),
                    has_fireplace=listing_data.get('has_fireplace', False),
                    has_yard=listing_data.get('has_yard', False),
                    has_patio=listing_data.get('has_patio', False),
                    has_balcony=listing_data.get('has_balcony', False),
                    has_gym=listing_data.get('has_gym', False),
                    has_pet_friendly=listing_data.get('has_pet_friendly', False),
                    # Extra rooms that could be bedrooms
                    extra_rooms_count=listing_data.get('extra_rooms_count', 0),
                    extra_rooms_details=listing_data.get('extra_rooms_details'),
                    potential_bedrooms=listing_data.get('potential_bedrooms'),
                    has_office=listing_data.get('has_office', False),
                    has_den=listing_data.get('has_den', False),
                    has_bonus_room=listing_data.get('has_bonus_room', False),
                    has_loft=listing_data.get('has_loft', False),
                    has_flex_space=listing_data.get('has_flex_space', False),
                    has_sunroom=listing_data.get('has_sunroom', False),
                    has_media_room=listing_data.get('has_media_room', False),
                    has_game_room=listing_data.get('has_game_room', False),
                    has_guest_room=listing_data.get('has_guest_room', False),
                    has_nursery=listing_data.get('has_nursery', False),
                    has_studio=listing_data.get('has_studio', False),
                    has_attic=listing_data.get('has_attic', False),
                    has_mother_in_law=listing_data.get('has_mother_in_law', False),
                    # Listing type and creative financing
                    listing_type=listing_data.get('listing_type', 'rental'),
                    sale_price=listing_data.get('sale_price'),
                    has_creative_financing=listing_data.get('has_creative_financing', False),
                    financing_keywords=listing_data.get('financing_keywords'),
                )
                db.add(listing)
            
            city_obj.last_scraped = datetime.utcnow()
            db.commit()
            
            # Invalidate caches when new listings are scraped
            listings_cache.invalidate()
            analysis_cache.invalidate()
            
            scrape_jobs[job_key] = {
                "status": "completed",
                "listings_found": len(listings),
                "message": f"Successfully scraped {len(listings)} listings"
            }
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Scraping error for {city}, {state}: {e}")
        scrape_jobs[job_key] = {
            "status": "failed",
            "listings_found": 0,
            "message": str(e)
        }


@app.post("/api/scrape", response_model=ScrapeStatus)
async def start_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Start a scraping job for a city (optionally filtered by zip code or surrounding cities)."""
    from .database import SessionLocal
    
    job_key = f"{request.city}_{request.state}" + (f"_{request.zip_code}" if request.zip_code else "")
    if job_key in scrape_jobs and scrape_jobs[job_key]["status"] == "running":
        return ScrapeStatus(
            city=request.city,
            state=request.state,
            zip_code=request.zip_code,
            status="running",
            message="Scrape already in progress"
        )
    
    # Build message based on options
    if request.surrounding_only and request.surrounding_miles:
        message = f"Starting scrape for surrounding cities within {request.surrounding_miles} miles (excluding {request.city})"
    elif request.include_surrounding and request.surrounding_miles:
        message = f"Starting scrape for {request.city} + surrounding cities within {request.surrounding_miles} miles"
    else:
        message = "Starting scrape..."
    
    background_tasks.add_task(
        run_scrape_job,
        request.city,
        request.state,
        request.min_bedrooms,
        request.max_bedrooms,
        SessionLocal,
        request.zip_code,
        request.include_surrounding,
        request.surrounding_miles,
        request.surrounding_only
    )
    
    scrape_jobs[job_key] = {"status": "running", "listings_found": 0, "message": message}
    
    return ScrapeStatus(
        city=request.city,
        state=request.state,
        zip_code=request.zip_code,
        status="running",
        message=message
    )


@app.get("/api/scrape/{city}/{state}/status", response_model=ScrapeStatus)
def get_scrape_status(city: str, state: str, zip_code: Optional[str] = None):
    """Get the status of a scraping job."""
    job_key = f"{city}_{state}" + (f"_{zip_code}" if zip_code else "")
    if job_key not in scrape_jobs:
        return ScrapeStatus(
            city=city,
            state=state,
            zip_code=zip_code,
            status="not_started",
            message="No scrape job found"
        )
    
    job = scrape_jobs[job_key]
    return ScrapeStatus(
        city=city,
        state=state,
        zip_code=zip_code,
        status=job["status"],
        listings_found=job.get("listings_found", 0),
        message=job.get("message", "")
    )


# ==================== Listings Endpoints ====================

@app.get("/api/listings", response_model=List[ZillowListingResponse])
def get_listings(
    city: Optional[str] = None,
    state: Optional[str] = None,
    bedrooms: Optional[int] = None,
    min_bedrooms: Optional[int] = None,
    max_bedrooms: Optional[int] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    # Listing type filters
    listing_type: Optional[str] = None,  # 'rental', 'for_sale', or None for all
    has_creative_financing: Optional[bool] = None,
    # Amenity filters
    has_pool: Optional[bool] = None,
    has_waterfront: Optional[bool] = None,  # Includes waterfront AND waterview
    has_basement: Optional[bool] = None,
    has_unfinished_basement: Optional[bool] = None,
    has_finished_basement: Optional[bool] = None,
    has_garage: Optional[bool] = None,
    has_parking: Optional[bool] = None,
    has_laundry: Optional[bool] = None,
    has_ac: Optional[bool] = None,
    has_fireplace: Optional[bool] = None,
    has_yard: Optional[bool] = None,
    has_patio: Optional[bool] = None,
    has_balcony: Optional[bool] = None,
    has_gym: Optional[bool] = None,
    has_pet_friendly: Optional[bool] = None,
    # Extra room filters
    has_office: Optional[bool] = None,
    has_den: Optional[bool] = None,
    has_bonus_room: Optional[bool] = None,
    has_loft: Optional[bool] = None,
    has_flex_space: Optional[bool] = None,
    has_sunroom: Optional[bool] = None,
    has_media_room: Optional[bool] = None,
    has_game_room: Optional[bool] = None,
    has_studio: Optional[bool] = None,
    has_attic: Optional[bool] = None,
    has_mother_in_law: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get listings with filters including bedroom count and amenities."""
    query = db.query(ZillowListing)
    
    # City filter
    if city and state:
        city_obj = db.query(City).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            query = query.filter(ZillowListing.city_id == city_obj.id)
        else:
            return []
    
    # Bedroom filters
    if bedrooms is not None:
        query = query.filter(ZillowListing.bedrooms == bedrooms)
    if min_bedrooms is not None:
        query = query.filter(ZillowListing.bedrooms >= min_bedrooms)
    if max_bedrooms is not None:
        query = query.filter(ZillowListing.bedrooms <= max_bedrooms)
    
    # Price filters
    if min_price is not None:
        query = query.filter(ZillowListing.price >= min_price)
    if max_price is not None:
        query = query.filter(ZillowListing.price <= max_price)
    
    # Listing type filters
    if listing_type:
        query = query.filter(ZillowListing.listing_type == listing_type)
    if has_creative_financing is True:
        query = query.filter(ZillowListing.has_creative_financing == True)
    
    # Amenity filters (when True, require the amenity)
    if has_pool is True:
        query = query.filter(ZillowListing.has_pool == True)
    if has_waterfront is True:
        query = query.filter(ZillowListing.has_waterfront == True)
    if has_basement is True:
        query = query.filter(ZillowListing.has_basement == True)
    if has_unfinished_basement is True:
        query = query.filter(ZillowListing.has_unfinished_basement == True)
    if has_finished_basement is True:
        query = query.filter(ZillowListing.has_finished_basement == True)
    if has_garage is True:
        query = query.filter(ZillowListing.has_garage == True)
    if has_parking is True:
        query = query.filter(ZillowListing.has_parking == True)
    if has_laundry is True:
        query = query.filter(ZillowListing.has_laundry == True)
    if has_ac is True:
        query = query.filter(ZillowListing.has_ac == True)
    if has_fireplace is True:
        query = query.filter(ZillowListing.has_fireplace == True)
    if has_yard is True:
        query = query.filter(ZillowListing.has_yard == True)
    if has_patio is True:
        query = query.filter(ZillowListing.has_patio == True)
    if has_balcony is True:
        query = query.filter(ZillowListing.has_balcony == True)
    if has_gym is True:
        query = query.filter(ZillowListing.has_gym == True)
    if has_pet_friendly is True:
        query = query.filter(ZillowListing.has_pet_friendly == True)
    
    # Extra room filters
    if has_office is True:
        query = query.filter(ZillowListing.has_office == True)
    if has_den is True:
        query = query.filter(ZillowListing.has_den == True)
    if has_bonus_room is True:
        query = query.filter(ZillowListing.has_bonus_room == True)
    if has_loft is True:
        query = query.filter(ZillowListing.has_loft == True)
    if has_flex_space is True:
        query = query.filter(ZillowListing.has_flex_space == True)
    if has_sunroom is True:
        query = query.filter(ZillowListing.has_sunroom == True)
    if has_media_room is True:
        query = query.filter(ZillowListing.has_media_room == True)
    if has_game_room is True:
        query = query.filter(ZillowListing.has_game_room == True)
    if has_studio is True:
        query = query.filter(ZillowListing.has_studio == True)
    if has_attic is True:
        query = query.filter(ZillowListing.has_attic == True)
    if has_mother_in_law is True:
        query = query.filter(ZillowListing.has_mother_in_law == True)
    
    return query.order_by(ZillowListing.price).offset(offset).limit(limit).all()


@app.get("/api/listings/stats")
def get_listing_stats(
    city: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get aggregate statistics for listings (cached)."""
    # Check cache first
    cache_key = make_cache_key("stats", city, state)
    cached = listings_cache.get(cache_key)
    if cached is not None:
        return cached
    
    city_id = None
    if city and state:
        city_obj = db.query(City.id).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            city_id = city_obj.id
        else:
            return {"error": "City not found"}
    
    # Build optimized query
    query = db.query(
        ZillowListing.bedrooms,
        func.count(ZillowListing.id).label('count'),
        func.avg(ZillowListing.price).label('avg_price'),
        func.min(ZillowListing.price).label('min_price'),
        func.max(ZillowListing.price).label('max_price')
    )
    
    if city_id:
        query = query.filter(ZillowListing.city_id == city_id)
    
    stats = query.group_by(ZillowListing.bedrooms).all()
    
    result = [
        {
            "bedrooms": s.bedrooms,
            "count": s.count,
            "avg_price": round(s.avg_price, 2) if s.avg_price else None,
            "min_price": s.min_price,
            "max_price": s.max_price,
        }
        for s in stats
    ]
    
    # Cache the result
    listings_cache.set(cache_key, result)
    return result


@app.get("/api/listings/amenity-counts")
def get_amenity_counts(
    city: Optional[str] = None,
    state: Optional[str] = None,
    bedrooms: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get counts of listings with each amenity - OPTIMIZED with single query + caching."""
    # Check cache first
    cache_key = make_cache_key("amenity_counts", city, state, bedrooms)
    cached = listings_cache.get(cache_key)
    if cached is not None:
        return cached
    
    city_id = None
    if city and state:
        city_obj = db.query(City.id).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            city_id = city_obj.id
    
    # Single optimized query using func.sum with case expressions
    from sqlalchemy import case
    
    # Build base filters
    filters = []
    if city_id:
        filters.append(ZillowListing.city_id == city_id)
    if bedrooms is not None:
        filters.append(ZillowListing.bedrooms == bedrooms)
    
    # Single query that counts all amenities at once
    query = db.query(
        func.count(ZillowListing.id).label('total'),
        func.sum(case((ZillowListing.has_pool == True, 1), else_=0)).label('has_pool'),
        func.sum(case((ZillowListing.has_waterfront == True, 1), else_=0)).label('has_waterfront'),
        func.sum(case((ZillowListing.has_basement == True, 1), else_=0)).label('has_basement'),
        func.sum(case((ZillowListing.has_unfinished_basement == True, 1), else_=0)).label('has_unfinished_basement'),
        func.sum(case((ZillowListing.has_finished_basement == True, 1), else_=0)).label('has_finished_basement'),
        func.sum(case((ZillowListing.has_garage == True, 1), else_=0)).label('has_garage'),
        func.sum(case((ZillowListing.has_parking == True, 1), else_=0)).label('has_parking'),
        func.sum(case((ZillowListing.has_laundry == True, 1), else_=0)).label('has_laundry'),
        func.sum(case((ZillowListing.has_ac == True, 1), else_=0)).label('has_ac'),
        func.sum(case((ZillowListing.has_fireplace == True, 1), else_=0)).label('has_fireplace'),
        func.sum(case((ZillowListing.has_yard == True, 1), else_=0)).label('has_yard'),
        func.sum(case((ZillowListing.has_patio == True, 1), else_=0)).label('has_patio'),
        func.sum(case((ZillowListing.has_balcony == True, 1), else_=0)).label('has_balcony'),
        func.sum(case((ZillowListing.has_gym == True, 1), else_=0)).label('has_gym'),
        func.sum(case((ZillowListing.has_pet_friendly == True, 1), else_=0)).label('has_pet_friendly'),
        func.sum(case((ZillowListing.has_office == True, 1), else_=0)).label('has_office'),
        func.sum(case((ZillowListing.has_den == True, 1), else_=0)).label('has_den'),
        func.sum(case((ZillowListing.has_bonus_room == True, 1), else_=0)).label('has_bonus_room'),
        func.sum(case((ZillowListing.has_loft == True, 1), else_=0)).label('has_loft'),
        func.sum(case((ZillowListing.has_flex_space == True, 1), else_=0)).label('has_flex_space'),
        func.sum(case((ZillowListing.has_sunroom == True, 1), else_=0)).label('has_sunroom'),
        func.sum(case((ZillowListing.has_media_room == True, 1), else_=0)).label('has_media_room'),
        func.sum(case((ZillowListing.has_game_room == True, 1), else_=0)).label('has_game_room'),
        func.sum(case((ZillowListing.has_guest_room == True, 1), else_=0)).label('has_guest_room'),
        func.sum(case((ZillowListing.has_nursery == True, 1), else_=0)).label('has_nursery'),
        func.sum(case((ZillowListing.has_studio == True, 1), else_=0)).label('has_studio'),
        func.sum(case((ZillowListing.has_attic == True, 1), else_=0)).label('has_attic'),
        func.sum(case((ZillowListing.has_mother_in_law == True, 1), else_=0)).label('has_mother_in_law'),
    )
    
    if filters:
        query = query.filter(*filters)
    
    row = query.first()
    
    result = {
        "total": row.total or 0,
        "has_pool": row.has_pool or 0,
        "has_waterfront": row.has_waterfront or 0,
        "has_basement": row.has_basement or 0,
        "has_unfinished_basement": row.has_unfinished_basement or 0,
        "has_finished_basement": row.has_finished_basement or 0,
        "has_garage": row.has_garage or 0,
        "has_parking": row.has_parking or 0,
        "has_laundry": row.has_laundry or 0,
        "has_ac": row.has_ac or 0,
        "has_fireplace": row.has_fireplace or 0,
        "has_yard": row.has_yard or 0,
        "has_patio": row.has_patio or 0,
        "has_balcony": row.has_balcony or 0,
        "has_gym": row.has_gym or 0,
        "has_pet_friendly": row.has_pet_friendly or 0,
        "has_office": row.has_office or 0,
        "has_den": row.has_den or 0,
        "has_bonus_room": row.has_bonus_room or 0,
        "has_loft": row.has_loft or 0,
        "has_flex_space": row.has_flex_space or 0,
        "has_sunroom": row.has_sunroom or 0,
        "has_media_room": row.has_media_room or 0,
        "has_game_room": row.has_game_room or 0,
        "has_guest_room": row.has_guest_room or 0,
        "has_nursery": row.has_nursery or 0,
        "has_studio": row.has_studio or 0,
        "has_attic": row.has_attic or 0,
        "has_mother_in_law": row.has_mother_in_law or 0,
    }
    
    # Cache the result
    listings_cache.set(cache_key, result)
    return result


# ==================== AirDNA Endpoints ====================

@app.post("/api/airdna", response_model=AirDNADataResponse)
def save_airdna_data(data: AirDNAInput, db: Session = Depends(get_db)):
    """Save AirDNA data for a city with bedroom range and optional amenities.
    
    Amenities support tri-state values:
    - True = WITH (property must have this amenity)
    - False = WITHOUT (property must NOT have this amenity)
    - None = ANY (no filter, don't care)
    """
    import json
    
    # Get or create city
    city_obj = db.query(City).filter(
        City.city == data.city,
        City.state == data.state
    ).first()
    if not city_obj:
        city_obj = City(city=data.city, state=data.state)
        db.add(city_obj)
        db.commit()
        db.refresh(city_obj)
    
    # Build amenity filter string for matching (includes both WITH and WITHOUT)
    amenity_filter = None
    amenity_fields = {}
    if data.amenities:
        amenities_dict = data.amenities.model_dump()
        # Include amenities that are explicitly set (True OR False, not None)
        set_amenities = {k: v for k, v in amenities_dict.items() if v is not None}
        if set_amenities:
            # Store as JSON with format: {"with": [...], "without": [...]}
            with_amenities = sorted([k for k, v in set_amenities.items() if v is True])
            without_amenities = sorted([k for k, v in set_amenities.items() if v is False])
            amenity_filter = json.dumps({"with": with_amenities, "without": without_amenities})
            amenity_fields = amenities_dict
    
    # Check for existing entry with same city, zip, bedroom range, and amenities
    query = db.query(AirDNAData).filter(
        AirDNAData.city_id == city_obj.id,
        AirDNAData.bedrooms_min == data.bedrooms_min,
        AirDNAData.bedrooms_max == data.bedrooms_max
    )
    if data.zip_code:
        query = query.filter(AirDNAData.zip_code == data.zip_code)
    else:
        query = query.filter(AirDNAData.zip_code.is_(None))
    
    if amenity_filter:
        query = query.filter(AirDNAData.amenity_filter == amenity_filter)
    else:
        query = query.filter(AirDNAData.amenity_filter.is_(None))
    
    existing = query.first()
    
    if existing:
        existing.average_annual_revenue = data.average_annual_revenue
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    else:
        airdna = AirDNAData(
            city_id=city_obj.id,
            zip_code=data.zip_code,
            bedrooms_min=data.bedrooms_min,
            bedrooms_max=data.bedrooms_max,
            average_annual_revenue=data.average_annual_revenue,
            amenity_filter=amenity_filter,
            **amenity_fields
        )
        db.add(airdna)
        db.commit()
        db.refresh(airdna)
        # Invalidate analysis cache when new AirDNA data is added
        analysis_cache.invalidate("discrepancy")
        return airdna


@app.delete("/api/airdna/{airdna_id}")
def delete_airdna_data(airdna_id: int, db: Session = Depends(get_db)):
    """Delete a specific AirDNA data entry."""
    airdna = db.query(AirDNAData).filter(AirDNAData.id == airdna_id).first()
    if not airdna:
        raise HTTPException(status_code=404, detail="AirDNA data not found")
    db.delete(airdna)
    db.commit()
    # Invalidate analysis cache
    analysis_cache.invalidate("discrepancy")
    return {"message": "Deleted successfully"}


@app.get("/api/airdna/{city}/{state}", response_model=List[AirDNADataResponse])
def get_airdna_data(
    city: str, 
    state: str, 
    zip_code: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all AirDNA data entries for a city."""
    city_obj = db.query(City).filter(
        City.city == city,
        City.state == state
    ).first()
    if not city_obj:
        return []
    
    query = db.query(AirDNAData).filter(AirDNAData.city_id == city_obj.id)
    
    if zip_code:
        # Get data for specific zip code
        query = query.filter(AirDNAData.zip_code == zip_code)
    
    return query.all()


@app.get("/api/airdna/{city}/{state}/zip-codes")
def get_airdna_zip_codes(city: str, state: str, db: Session = Depends(get_db)):
    """Get list of zip codes that have AirDNA data for a city."""
    city_obj = db.query(City).filter(
        City.city == city,
        City.state == state
    ).first()
    if not city_obj:
        return []
    
    # Get distinct zip codes (including None for city-wide)
    zip_codes = db.query(AirDNAData.zip_code).filter(
        AirDNAData.city_id == city_obj.id
    ).distinct().all()
    
    return [z[0] for z in zip_codes]


# ==================== Analysis Endpoints ====================

def analyze_opportunity(
    airdna_annual: float,
    bottom_rent: float,
    avg_rent: float,
    listing_count: int,
    bedrooms: int,
    airdna_count: int
) -> dict:
    """
    Generate AI-like analysis of an arbitrage opportunity.
    Returns enhanced metrics and commentary.
    
    UPDATED: Uses realistic STR expense calculations:
    - Variable cleaning based on occupancy and turnovers
    - Higher utilities for STR use ($300-600 base)
    - 10% maintenance rate (STR has higher wear)
    """
    # Default occupancy rate by bedroom (more bedrooms = lower occupancy typically)
    base_occupancy = {1: 0.70, 2: 0.68, 3: 0.65, 4: 0.62, 5: 0.58, 6: 0.55, 7: 0.52, 8: 0.50}
    occupancy_rate = base_occupancy.get(bedrooms, 0.55)
    
    # Calculate adjusted revenue
    adjusted_annual_revenue = airdna_annual * occupancy_rate
    
    # IMPROVED EXPENSE CALCULATIONS
    
    # Variable cleaning: based on turnovers (avg 3.5-night stays)
    avg_stay_length = 3.5
    nights_booked = 365 * occupancy_rate
    turnovers_per_year = nights_booked / avg_stay_length
    cleaning_cost = turnovers_per_year * 150  # $150 per turnover
    
    # Supplies and consumables: ~3% of revenue
    supplies_rate = 0.03
    
    # Platform fees (Airbnb/VRBO): ~15% of revenue
    platform_fee_rate = 0.15
    
    # Utilities: HIGHER for STR ($300-600 base + per bedroom)
    # STRs have higher utility usage due to guest turnover, HVAC, etc.
    utilities_per_year = (300 + bedrooms * 75) * 12
    
    # Insurance: STR insurance
    insurance_per_year = 2000 + (bedrooms * 300)
    
    # Maintenance/repairs: 10% for STR (higher than LTR due to wear)
    maintenance_rate = 0.10
    
    # Management (assume self-managed for now)
    management_rate = 0.0
    
    # Calculate expenses
    variable_expenses = adjusted_annual_revenue * (supplies_rate + platform_fee_rate + maintenance_rate + management_rate)
    fixed_expenses = cleaning_cost + utilities_per_year + insurance_per_year
    total_annual_expenses = variable_expenses + fixed_expenses
    
    # Calculate annual rent cost (using bottom 10% as target)
    annual_rent = bottom_rent * 12
    
    # Net profit calculation
    net_annual_profit = adjusted_annual_revenue - annual_rent - total_annual_expenses
    net_monthly_cashflow = net_annual_profit / 12
    
    # Break-even occupancy calculation
    # Note: Cleaning is variable but estimated based on expected occupancy
    # For break-even, we use the utilities + insurance as truly fixed
    truly_fixed = utilities_per_year + insurance_per_year
    var_rate = supplies_rate + platform_fee_rate + maintenance_rate
    
    # Cleaning cost per night = $150 / avg_stay_length
    cleaning_per_night = 150 / avg_stay_length
    
    # Break-even: revenue * (1 - var_rate) - cleaning_per_night * nights = rent + truly_fixed
    # airdna_annual * occ * (1 - var_rate) - cleaning_per_night * 365 * occ = rent + truly_fixed
    # occ * (airdna_annual * (1 - var_rate) - cleaning_per_night * 365) = rent + truly_fixed
    net_per_unit_occ = airdna_annual * (1 - var_rate) - (cleaning_per_night * 365)
    
    if net_per_unit_occ > 0:
        break_even_occ = (annual_rent + truly_fixed) / net_per_unit_occ
    else:
        break_even_occ = 1.0
    
    # Clamp to reasonable range
    break_even_occ = min(break_even_occ, 1.0)
    
    # Expense ratio
    expense_ratio = total_annual_expenses / adjusted_annual_revenue if adjusted_annual_revenue > 0 else 0
    
    # Data confidence
    if listing_count >= 20 and airdna_count >= 2:
        confidence = "high"
    elif listing_count >= 10 or airdna_count >= 1:
        confidence = "medium"
    else:
        confidence = "low"
    
    # Calculate opportunity score (1-100)
    score = 50  # Base score
    
    # Profitability factors (+/- 20 points)
    profit_margin = net_annual_profit / annual_rent if annual_rent > 0 else 0
    if profit_margin > 0.5:
        score += 20
    elif profit_margin > 0.3:
        score += 15
    elif profit_margin > 0.15:
        score += 10
    elif profit_margin > 0:
        score += 5
    elif profit_margin > -0.1:
        score -= 5
    else:
        score -= 15
    
    # Monthly cashflow factors (+/- 15 points)
    if net_monthly_cashflow > 2000:
        score += 15
    elif net_monthly_cashflow > 1000:
        score += 10
    elif net_monthly_cashflow > 500:
        score += 5
    elif net_monthly_cashflow < 0:
        score -= 10
    
    # Break-even occupancy factors (+/- 10 points)
    if break_even_occ < 0.40:
        score += 10
    elif break_even_occ < 0.50:
        score += 5
    elif break_even_occ > 0.75:
        score -= 10
    elif break_even_occ > 0.65:
        score -= 5
    
    # Data confidence factor (+/- 5 points)
    if confidence == "high":
        score += 5
    elif confidence == "low":
        score -= 5
    
    # Clamp score to 1-100
    score = max(1, min(100, score))
    
    # Generate strengths
    strengths = []
    if net_monthly_cashflow > 2000:
        strengths.append(f"Strong monthly cashflow (${net_monthly_cashflow:,.0f}/mo)")
    elif net_monthly_cashflow > 1000:
        strengths.append(f"Good monthly cashflow (${net_monthly_cashflow:,.0f}/mo)")
    
    if break_even_occ < 0.45:
        strengths.append(f"Low break-even occupancy ({break_even_occ:.0%}) - resilient to market dips")
    elif break_even_occ < 0.55:
        strengths.append(f"Reasonable break-even occupancy ({break_even_occ:.0%})")
    
    if profit_margin > 0.4:
        strengths.append(f"Excellent profit margin ({profit_margin:.0%} of rent)")
    elif profit_margin > 0.25:
        strengths.append(f"Strong profit margin ({profit_margin:.0%} of rent)")
    
    if listing_count >= 15:
        strengths.append(f"Good market data ({listing_count} comparable listings)")
    
    if expense_ratio < 0.35:
        strengths.append("Low operating expense ratio")
    
    airdna_to_rent = airdna_annual / annual_rent if annual_rent > 0 else 0
    if airdna_to_rent > 2.5:
        strengths.append(f"Very high revenue potential ({airdna_to_rent:.1f}x rent)")
    elif airdna_to_rent > 2.0:
        strengths.append(f"High revenue potential ({airdna_to_rent:.1f}x rent)")
    
    # Generate weaknesses
    weaknesses = []
    if net_monthly_cashflow < 0:
        weaknesses.append(f"Negative cashflow (-${abs(net_monthly_cashflow):,.0f}/mo) - not profitable")
    elif net_monthly_cashflow < 500:
        weaknesses.append(f"Thin margins (${net_monthly_cashflow:,.0f}/mo cashflow)")
    
    if break_even_occ > 0.70:
        weaknesses.append(f"High break-even occupancy ({break_even_occ:.0%}) - vulnerable to seasonality")
    elif break_even_occ > 0.60:
        weaknesses.append(f"Moderate break-even risk ({break_even_occ:.0%} occupancy needed)")
    
    if expense_ratio > 0.50:
        weaknesses.append(f"High expense ratio ({expense_ratio:.0%} of revenue)")
    elif expense_ratio > 0.40:
        weaknesses.append(f"Elevated operating costs ({expense_ratio:.0%} of revenue)")
    
    if listing_count < 5:
        weaknesses.append("Limited market data - rent estimates may be unreliable")
    elif listing_count < 10:
        weaknesses.append("Moderate market data - consider more research")
    
    if confidence == "low":
        weaknesses.append("Low data confidence - verify AirDNA revenue estimates")
    
    if bedrooms >= 6:
        weaknesses.append(f"Large property ({bedrooms} BR) - higher maintenance and utility costs")
    
    if occupancy_rate < 0.55:
        weaknesses.append(f"Lower expected occupancy ({occupancy_rate:.0%}) for {bedrooms} BR properties")
    
    # Generate recommendation
    if score >= 75:
        recommendation = f"Strong opportunity with {score}/100 score. Expected ${net_monthly_cashflow:,.0f}/mo cashflow after all expenses. Consider acting quickly on bottom-10% priced listings."
    elif score >= 60:
        recommendation = f"Good opportunity ({score}/100). Expected ${net_monthly_cashflow:,.0f}/mo net cashflow. Viable if you can secure rent near ${bottom_rent:,.0f}/mo."
    elif score >= 45:
        recommendation = f"Moderate opportunity ({score}/100). Margins are tight at ${net_monthly_cashflow:,.0f}/mo. Success depends on operational efficiency and maintaining {occupancy_rate:.0%}+ occupancy."
    elif score >= 30:
        recommendation = f"Marginal opportunity ({score}/100). Consider only if you have cost advantages or local expertise. Break-even requires {break_even_occ:.0%} occupancy."
    else:
        recommendation = f"Not recommended ({score}/100). Numbers don't support profitability at current market rates. Net cashflow is ${net_monthly_cashflow:,.0f}/mo."
    
    return {
        "estimated_occupancy_rate": round(occupancy_rate, 2),
        "adjusted_annual_revenue": round(adjusted_annual_revenue, 2),
        "estimated_annual_expenses": round(total_annual_expenses, 2),
        "net_annual_profit": round(net_annual_profit, 2),
        "net_monthly_cashflow": round(net_monthly_cashflow, 2),
        "break_even_occupancy": round(min(break_even_occ, 1.0), 2),
        "expense_ratio": round(expense_ratio, 2),
        "data_confidence": confidence,
        "opportunity_score": score,
        "strengths": strengths[:4],  # Limit to top 4
        "weaknesses": weaknesses[:4],  # Limit to top 4
        "recommendation": recommendation,
    }


@app.get("/api/analysis/discrepancy", response_model=List[DiscrepancyResult])
def get_discrepancy_analysis(
    city: Optional[str] = None,
    state: Optional[str] = None,
    bedrooms: Optional[int] = None,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    # Amenity filters for analysis
    has_pool: Optional[bool] = None,
    has_waterfront: Optional[bool] = None,  # Includes waterfront AND waterview
    has_basement: Optional[bool] = None,
    has_unfinished_basement: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    Analyze discrepancy between AirDNA revenue and rental prices.
    CACHED for 3 minutes due to expensive computations.
    """
    # Check cache first (this is an expensive endpoint)
    cache_key = make_cache_key("discrepancy", city, state, bedrooms, min_bedrooms, max_bedrooms, has_pool, has_waterfront, has_basement, has_unfinished_basement)
    cached = analysis_cache.get(cache_key)
    if cached is not None:
        return cached
    
    results = []
    
    # Get cities to analyze
    if city and state:
        cities = db.query(City).filter(
            City.city == city,
            City.state == state
        ).all()
    else:
        cities = db.query(City).all()
    
    for city_obj in cities:
        # Get all AirDNA data for this city
        all_airdna = db.query(AirDNAData).filter(AirDNAData.city_id == city_obj.id).all()
        
        if not all_airdna:
            continue
        
        bedroom_range = [bedrooms] if bedrooms else range(min_bedrooms, max_bedrooms + 1)
        
        for br in bedroom_range:
            # Get listings for this bedroom count
            base_query = db.query(ZillowListing).filter(
                ZillowListing.city_id == city_obj.id,
                ZillowListing.bedrooms == br
            )
            
            # Apply amenity filters
            if has_pool is True:
                base_query = base_query.filter(ZillowListing.has_pool == True)
            if has_waterfront is True:
                base_query = base_query.filter(ZillowListing.has_waterfront == True)
            if has_basement is True:
                base_query = base_query.filter(ZillowListing.has_basement == True)
            if has_unfinished_basement is True:
                base_query = base_query.filter(ZillowListing.has_unfinished_basement == True)
            
            listings = base_query.order_by(ZillowListing.price).all()
            
            if not listings:
                continue
            
            # Find matching AirDNA data
            matching_airdna = [
                d for d in all_airdna 
                if d.bedrooms_min <= br <= d.bedrooms_max
            ]
            
            if not matching_airdna:
                continue
            
            # Calculate AirDNA annual revenue
            general_entries = [d for d in matching_airdna if not d.amenity_filter]
            if general_entries:
                airdna_annual = sum(d.average_annual_revenue for d in general_entries) / len(general_entries)
                airdna_count = len(general_entries)
            else:
                airdna_annual = sum(d.average_annual_revenue for d in matching_airdna) / len(matching_airdna)
                airdna_count = len(matching_airdna)
            
            prices = [l.price for l in listings]
            avg_price = sum(prices) / len(prices)
            
            # Bottom 10% average - use math.ceil for true 10%
            # (integer division // would undercount, e.g., 15 listings → 1 instead of 2)
            bottom_count = max(1, math.ceil(len(prices) * 0.1))
            bottom_prices = sorted(prices)[:bottom_count]
            bottom_avg = sum(bottom_prices) / len(bottom_prices)
            
            airdna_monthly = airdna_annual / 12
            
            annual_rent_avg = avg_price * 12
            annual_rent_bottom = bottom_avg * 12
            
            profit_vs_avg = airdna_annual - annual_rent_avg
            profit_vs_bottom = airdna_annual - annual_rent_bottom
            
            roi_vs_avg = (profit_vs_avg / annual_rent_avg * 100) if annual_rent_avg > 0 else 0
            roi_vs_bottom = (profit_vs_bottom / annual_rent_bottom * 100) if annual_rent_bottom > 0 else 0
            
            # Get enhanced analysis with AI commentary
            analysis = analyze_opportunity(
                airdna_annual=airdna_annual,
                bottom_rent=bottom_avg,
                avg_rent=avg_price,
                listing_count=len(listings),
                bedrooms=br,
                airdna_count=airdna_count
            )
            
            results.append(DiscrepancyResult(
                city=city_obj.city,
                state=city_obj.state,
                bedrooms=br,
                airdna_annual_revenue=airdna_annual,
                airdna_monthly_revenue=round(airdna_monthly, 2),
                avg_rental_price=round(avg_price, 2),
                bottom_10_avg_rental_price=round(bottom_avg, 2),
                listing_count=len(listings),
                annual_profit_vs_avg=round(profit_vs_avg, 2),
                annual_profit_vs_bottom=round(profit_vs_bottom, 2),
                roi_vs_avg=round(roi_vs_avg, 2),
                roi_vs_bottom=round(roi_vs_bottom, 2),
                # Enhanced metrics
                estimated_occupancy_rate=analysis["estimated_occupancy_rate"],
                adjusted_annual_revenue=analysis["adjusted_annual_revenue"],
                estimated_annual_expenses=analysis["estimated_annual_expenses"],
                net_annual_profit=analysis["net_annual_profit"],
                net_monthly_cashflow=analysis["net_monthly_cashflow"],
                break_even_occupancy=analysis["break_even_occupancy"],
                expense_ratio=analysis["expense_ratio"],
                data_confidence=analysis["data_confidence"],
                airdna_data_count=airdna_count,
                # AI Commentary
                opportunity_score=analysis["opportunity_score"],
                strengths=analysis["strengths"],
                weaknesses=analysis["weaknesses"],
                recommendation=analysis["recommendation"],
            ))
    
    # Sort by opportunity score (highest first)
    results.sort(key=lambda x: x.opportunity_score, reverse=True)
    
    # Cache the result
    analysis_cache.set(cache_key, results)
    return results


# ==================== AI Screenshot Analysis ====================

# Store conversation history for follow-up questions (in-memory, per-session)
ai_conversations: Dict[str, List[Dict[str, Any]]] = {}

@app.post("/api/ai/analyze-screenshot")
async def analyze_airdna_screenshot(
    image: UploadFile = File(...),
    context: str = Form(""),
    conversation_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Analyze an AirDNA screenshot using AI vision.
    Extracts revenue data and can ask clarifying questions.
    Saves analysis to database for future reference.
    Requires OPENAI_API_KEY environment variable.
    """
    import json
    
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        raise HTTPException(
            status_code=400, 
            detail="OPENAI_API_KEY not configured. Add it to environment variables."
        )
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_key)
    except ImportError:
        raise HTTPException(status_code=500, detail="OpenAI package not installed")
    
    # Read and encode image
    image_content = await image.read()
    base64_image = base64.b64encode(image_content).decode('utf-8')
    
    # Determine image type
    content_type = image.content_type or "image/png"
    if "jpeg" in content_type or "jpg" in content_type:
        media_type = "image/jpeg"
    elif "png" in content_type:
        media_type = "image/png"
    elif "webp" in content_type:
        media_type = "image/webp"
    else:
        media_type = "image/png"
    
    # Initialize or retrieve conversation
    if conversation_id and conversation_id in ai_conversations:
        messages = ai_conversations[conversation_id]
    else:
        conversation_id = f"conv_{int(time.time() * 1000)}"
        messages = [{
            "role": "system",
            "content": """You are an expert at analyzing AirDNA (short-term rental data) screenshots. 
Your job is to:
1. Extract key revenue data from the screenshot (annual revenue, monthly revenue, occupancy rates, ADR, etc.)
2. Identify the location, bedroom count, and any other relevant details
3. Ask clarifying questions if the image is unclear or if you need more context
4. Provide the data in a structured way that can be used for rental arbitrage analysis

When you identify revenue data, always specify:
- Whether it's monthly or annual
- The bedroom count(s) it applies to
- Any amenities or property features mentioned
- The location/market

If you're confident about the data, provide a summary like:
"I found: [X] bedrooms, $[Y] annual revenue ($[Z]/month), [Location]"

After your analysis, ALWAYS end with a structured data block in this exact format:
---EXTRACTED_DATA---
city: [city name or "unknown"]
state: [state abbreviation or "unknown"]
bedrooms: [number or "unknown"]
annual_revenue: [number or "unknown"]
monthly_revenue: [number or "unknown"]
---END_DATA---

If you need clarification, ask specific questions but still provide the data block with what you know."""
        }]
        ai_conversations[conversation_id] = messages
    
    # Build the user message with image and context
    user_content = [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{media_type};base64,{base64_image}"
            }
        }
    ]
    
    if context:
        user_content.insert(0, {
            "type": "text",
            "text": f"User context: {context}\n\nPlease analyze this AirDNA screenshot."
        })
    else:
        user_content.insert(0, {
            "type": "text", 
            "text": "Please analyze this AirDNA screenshot and extract the revenue data."
        })
    
    messages.append({"role": "user", "content": user_content})
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",  # Using GPT-4 Vision
            messages=messages,
            max_tokens=1000
        )
        
        assistant_message = response.choices[0].message.content
        messages.append({"role": "assistant", "content": assistant_message})
        
        # Keep conversation history (limit to last 10 messages to save memory)
        if len(messages) > 12:
            messages = [messages[0]] + messages[-10:]
        ai_conversations[conversation_id] = messages
        
        # Parse extracted data from the response
        extracted_city = None
        extracted_state = None
        extracted_bedrooms = None
        extracted_annual = None
        extracted_monthly = None
        
        if "---EXTRACTED_DATA---" in assistant_message:
            try:
                data_block = assistant_message.split("---EXTRACTED_DATA---")[1].split("---END_DATA---")[0]
                for line in data_block.strip().split('\n'):
                    if ':' in line:
                        key, value = line.split(':', 1)
                        key = key.strip().lower()
                        value = value.strip()
                        if value.lower() != 'unknown':
                            if key == 'city':
                                extracted_city = value
                            elif key == 'state':
                                extracted_state = value
                            elif key == 'bedrooms':
                                try:
                                    extracted_bedrooms = int(value.replace(',', ''))
                                except:
                                    pass
                            elif key == 'annual_revenue':
                                try:
                                    extracted_annual = float(value.replace('$', '').replace(',', ''))
                                except:
                                    pass
                            elif key == 'monthly_revenue':
                                try:
                                    extracted_monthly = float(value.replace('$', '').replace(',', ''))
                                except:
                                    pass
            except Exception as e:
                logger.warning(f"Failed to parse extracted data: {e}")
        
        # Save analysis to database
        analysis = AIScreenshotAnalysis(
            image_data=base64_image,
            image_type=media_type,
            user_context=context if context else None,
            ai_response=assistant_message,
            conversation_history=json.dumps(messages[-6:]) if len(messages) > 1 else None,  # Last 6 messages
            extracted_city=extracted_city,
            extracted_state=extracted_state,
            extracted_bedrooms=extracted_bedrooms,
            extracted_annual_revenue=extracted_annual,
            extracted_monthly_revenue=extracted_monthly
        )
        db.add(analysis)
        db.commit()
        db.refresh(analysis)
        
        # Try to extract structured data from the response
        extracted_data = None
        if "$" in assistant_message or extracted_annual or extracted_monthly:
            extracted_data = {
                "raw_response": assistant_message,
                "needs_clarification": "?" in assistant_message or "unclear" in assistant_message.lower(),
                "city": extracted_city,
                "state": extracted_state,
                "bedrooms": extracted_bedrooms,
                "annual_revenue": extracted_annual,
                "monthly_revenue": extracted_monthly,
                "analysis_id": analysis.id
            }
        
        return {
            "conversation_id": conversation_id,
            "message": assistant_message,
            "extracted_data": extracted_data,
            "analysis_id": analysis.id
        }
        
    except Exception as e:
        logger.error(f"OpenAI API error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@app.post("/api/ai/continue-conversation")
async def continue_ai_conversation(
    conversation_id: str = Form(...),
    message: str = Form(...),
):
    """Continue a conversation with the AI about a previously uploaded screenshot."""
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")
    
    if conversation_id not in ai_conversations:
        raise HTTPException(status_code=404, detail="Conversation not found. Please upload a new screenshot.")
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_key)
    except ImportError:
        raise HTTPException(status_code=500, detail="OpenAI package not installed")
    
    messages = ai_conversations[conversation_id]
    messages.append({"role": "user", "content": message})
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=1000
        )
        
        assistant_message = response.choices[0].message.content
        messages.append({"role": "assistant", "content": assistant_message})
        
        # Limit conversation history
        if len(messages) > 12:
            messages = [messages[0]] + messages[-10:]
        ai_conversations[conversation_id] = messages
        
        return {
            "conversation_id": conversation_id,
            "message": assistant_message
        }
        
    except Exception as e:
        logger.error(f"OpenAI API error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@app.get("/api/ai/saved-analyses", response_model=List[AIScreenshotAnalysisResponse])
def get_saved_ai_analyses(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """Get saved AI screenshot analyses (newest first)"""
    analyses = db.query(AIScreenshotAnalysis)\
        .order_by(AIScreenshotAnalysis.created_at.desc())\
        .limit(limit)\
        .all()
    return analyses


@app.get("/api/ai/analysis/{analysis_id}")
def get_ai_analysis(analysis_id: int, db: Session = Depends(get_db)):
    """Get a specific AI analysis including the image"""
    analysis = db.query(AIScreenshotAnalysis).filter(AIScreenshotAnalysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {
        "id": analysis.id,
        "image_data": analysis.image_data,
        "image_type": analysis.image_type,
        "user_context": analysis.user_context,
        "ai_response": analysis.ai_response,
        "extracted_city": analysis.extracted_city,
        "extracted_state": analysis.extracted_state,
        "extracted_bedrooms": analysis.extracted_bedrooms,
        "extracted_annual_revenue": analysis.extracted_annual_revenue,
        "extracted_monthly_revenue": analysis.extracted_monthly_revenue,
        "created_at": analysis.created_at.isoformat()
    }


# ==================== Airbtics API Integration ====================

@app.post("/api/airbtics/sync")
async def sync_airbtics_data(
    request: AirbticsSyncRequest,
    db: Session = Depends(get_db)
):
    """
    Trigger Airbtics data sync for all cities or specified cities.
    Runs in background and returns immediately.
    """
    # Check if already syncing
    status = airbtics.get_sync_status()
    if status["status"] == "syncing":
        raise HTTPException(
            status_code=409,
            detail="Sync already in progress"
        )
    
    # Run sync in background using asyncio.create_task
    async def run_sync():
        from .database import SessionLocal
        db_session = SessionLocal()
        try:
            logger.info(f"Starting Airbtics sync for city_ids={request.city_ids}, force_refresh={request.force_refresh}")
            await airbtics.sync_all_cities(
                db_session,
                city_ids=request.city_ids,
                force_refresh=request.force_refresh
            )
            # Invalidate caches after sync
            analysis_cache.invalidate()
            listings_cache.invalidate()
            logger.info("Airbtics sync completed")
        except Exception as e:
            logger.error(f"Airbtics sync error: {e}")
        finally:
            db_session.close()
    
    # Create the task to run in background
    asyncio.create_task(run_sync())
    
    return {
        "message": "Sync started",
        "city_ids": request.city_ids,
        "force_refresh": request.force_refresh
    }


@app.post("/api/airbtics/sync/{city_id}")
async def sync_airbtics_city(
    city_id: int,
    force_refresh: bool = Query(False),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """Sync Airbtics data for a specific city"""
    city = db.query(City).filter(City.id == city_id).first()
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    
    # Run sync directly (single city is fast enough)
    result = await airbtics.sync_city_data(db, city, force_refresh)
    
    # Invalidate caches
    analysis_cache.invalidate()
    listings_cache.invalidate()
    
    return result


@app.get("/api/airbtics/status", response_model=AirbticsSyncStatus)
def get_airbtics_sync_status():
    """Get current Airbtics sync status"""
    status = airbtics.get_sync_status()
    return AirbticsSyncStatus(
        status=status["status"],
        total_cities=status["total_cities"],
        synced_cities=status["synced_cities"],
        failed_cities=status["failed_cities"],
        current_city=status["current_city"],
        last_sync=status["last_sync"],
        message=status["message"],
        errors=status["errors"][:10]  # Limit errors returned
    )


@app.get("/api/airbtics/cities", response_model=List[AirbticsCityStatus])
def get_airbtics_city_statuses(db: Session = Depends(get_db)):
    """Get Airbtics data status for all cities"""
    cities = db.query(City).all()
    result = []
    
    cutoff_date = datetime.utcnow() - timedelta(days=airbtics.REFRESH_INTERVAL_DAYS)
    
    for city in cities:
        # Get Airbtics data for this city
        airbtics_entries = db.query(AirDNAData).filter(
            AirDNAData.city_id == city.id,
            AirDNAData.source == 'airbtics'
        ).all()
        
        has_data = len(airbtics_entries) > 0
        market_id = airbtics_entries[0].airbtics_market_id if airbtics_entries else None
        last_fetch = max((e.last_api_fetch for e in airbtics_entries if e.last_api_fetch), default=None)
        needs_refresh = not has_data or (last_fetch and last_fetch < cutoff_date)
        
        result.append(AirbticsCityStatus(
            city_id=city.id,
            city=city.city,
            state=city.state,
            zip_code=city.zip_code,
            has_airbtics_data=has_data,
            market_id=market_id,
            last_fetch=last_fetch,
            entries_count=len(airbtics_entries),
            needs_refresh=needs_refresh
        ))
    
    return result


@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ==================== Auto-cleanup for old AirDNA data ====================

def cleanup_old_airdna_data():
    """Remove AirDNA data older than 1 year (manual entries only - Airbtics refreshes)"""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        one_year_ago = datetime.utcnow() - timedelta(days=365)
        # Only delete manual entries older than 1 year
        # Airbtics entries are refreshed every 6 months
        deleted = db.query(AirDNAData).filter(
            AirDNAData.created_at < one_year_ago,
            AirDNAData.source == 'manual'
        ).delete()
        db.commit()
        if deleted > 0:
            logger.info(f"Cleaned up {deleted} manual AirDNA entries older than 1 year")
    except Exception as e:
        logger.error(f"Error cleaning up old AirDNA data: {e}")
        db.rollback()
    finally:
        db.close()


# ==================== Opportunity Finder ====================

def calculate_opportunity_metrics(
    listing: Dict[str, Any],
    revenue_data: Dict[str, Any],
    bedrooms: int
) -> Dict[str, Any]:
    """
    Calculate profitability metrics for a listing opportunity.
    
    Uses improved expense calculations:
    - Variable cleaning based on occupancy
    - Realistic utilities for STR
    - 10% maintenance rate
    """
    monthly_rent = listing.get("price", 0)
    annual_rent = monthly_rent * 12
    
    # Get revenue estimate (use p50 as default, fall back to average)
    annual_revenue = revenue_data.get("revenue_p50") or revenue_data.get("average_annual_revenue", 0)
    
    # Occupancy rates by bedroom (conservative estimates)
    occupancy_rates = {1: 0.70, 2: 0.68, 3: 0.65, 4: 0.62, 5: 0.58, 6: 0.55, 7: 0.52, 8: 0.50}
    occupancy_rate = occupancy_rates.get(bedrooms, 0.55)
    
    # Adjusted revenue
    adjusted_revenue = annual_revenue * occupancy_rate
    
    # IMPROVED EXPENSE CALCULATIONS
    
    # Variable cleaning: based on turnovers (avg 3-night stays)
    avg_stay_length = 3.5
    turnovers_per_year = (365 * occupancy_rate) / avg_stay_length
    cleaning_cost = turnovers_per_year * 150  # $150 per turnover
    
    # Utilities: Higher for STR ($300-600 base + per bedroom)
    utilities_per_year = (300 + bedrooms * 75) * 12
    
    # Platform fees: 15% of revenue
    platform_fees = adjusted_revenue * 0.15
    
    # Supplies: 3% of revenue
    supplies = adjusted_revenue * 0.03
    
    # Maintenance: 10% for STR (higher than LTR due to wear)
    maintenance = adjusted_revenue * 0.10
    
    # Insurance: STR insurance
    insurance = 2000 + (bedrooms * 300)
    
    # Total expenses
    total_expenses = cleaning_cost + utilities_per_year + platform_fees + supplies + maintenance + insurance
    
    # Net profit
    net_profit = adjusted_revenue - annual_rent - total_expenses
    monthly_cashflow = net_profit / 12
    
    # Break-even occupancy
    fixed_costs = annual_rent + utilities_per_year + insurance
    variable_rate = 0.15 + 0.03 + 0.10  # platform + supplies + maintenance
    if annual_revenue * (1 - variable_rate) > 0:
        break_even_occ = (fixed_costs + (turnovers_per_year * 150)) / (annual_revenue * (1 - variable_rate))
    else:
        break_even_occ = 1.0
    break_even_occ = min(break_even_occ, 1.0)
    
    # ROI Score (1-100)
    score = 50
    profit_margin = net_profit / annual_rent if annual_rent > 0 else 0
    
    if profit_margin > 0.5:
        score += 25
    elif profit_margin > 0.3:
        score += 15
    elif profit_margin > 0.15:
        score += 10
    elif profit_margin > 0:
        score += 5
    elif profit_margin > -0.1:
        score -= 5
    else:
        score -= 15
    
    if monthly_cashflow > 2000:
        score += 15
    elif monthly_cashflow > 1000:
        score += 10
    elif monthly_cashflow > 500:
        score += 5
    elif monthly_cashflow < 0:
        score -= 10
    
    if break_even_occ < 0.40:
        score += 10
    elif break_even_occ < 0.50:
        score += 5
    elif break_even_occ > 0.75:
        score -= 10
    
    score = max(1, min(100, score))
    
    # Strengths and weaknesses
    strengths = []
    weaknesses = []
    
    if monthly_cashflow > 2000:
        strengths.append(f"Strong cashflow: ${monthly_cashflow:,.0f}/mo")
    elif monthly_cashflow > 1000:
        strengths.append(f"Good cashflow: ${monthly_cashflow:,.0f}/mo")
    
    if break_even_occ < 0.45:
        strengths.append(f"Low break-even: {break_even_occ:.0%} occupancy")
    
    revenue_to_rent = annual_revenue / annual_rent if annual_rent > 0 else 0
    if revenue_to_rent > 2.5:
        strengths.append(f"High revenue potential: {revenue_to_rent:.1f}x rent")
    elif revenue_to_rent > 2.0:
        strengths.append(f"Good revenue ratio: {revenue_to_rent:.1f}x rent")
    
    if monthly_cashflow < 0:
        weaknesses.append(f"Negative cashflow: -${abs(monthly_cashflow):,.0f}/mo")
    elif monthly_cashflow < 500:
        weaknesses.append(f"Thin margins: ${monthly_cashflow:,.0f}/mo")
    
    if break_even_occ > 0.70:
        weaknesses.append(f"High break-even: {break_even_occ:.0%} needed")
    
    if bedrooms >= 6:
        weaknesses.append(f"Large property ({bedrooms}BR): Higher costs")
    
    return {
        "annual_rent": annual_rent,
        "estimated_annual_revenue": annual_revenue,
        "adjusted_revenue": adjusted_revenue,
        "occupancy_rate": occupancy_rate,
        "estimated_expenses": round(total_expenses, 2),
        "estimated_profit": round(net_profit, 2),
        "monthly_cashflow": round(monthly_cashflow, 2),
        "break_even_occupancy": round(break_even_occ, 3),
        "roi_score": score,
        "strengths": strengths[:3],
        "weaknesses": weaknesses[:3],
    }


@app.post("/api/opportunities/find", response_model=OpportunitySearchResponse)
async def find_opportunities(
    request: OpportunitySearchRequest,
    db: Session = Depends(get_db)
):
    """
    Find arbitrage opportunities by comparing rental listings with STR revenue data.
    
    Supports 4 search modes:
    - "nationwide": Search all cities with Airbtics data
    - "cities": Search specific cities
    - "city_radius": Search a city + surrounding X miles
    - "zip_code": Search by zip codes
    """
    opportunities = []
    warnings = []
    listings_analyzed = 0
    revenue_sources = {"airbtics": 0, "manual": 0, "estimated": 0}
    cities_to_search = []
    zip_codes_to_search = []
    
    # Determine cities to search based on mode
    search_mode = request.search_mode or "cities"
    
    if search_mode == "nationwide":
        # Get all cities that have Airbtics data
        cities_with_data = db.query(City).join(AirDNAData).distinct().all()
        for city in cities_with_data:
            cities_to_search.append((city.city, city.state))
        
        if not cities_to_search:
            warnings.append("No cities with Airbtics data found. Run Airbtics sync first.")
    
    elif search_mode == "city_radius":
        # Search city + surrounding area
        if not request.city:
            raise HTTPException(status_code=400, detail="City is required for city_radius mode")
        
        parts = request.city.split(",")
        if len(parts) < 2:
            raise HTTPException(status_code=400, detail="City must be in format 'City, ST'")
        
        center_city = parts[0].strip()
        state_code = parts[1].strip()
        radius = request.radius_miles or 25
        
        try:
            # Get nearby cities using geocoding
            nearby = await geocoding.get_nearby_cities(
                city=center_city,
                state=state_code,
                radius_miles=radius,
                exclude_center=not request.include_center_city
            )
            
            for place in nearby:
                cities_to_search.append((place["city"], place["state"]))
            
            if not cities_to_search:
                warnings.append(f"No cities found within {radius} miles of {center_city}, {state_code}")
                # Fallback to just the center city
                if request.include_center_city:
                    cities_to_search.append((center_city, state_code))
        except Exception as e:
            logger.error(f"Geocoding error: {str(e)}")
            warnings.append(f"Geocoding failed: {str(e)}. Searching center city only.")
            if request.include_center_city:
                cities_to_search.append((center_city, state_code))
    
    elif search_mode == "zip_code":
        # Search by zip codes
        if not request.zip_codes or len(request.zip_codes) == 0:
            raise HTTPException(status_code=400, detail="At least one zip code is required for zip_code mode")
        
        zip_codes_to_search = [z.strip() for z in request.zip_codes if z.strip()]
        
        if not zip_codes_to_search:
            raise HTTPException(status_code=400, detail="No valid zip codes provided")
    
    else:  # "cities" mode (default)
        if not request.cities or len(request.cities) == 0:
            raise HTTPException(status_code=400, detail="At least one city is required")
        
        for city_str in request.cities:
            parts = city_str.split(",")
            if len(parts) >= 2:
                city_name = parts[0].strip()
                state_code = parts[1].strip()
                cities_to_search.append((city_name, state_code))
        
        if not cities_to_search:
            raise HTTPException(status_code=400, detail="No valid cities provided")
    
    # Check if Realtor API is configured
    use_realtor_api = realtor_api.is_configured()
    
    # Helper function to analyze listings against revenue data
    async def analyze_listings(listings, revenue_by_bedroom, default_city="", default_state="", revenue_data_lookup=None):
        nonlocal listings_analyzed
        local_opportunities = []
        
        for listing in listings:
            listings_analyzed += 1
            bedrooms = listing.get("bedrooms", 0)
            
            if bedrooms not in revenue_by_bedroom:
                continue
            
            revenue_data = revenue_by_bedroom[bedrooms]
            
            metrics = calculate_opportunity_metrics(
                listing,
                {
                    "average_annual_revenue": revenue_data.average_annual_revenue,
                    "revenue_p50": revenue_data.revenue_p50,
                    "revenue_p25": revenue_data.revenue_p25,
                    "revenue_p75": revenue_data.revenue_p75,
                },
                bedrooms
            )
            
            if metrics["estimated_profit"] < request.min_profit:
                continue
            
            photos = listing.get("photos", [])
            if isinstance(photos, str):
                try:
                    photos = json.loads(photos)
                except:
                    photos = []
            
            opp = OpportunityListing(
                listing_id=listing.get("listing_id") or listing.get("property_id") or 0,
                address=listing.get("address", ""),
                city=listing.get("city", default_city),
                state=listing.get("state", default_state),
                zip_code=listing.get("zip_code"),
                bedrooms=bedrooms,
                bathrooms=listing.get("bathrooms"),
                sqft=listing.get("sqft"),
                monthly_rent=listing.get("price", 0),
                url=listing.get("url"),
                photos=photos[:5] if photos else None,
                agent_name=listing.get("agent_name"),
                agent_phone=listing.get("agent_phone"),
                agent_email=listing.get("agent_email"),
                agent_company=listing.get("agent_company"),
                listing_source=listing.get("listing_source", "realtor"),
                has_pool=listing.get("has_pool", False),
                has_waterfront=listing.get("has_waterfront", False),
                has_garage=listing.get("has_garage", False),
                has_yard=listing.get("has_yard", False),
                estimated_annual_revenue=metrics["estimated_annual_revenue"],
                revenue_source=revenue_data.source or "airbtics",
                revenue_confidence="high" if revenue_data.source == "airbtics" else "medium",
                annual_rent=metrics["annual_rent"],
                estimated_expenses=metrics["estimated_expenses"],
                estimated_profit=metrics["estimated_profit"],
                roi_score=metrics["roi_score"],
                break_even_occupancy=metrics["break_even_occupancy"],
                strengths=metrics["strengths"],
                weaknesses=metrics["weaknesses"],
            )
            
            local_opportunities.append(opp)
        
        return local_opportunities
    
    # Process by zip code if in zip_code mode
    if zip_codes_to_search:
        for zip_code in zip_codes_to_search:
            # Look for revenue data by zip code
            revenue_data_list = db.query(AirDNAData).filter(
                AirDNAData.zip_code == zip_code
            ).all()
            
            # If no zip-specific data, try to find city from existing data
            if not revenue_data_list:
                # Try to get city from any existing listing with this zip
                existing = db.query(ZillowListing).filter(
                    ZillowListing.zip_code == zip_code
                ).first()
                
                if existing and existing.city_id:
                    revenue_data_list = db.query(AirDNAData).filter(
                        AirDNAData.city_id == existing.city_id
                    ).all()
            
            if not revenue_data_list:
                warnings.append(f"No revenue data for zip code {zip_code}")
                continue
            
            # Build revenue lookup
            revenue_by_bedroom = {}
            for rd in revenue_data_list:
                for br in range(rd.bedrooms_min, rd.bedrooms_max + 1):
                    if br not in revenue_by_bedroom:
                        revenue_by_bedroom[br] = rd
                        revenue_sources[rd.source or "manual"] = revenue_sources.get(rd.source or "manual", 0) + 1
            
            # Get listings
            listings = []
            if use_realtor_api:
                try:
                    listings = await realtor_api.search_all_rentals_by_zip(
                        zip_code=zip_code,
                        min_beds=request.min_bedrooms,
                        max_beds=request.max_bedrooms,
                        max_listings=100
                    )
                except Exception as e:
                    logger.error(f"Realtor API error for zip {zip_code}: {str(e)}")
                    warnings.append(f"API error for zip {zip_code}: {str(e)}")
            
            # Fallback to database
            if not listings:
                db_listings = db.query(ZillowListing).filter(
                    ZillowListing.zip_code == zip_code,
                    ZillowListing.bedrooms >= request.min_bedrooms,
                    ZillowListing.bedrooms <= request.max_bedrooms,
                    ZillowListing.listing_type == 'rental'
                ).all()
                
                listings = [{
                    "listing_id": l.id,
                    "address": l.address,
                    "city": l.city,
                    "state": l.state,
                    "zip_code": l.zip_code,
                    "bedrooms": l.bedrooms,
                    "bathrooms": l.bathrooms,
                    "price": l.price,
                    "sqft": l.sqft,
                    "url": l.url,
                    "photos": json.loads(l.photos) if l.photos else [],
                    "agent_name": l.agent_name,
                    "agent_phone": l.agent_phone,
                    "agent_email": l.agent_email,
                    "agent_company": l.agent_company,
                    "listing_source": l.listing_source or "zillow",
                    "has_pool": l.has_pool,
                    "has_waterfront": l.has_waterfront,
                    "has_garage": l.has_garage,
                    "has_yard": l.has_yard,
                } for l in db_listings]
            
            zip_opps = await analyze_listings(listings, revenue_by_bedroom, "", "", None)
            opportunities.extend(zip_opps)
    
    # Process by city
    for city_name, state_code in cities_to_search:
        city_record = db.query(City).filter(
            func.lower(City.city) == city_name.lower(),
            func.lower(City.state) == state_code.lower()
        ).first()
        
        revenue_data_list = []
        if city_record:
            revenue_data_list = db.query(AirDNAData).filter(
                AirDNAData.city_id == city_record.id
            ).all()
        
        if not revenue_data_list:
            from sqlalchemy import and_
            revenue_data_list = db.query(AirDNAData).join(City).filter(
                func.lower(City.city) == city_name.lower(),
                func.lower(City.state) == state_code.lower()
            ).all()
        
        if not revenue_data_list:
            warnings.append(f"No revenue data for {city_name}, {state_code}")
            continue
        
        revenue_by_bedroom = {}
        for rd in revenue_data_list:
            for br in range(rd.bedrooms_min, rd.bedrooms_max + 1):
                if br not in revenue_by_bedroom:
                    revenue_by_bedroom[br] = rd
                    revenue_sources[rd.source or "manual"] = revenue_sources.get(rd.source or "manual", 0) + 1
        
        listings = []
        
        if use_realtor_api:
            try:
                api_listings = await realtor_api.search_all_rentals(
                    city=city_name,
                    state_code=state_code,
                    min_beds=request.min_bedrooms,
                    max_beds=request.max_bedrooms,
                    max_listings=100
                )
                listings = api_listings
            except Exception as e:
                logger.error(f"Realtor API error for {city_name}: {str(e)}")
                warnings.append(f"API error for {city_name}: {str(e)}")
        
        if not listings and city_record:
            db_listings = db.query(ZillowListing).filter(
                ZillowListing.city_id == city_record.id,
                ZillowListing.bedrooms >= request.min_bedrooms,
                ZillowListing.bedrooms <= request.max_bedrooms,
                ZillowListing.listing_type == 'rental'
            ).all()
            
            listings = [{
                "listing_id": l.id,
                "address": l.address,
                "city": l.city or city_name,
                "state": l.state or state_code,
                "zip_code": l.zip_code,
                "bedrooms": l.bedrooms,
                "bathrooms": l.bathrooms,
                "price": l.price,
                "sqft": l.sqft,
                "url": l.url,
                "photos": json.loads(l.photos) if l.photos else [],
                "agent_name": l.agent_name,
                "agent_phone": l.agent_phone,
                "agent_email": l.agent_email,
                "agent_company": l.agent_company,
                "listing_source": l.listing_source or "zillow",
                "has_pool": l.has_pool,
                "has_waterfront": l.has_waterfront,
                "has_garage": l.has_garage,
                "has_yard": l.has_yard,
            } for l in db_listings]
        
        city_opps = await analyze_listings(listings, revenue_by_bedroom, city_name, state_code, None)
        opportunities.extend(city_opps)
    
    # Sort by ROI score (highest first)
    opportunities.sort(key=lambda x: x.roi_score, reverse=True)
    
    # Limit results
    opportunities = opportunities[:request.max_results]
    
    # Generate AI analysis if we have opportunities
    ai_analysis = None
    if opportunities and os.getenv("OPENAI_API_KEY"):
        try:
            from openai import OpenAI
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            
            top_summary = []
            for opp in opportunities[:5]:
                top_summary.append(
                    f"- {opp.address}, {opp.city}: {opp.bedrooms}BR, "
                    f"${opp.monthly_rent}/mo rent, ${opp.estimated_annual_revenue:,.0f}/yr STR revenue, "
                    f"${opp.estimated_profit:,.0f}/yr profit, ROI score {opp.roi_score}/100"
                )
            
            prompt = f"""Analyze these top rental arbitrage opportunities:

{chr(10).join(top_summary)}

Provide a brief (2-3 sentences) actionable summary:
1. Which opportunity is best and why
2. Key risk to watch out for
3. Recommended next step"""

            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a real estate investment advisor. Be concise and actionable."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=200,
                temperature=0.7,
            )
            ai_analysis = response.choices[0].message.content
        except Exception as e:
            logger.error(f"AI analysis error: {str(e)}")
    
    # Build search criteria response
    search_criteria_cities = request.cities or []
    if search_mode == "city_radius" and request.city:
        search_criteria_cities = [request.city]
    elif search_mode == "nationwide":
        search_criteria_cities = [f"{c[0]}, {c[1]}" for c in cities_to_search[:10]]  # First 10
    elif search_mode == "zip_code":
        search_criteria_cities = request.zip_codes or []
    
    return OpportunitySearchResponse(
        opportunities=opportunities,
        total_found=len(opportunities),
        markets_searched=len(cities_to_search) + len(zip_codes_to_search),
        ai_analysis=ai_analysis,
        search_criteria={
            "cities": search_criteria_cities,
            "min_bedrooms": request.min_bedrooms,
            "max_bedrooms": request.max_bedrooms,
            "min_profit": request.min_profit,
        },
        generated_at=datetime.now(),
        listings_analyzed=listings_analyzed,
        revenue_data_sources=revenue_sources,
        warnings=warnings,
    )


@app.get("/api/opportunities/api-status")
async def get_realtor_api_status():
    """Check if Realtor.com API is configured and working"""
    return await realtor_api.test_connection()


# ==================== API Testing & Data Verification ====================

@app.get("/api/airbtics/data-status")
async def get_airbtics_data_status(db: Session = Depends(get_db)):
    """
    Get comprehensive status of Airbtics data in the database.
    Returns markets available for nationwide search and data freshness info.
    """
    from datetime import datetime, timedelta
    
    # Get all Airbtics data entries
    all_data = db.query(AirDNAData).filter(
        AirDNAData.source == 'airbtics'
    ).all()
    
    # Get unique cities with Airbtics data
    cities_with_data = db.query(City).join(AirDNAData).filter(
        AirDNAData.source == 'airbtics'
    ).distinct().all()
    
    # Calculate data freshness
    six_months_ago = datetime.utcnow() - timedelta(days=180)
    fresh_count = 0
    stale_count = 0
    
    for entry in all_data:
        if entry.last_api_fetch and entry.last_api_fetch > six_months_ago:
            fresh_count += 1
        else:
            stale_count += 1
    
    # Group by city for detailed breakdown
    markets = []
    for city in cities_with_data:
        city_data = db.query(AirDNAData).filter(
            AirDNAData.city_id == city.id,
            AirDNAData.source == 'airbtics'
        ).all()
        
        bedroom_ranges = set()
        latest_fetch = None
        for d in city_data:
            bedroom_ranges.add(f"{d.bedrooms_min}-{d.bedrooms_max}")
            if d.last_api_fetch:
                if not latest_fetch or d.last_api_fetch > latest_fetch:
                    latest_fetch = d.last_api_fetch
        
        is_fresh = latest_fetch and latest_fetch > six_months_ago if latest_fetch else False
        
        markets.append({
            "city": city.city,
            "state": city.state,
            "entries_count": len(city_data),
            "bedroom_ranges": list(bedroom_ranges),
            "last_fetch": latest_fetch.isoformat() if latest_fetch else None,
            "is_fresh": is_fresh,
            "needs_refresh": not is_fresh
        })
    
    # Sort markets by city name
    markets.sort(key=lambda x: x["city"])
    
    return {
        "status": "ok",
        "total_entries": len(all_data),
        "total_markets": len(cities_with_data),
        "fresh_entries": fresh_count,
        "stale_entries": stale_count,
        "data_freshness_ratio": round(fresh_count / len(all_data), 2) if all_data else 0,
        "markets": markets,
        "database_type": "PostgreSQL" if not is_sqlite else "SQLite",
        "available_for_nationwide_search": len(cities_with_data) > 0
    }


@app.get("/api/test/realtor-api")
async def test_realtor_api():
    """Test Realtor.com API connectivity"""
    return await realtor_api.test_connection()


@app.get("/api/test/airbtics-api")
async def test_airbtics_api():
    """Test Airbtics API connectivity"""
    try:
        # Test market search
        result = await airbtics.search_market("Austin", "TX")
        
        if result and result.get("market_id"):
            return {
                "status": "ok",
                "message": "Airbtics API connected successfully",
                "configured": True,
                "test_market": "Austin, TX",
                "market_id": result["market_id"]
            }
        else:
            return {
                "status": "error",
                "message": "Airbtics API returned empty result",
                "configured": bool(os.getenv("AIRBTICS_API_KEY")),
                "result": result
            }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "configured": bool(os.getenv("AIRBTICS_API_KEY"))
        }


@app.get("/api/test/database")
async def test_database(db: Session = Depends(get_db)):
    """Test database connectivity and return stats"""
    try:
        # Count records in each table
        city_count = db.query(City).count()
        listing_count = db.query(ZillowListing).count()
        airdna_count = db.query(AirDNAData).count()
        airbtics_market_count = db.query(AirbticsMarket).count()
        
        # Check for Airbtics data specifically
        airbtics_data_count = db.query(AirDNAData).filter(
            AirDNAData.source == 'airbtics'
        ).count()
        
        return {
            "status": "ok",
            "database_type": "PostgreSQL" if not is_sqlite else "SQLite",
            "database_url_prefix": DATABASE_URL[:30] + "..." if len(DATABASE_URL) > 30 else DATABASE_URL,
            "record_counts": {
                "cities": city_count,
                "listings": listing_count,
                "airdna_revenue_entries": airdna_count,
                "airbtics_revenue_entries": airbtics_data_count,
                "airbtics_market_cache": airbtics_market_count
            },
            "airbtics_data_stored": airbtics_data_count > 0,
            "ready_for_search": airbtics_data_count > 0
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "database_type": "PostgreSQL" if not is_sqlite else "SQLite"
        }


@app.get("/api/test/all")
async def test_all_apis(db: Session = Depends(get_db)):
    """Run all API tests and return combined status"""
    results = {
        "timestamp": datetime.now().isoformat(),
        "tests": {}
    }
    
    # Test Realtor API
    try:
        realtor_result = await realtor_api.test_connection()
        results["tests"]["realtor_api"] = {
            "status": realtor_result.get("status", "unknown"),
            "configured": realtor_result.get("configured", False),
            "message": realtor_result.get("message", "")
        }
    except Exception as e:
        results["tests"]["realtor_api"] = {
            "status": "error",
            "configured": False,
            "message": str(e)
        }
    
    # Test Airbtics API
    try:
        airbtics_result = await test_airbtics_api()
        results["tests"]["airbtics_api"] = airbtics_result
    except Exception as e:
        results["tests"]["airbtics_api"] = {
            "status": "error",
            "configured": False,
            "message": str(e)
        }
    
    # Test Database
    try:
        db_result = await test_database(db)
        results["tests"]["database"] = db_result
    except Exception as e:
        results["tests"]["database"] = {
            "status": "error",
            "message": str(e)
        }
    
    # Overall status
    all_ok = all(
        t.get("status") == "ok" 
        for t in results["tests"].values()
    )
    results["overall_status"] = "ok" if all_ok else "partial" if any(t.get("status") == "ok" for t in results["tests"].values()) else "error"
    
    return results


# ==================== AI Investment Suggestions ====================

@app.post("/api/ai/investment-suggestions")
async def get_investment_suggestions(db: Session = Depends(get_db)):
    """
    Generate AI-powered investment suggestions based on all available data.
    Considers ROI, upcoming events (FIFA 2026), market conditions, and arbitrage potential.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY not configured. Add it to environment variables."
        )
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_key)
    except ImportError:
        raise HTTPException(status_code=500, detail="OpenAI package not installed")
    
    # Gather all data
    cities = db.query(City).all()
    if not cities:
        return {
            "suggestions": "No cities configured yet. Add some cities to analyze investment opportunities.",
            "top_opportunities": [],
            "event_opportunities": [],
            "warnings": ["No data available for analysis"]
        }
    
    # Get all AirDNA data
    airdna_data = db.query(AirDNAData).all()
    
    # Build market summaries
    market_summaries = []
    for city in cities:
        city_airdna = [a for a in airdna_data if a.city.lower() == city.city.lower() and a.state.lower() == city.state.lower()]
        
        if city_airdna:
            revenues = [a.average_annual_revenue for a in city_airdna if a.average_annual_revenue]
            bedrooms = set(a.bedrooms_min for a in city_airdna if a.bedrooms_min)
            sources = set(a.source for a in city_airdna if a.source)
            
            avg_revenue = sum(revenues) / len(revenues) if revenues else 0
            
            market_summaries.append({
                "city": city.city,
                "state": city.state,
                "avg_annual_revenue": round(avg_revenue),
                "data_points": len(city_airdna),
                "bedroom_counts": sorted(list(bedrooms)),
                "data_sources": list(sources),
                "has_pool_data": any(a.has_pool is not None for a in city_airdna),
                "has_waterfront_data": any(a.has_waterfront is not None for a in city_airdna),
            })
    
    # Known upcoming events that affect STR demand
    upcoming_events = """
    MAJOR UPCOMING EVENTS (2026):
    - FIFA World Cup 2026 (June-July 2026): Host cities include:
      * New York/New Jersey, Los Angeles, Dallas, Houston, Atlanta, Miami, 
      * Philadelphia, Seattle, San Francisco, Kansas City, Boston
      * These cities will see MASSIVE demand spikes during the tournament
      * Investment window is NOW - properties need to be acquired and stabilized before June 2026
    
    - Other factors to consider:
      * Major convention cities (Las Vegas, Orlando, San Diego) have year-round demand
      * College towns see seasonal spikes during graduation, football season
      * Beach/resort destinations have summer peaks
      * Ski resort areas have winter peaks
    """
    
    # Build the prompt
    prompt = f"""You are an expert real estate investment analyst specializing in short-term rental (STR) arbitrage.

TODAY'S DATE: January 24, 2026

{upcoming_events}

MARKET DATA FROM USER'S DATABASE:
{json.dumps(market_summaries, indent=2)}

Based on this data, provide investment suggestions with a STRONG focus on ROI and timing. Consider:

1. **FIFA 2026 URGENCY**: The World Cup starts in ~5 months. For host cities in the data, emphasize:
   - Time is running out to acquire and stabilize properties
   - Expected revenue multipliers during the tournament (2-4x normal)
   - Quick ROI potential if acquired NOW

2. **ROI Analysis**: For each promising market:
   - Estimated annual revenue potential
   - Typical rental costs for arbitrage
   - Expected profit margins
   - Time to break even

3. **Risk Assessment**:
   - Which markets have the best data confidence?
   - Where are the highest and lowest risk opportunities?

4. **Actionable Recommendations**:
   - Top 3 markets to prioritize RIGHT NOW
   - Specific bedroom counts that show best margins
   - Any markets to avoid

Format your response as a clear, actionable investment briefing. Be specific with numbers.
Include a "TIME SENSITIVITY" section for FIFA-related opportunities.
Keep the response concise but comprehensive (aim for 400-600 words)."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert real estate investment analyst. Provide clear, data-driven advice focused on ROI and actionable insights. Be direct and specific with recommendations."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=1500,
            temperature=0.7,
        )
        
        suggestions = response.choices[0].message.content
        
        # Extract top opportunities from market data
        top_opportunities = sorted(
            [m for m in market_summaries if m["avg_annual_revenue"] > 0],
            key=lambda x: x["avg_annual_revenue"],
            reverse=True
        )[:5]
        
        # FIFA host cities in our data
        fifa_cities = ["New York", "Los Angeles", "Dallas", "Houston", "Atlanta", "Miami", 
                       "Philadelphia", "Seattle", "San Francisco", "Kansas City", "Boston"]
        event_opportunities = [
            m for m in market_summaries 
            if any(fc.lower() in m["city"].lower() for fc in fifa_cities)
        ]
        
        return {
            "suggestions": suggestions,
            "top_opportunities": top_opportunities,
            "event_opportunities": event_opportunities,
            "generated_at": datetime.now().isoformat(),
            "markets_analyzed": len(market_summaries),
            "total_data_points": len(airdna_data)
        }
        
    except Exception as e:
        logger.error(f"OpenAI API error in investment suggestions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


# ==================== Database Status & Data Migration ====================

@app.get("/api/database/status")
def get_database_status(db: Session = Depends(get_db)):
    """Get database connection status and data summary"""
    # Count records in each table
    city_count = db.query(func.count(City.id)).scalar()
    airdna_count = db.query(func.count(AirDNAData.id)).scalar()
    listing_count = db.query(func.count(ZillowListing.id)).scalar()
    market_count = db.query(func.count(AirbticsMarket.id)).scalar()
    
    # Get cities with Airbtics data (use city_id foreign key)
    cities_with_data = db.query(City).join(
        AirDNAData, 
        City.id == AirDNAData.city_id,
        isouter=False
    ).distinct().count()
    
    # Mask connection string for security
    if "postgresql" in DATABASE_URL.lower():
        db_type = "PostgreSQL"
        # Extract host from URL for display
        import re
        match = re.search(r'@([^:/]+)', DATABASE_URL)
        db_host = match.group(1) if match else "configured"
    else:
        db_type = "SQLite"
        db_host = "local file"
    
    return {
        "database_type": db_type,
        "database_host": db_host,
        "is_production": not is_sqlite,
        "tables": {
            "cities": city_count,
            "airdna_entries": airdna_count,
            "listings": listing_count,
            "airbtics_markets": market_count,
        },
        "data_health": {
            "cities_configured": city_count,
            "cities_with_revenue_data": cities_with_data,
            "total_revenue_entries": airdna_count,
            "data_coverage_percent": round((cities_with_data / city_count * 100) if city_count > 0 else 0, 1)
        },
        "status": "healthy" if airdna_count > 0 else "needs_data"
    }


@app.get("/api/database/export")
def export_database(db: Session = Depends(get_db)):
    """Export all data for migration to another database"""
    import json
    
    # Export cities
    cities = db.query(City).all()
    cities_data = [{
        "city": c.city,
        "state": c.state,
        "zip_code": c.zip_code,
        "include_surrounding": c.include_surrounding,
        "surrounding_miles": c.surrounding_miles,
        "surrounding_only": c.surrounding_only,
        "rent_min": c.rent_min,
        "rent_max": c.rent_max,
        "purchase_price_min": c.purchase_price_min,
        "purchase_price_max": c.purchase_price_max,
        "exclude_hoa": c.exclude_hoa,
        "property_types": c.property_types,
    } for c in cities]
    
    # Export AirDNA data
    airdna = db.query(AirDNAData).all()
    airdna_data = [{
        "city": a.city,
        "state": a.state,
        "zip_code": a.zip_code,
        "bedrooms_min": a.bedrooms_min,
        "bedrooms_max": a.bedrooms_max,
        "average_annual_revenue": a.average_annual_revenue,
        "revenue_p25": a.revenue_p25,
        "revenue_p50": a.revenue_p50,
        "revenue_p75": a.revenue_p75,
        "revenue_p90": a.revenue_p90,
        "source": a.source,
        "airbtics_market_id": a.airbtics_market_id,
        "has_pool": a.has_pool,
        "has_hot_tub": a.has_hot_tub,
        "has_waterfront": a.has_waterfront,
        "has_basement": a.has_basement,
        "has_garage": a.has_garage,
        "has_yard": a.has_yard,
        "has_pet_friendly": a.has_pet_friendly,
        "has_mother_in_law": a.has_mother_in_law,
        "last_api_fetch": a.last_api_fetch.isoformat() if a.last_api_fetch else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in airdna]
    
    # Export Airbtics markets cache
    markets = db.query(AirbticsMarket).all()
    markets_data = [{
        "city": m.city,
        "state": m.state,
        "zip_code": m.zip_code,
        "market_id": m.market_id,
        "market_name": m.market_name,
        "country_code": m.country_code,
    } for m in markets]
    
    return {
        "export_timestamp": datetime.now().isoformat(),
        "cities": cities_data,
        "airdna_data": airdna_data,
        "airbtics_markets": markets_data,
        "summary": {
            "cities_count": len(cities_data),
            "airdna_count": len(airdna_data),
            "markets_count": len(markets_data)
        }
    }


@app.post("/api/database/import")
def import_database(data: dict, db: Session = Depends(get_db)):
    """Import data from export (for migration to new database)"""
    from datetime import datetime
    
    imported = {"cities": 0, "airdna": 0, "markets": 0, "skipped": 0}
    
    # Import cities
    for city_data in data.get("cities", []):
        existing = db.query(City).filter(
            City.city == city_data["city"],
            City.state == city_data["state"]
        ).first()
        
        if not existing:
            city = City(**city_data)
            db.add(city)
            imported["cities"] += 1
        else:
            imported["skipped"] += 1
    
    db.commit()
    
    # Import AirDNA data
    for airdna_item in data.get("airdna_data", []):
        # Check for existing entry
        existing = db.query(AirDNAData).filter(
            AirDNAData.city == airdna_item["city"],
            AirDNAData.state == airdna_item["state"],
            AirDNAData.bedrooms_min == airdna_item.get("bedrooms_min"),
            AirDNAData.bedrooms_max == airdna_item.get("bedrooms_max"),
            AirDNAData.source == airdna_item.get("source", "manual")
        ).first()
        
        if not existing:
            # Parse datetime fields
            if airdna_item.get("last_api_fetch"):
                airdna_item["last_api_fetch"] = datetime.fromisoformat(airdna_item["last_api_fetch"])
            if airdna_item.get("created_at"):
                airdna_item["created_at"] = datetime.fromisoformat(airdna_item["created_at"])
            
            airdna = AirDNAData(**airdna_item)
            db.add(airdna)
            imported["airdna"] += 1
        else:
            imported["skipped"] += 1
    
    db.commit()
    
    # Import Airbtics markets
    for market_data in data.get("airbtics_markets", []):
        existing = db.query(AirbticsMarket).filter(
            AirbticsMarket.city == market_data["city"],
            AirbticsMarket.state == market_data["state"]
        ).first()
        
        if not existing:
            market = AirbticsMarket(**market_data)
            db.add(market)
            imported["markets"] += 1
        else:
            imported["skipped"] += 1
    
    db.commit()
    
    # Invalidate caches
    cache.invalidate()
    listings_cache.invalidate()
    analysis_cache.invalidate()
    
    return {
        "message": "Import completed",
        "imported": imported,
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/database/reset-schema")
def reset_database_schema(confirm: bool = Query(False)):
    """
    Reset database schema by dropping and recreating all tables.
    WARNING: This will delete ALL data.
    
    Pass ?confirm=true to execute.
    """
    if not confirm:
        return {
            "status": "warning",
            "message": "This will DELETE ALL DATA and recreate tables. Pass ?confirm=true to proceed.",
            "action_required": "Add ?confirm=true to the URL"
        }
    
    try:
        # Drop all tables
        Base.metadata.drop_all(bind=engine)
        
        # Recreate all tables with current schema
        Base.metadata.create_all(bind=engine)
        
        return {
            "status": "success",
            "message": "Database schema reset successfully. All tables recreated.",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


@app.on_event("startup")
async def startup_tasks():
    """Run cleanup and Airbtics sync on startup"""
    # Cleanup old manual data
    cleanup_old_airdna_data()
    
    # Start Airbtics sync in background for cities needing refresh
    asyncio.create_task(airbtics.startup_sync())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
