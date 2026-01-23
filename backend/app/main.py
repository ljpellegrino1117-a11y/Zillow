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

from .database import engine, get_db, Base
from .models import City, ZillowListing, AirDNAData, AIScreenshotAnalysis
from .schemas import (
    CityCreate, CityResponse,
    ZillowListingResponse,
    AirDNAInput, AirDNADataResponse,
    DiscrepancyResult,
    ScrapeRequest, ScrapeStatus,
    AIScreenshotAnalysisResponse
)
from .scraper import scrape_zillow
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

@app.post("/api/airdna", response_model=List[AirDNADataResponse])
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


@app.post("/api/airdna", response_model=AirDNADataResponse)
def save_airdna_data_new(data: AirDNAInput, db: Session = Depends(get_db)):
    """Alias for save_airdna_data."""
    return save_airdna_data(data, db)


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
    """
    # Operating cost estimates (industry standards)
    # Cleaning: $100-200 per turnover, assume 3 turnovers/month
    cleaning_per_month = 150 * 3 * 12  # $5,400/year
    # Supplies and consumables: ~3% of revenue
    supplies_rate = 0.03
    # Platform fees (Airbnb/VRBO): ~15% of revenue
    platform_fee_rate = 0.15
    # Utilities estimate: $200-400/month depending on size
    utilities_per_year = (150 + bedrooms * 50) * 12
    # Insurance: ~$1,500-3,000/year for STR
    insurance_per_year = 1500 + (bedrooms * 250)
    # Maintenance/repairs: ~5% of revenue
    maintenance_rate = 0.05
    # Management (if not self-managed): 20-25% of revenue (optional, assume self-managed)
    management_rate = 0.0
    
    # Default occupancy rate by bedroom (more bedrooms = lower occupancy typically)
    base_occupancy = {3: 0.68, 4: 0.65, 5: 0.62, 6: 0.58, 7: 0.55, 8: 0.52}
    occupancy_rate = base_occupancy.get(bedrooms, 0.60)
    
    # Calculate adjusted revenue
    adjusted_annual_revenue = airdna_annual * occupancy_rate
    
    # Calculate expenses
    variable_expenses = adjusted_annual_revenue * (supplies_rate + platform_fee_rate + maintenance_rate + management_rate)
    fixed_expenses = cleaning_per_month + utilities_per_year + insurance_per_year
    total_annual_expenses = variable_expenses + fixed_expenses
    
    # Calculate annual rent cost (using bottom 10% as target)
    annual_rent = bottom_rent * 12
    
    # Net profit calculation
    net_annual_profit = adjusted_annual_revenue - annual_rent - total_annual_expenses
    net_monthly_cashflow = net_annual_profit / 12
    
    # Break-even occupancy calculation
    # Revenue needed = rent + expenses
    # At break-even: airdna_annual * occ_rate * (1 - var_rate) = rent + fixed_expenses
    var_rate = supplies_rate + platform_fee_rate + maintenance_rate
    if airdna_annual * (1 - var_rate) > 0:
        break_even_occ = (annual_rent + fixed_expenses) / (airdna_annual * (1 - var_rate))
    else:
        break_even_occ = 1.0
    
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
            
            # Bottom 10% average
            bottom_count = max(1, len(prices) // 10)
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


@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ==================== Auto-cleanup for old AirDNA data ====================

def cleanup_old_airdna_data():
    """Remove AirDNA data older than 1 year"""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        one_year_ago = datetime.utcnow() - timedelta(days=365)
        deleted = db.query(AirDNAData).filter(AirDNAData.created_at < one_year_ago).delete()
        db.commit()
        if deleted > 0:
            logger.info(f"Cleaned up {deleted} AirDNA entries older than 1 year")
    except Exception as e:
        logger.error(f"Error cleaning up old AirDNA data: {e}")
        db.rollback()
    finally:
        db.close()


@app.on_event("startup")
async def startup_cleanup():
    """Run cleanup on startup"""
    cleanup_old_airdna_data()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
