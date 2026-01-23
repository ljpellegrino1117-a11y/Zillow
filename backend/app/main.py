from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
import asyncio
import logging

from .database import engine, get_db, Base
from .models import City, ZillowListing, AirDNAData
from .schemas import (
    CityCreate, CityResponse,
    ZillowListingResponse,
    AirDNAInput, AirDNADataResponse,
    DiscrepancyResult,
    ScrapeRequest, ScrapeStatus
)
from .scraper import scrape_zillow

# Create tables
Base.metadata.create_all(bind=engine)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Zillow Arbitrage API",
    description="API for scraping Zillow rentals and analyzing arbitrage opportunities",
    version="2.0.0"
)

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
    """Get all cities in the database."""
    return db.query(City).all()


@app.post("/api/cities", response_model=CityResponse)
def create_city(city_data: CityCreate, db: Session = Depends(get_db)):
    """Add a new city to track."""
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
    
    city = City(**city_data.model_dump())
    db.add(city)
    db.commit()
    db.refresh(city)
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
                    has_waterview=listing_data.get('has_waterview', False),
                    has_waterfront=listing_data.get('has_waterfront', False),
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
    has_waterview: Optional[bool] = None,
    has_waterfront: Optional[bool] = None,
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
    if has_waterview is True:
        query = query.filter(ZillowListing.has_waterview == True)
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
    """Get aggregate statistics for listings."""
    query = db.query(ZillowListing)
    
    if city and state:
        city_obj = db.query(City).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            query = query.filter(ZillowListing.city_id == city_obj.id)
        else:
            return {"error": "City not found"}
    
    stats = db.query(
        ZillowListing.bedrooms,
        func.count(ZillowListing.id).label('count'),
        func.avg(ZillowListing.price).label('avg_price'),
        func.min(ZillowListing.price).label('min_price'),
        func.max(ZillowListing.price).label('max_price')
    )
    
    if city and state:
        city_obj = db.query(City).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            stats = stats.filter(ZillowListing.city_id == city_obj.id)
    
    stats = stats.group_by(ZillowListing.bedrooms).all()
    
    return [
        {
            "bedrooms": s.bedrooms,
            "count": s.count,
            "avg_price": round(s.avg_price, 2) if s.avg_price else None,
            "min_price": s.min_price,
            "max_price": s.max_price,
        }
        for s in stats
    ]


@app.get("/api/listings/amenity-counts")
def get_amenity_counts(
    city: Optional[str] = None,
    state: Optional[str] = None,
    bedrooms: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get counts of listings with each amenity and extra room type."""
    query = db.query(ZillowListing)
    
    if city and state:
        city_obj = db.query(City).filter(
            City.city == city,
            City.state == state
        ).first()
        if city_obj:
            query = query.filter(ZillowListing.city_id == city_obj.id)
    
    if bedrooms is not None:
        query = query.filter(ZillowListing.bedrooms == bedrooms)
    
    total = query.count()
    
    return {
        "total": total,
        # Amenities
        "has_pool": query.filter(ZillowListing.has_pool == True).count(),
        "has_waterview": query.filter(ZillowListing.has_waterview == True).count(),
        "has_waterfront": query.filter(ZillowListing.has_waterfront == True).count(),
        "has_basement": query.filter(ZillowListing.has_basement == True).count(),
        "has_unfinished_basement": query.filter(ZillowListing.has_unfinished_basement == True).count(),
        "has_finished_basement": query.filter(ZillowListing.has_finished_basement == True).count(),
        "has_garage": query.filter(ZillowListing.has_garage == True).count(),
        "has_parking": query.filter(ZillowListing.has_parking == True).count(),
        "has_laundry": query.filter(ZillowListing.has_laundry == True).count(),
        "has_ac": query.filter(ZillowListing.has_ac == True).count(),
        "has_fireplace": query.filter(ZillowListing.has_fireplace == True).count(),
        "has_yard": query.filter(ZillowListing.has_yard == True).count(),
        "has_patio": query.filter(ZillowListing.has_patio == True).count(),
        "has_balcony": query.filter(ZillowListing.has_balcony == True).count(),
        "has_gym": query.filter(ZillowListing.has_gym == True).count(),
        "has_pet_friendly": query.filter(ZillowListing.has_pet_friendly == True).count(),
        # Extra rooms (potential bedrooms)
        "has_office": query.filter(ZillowListing.has_office == True).count(),
        "has_den": query.filter(ZillowListing.has_den == True).count(),
        "has_bonus_room": query.filter(ZillowListing.has_bonus_room == True).count(),
        "has_loft": query.filter(ZillowListing.has_loft == True).count(),
        "has_flex_space": query.filter(ZillowListing.has_flex_space == True).count(),
        "has_sunroom": query.filter(ZillowListing.has_sunroom == True).count(),
        "has_media_room": query.filter(ZillowListing.has_media_room == True).count(),
        "has_game_room": query.filter(ZillowListing.has_game_room == True).count(),
        "has_guest_room": query.filter(ZillowListing.has_guest_room == True).count(),
        "has_nursery": query.filter(ZillowListing.has_nursery == True).count(),
        "has_studio": query.filter(ZillowListing.has_studio == True).count(),
        "has_attic": query.filter(ZillowListing.has_attic == True).count(),
        "has_mother_in_law": query.filter(ZillowListing.has_mother_in_law == True).count(),
    }


# ==================== AirDNA Endpoints ====================

@app.post("/api/airdna", response_model=List[AirDNADataResponse])
def save_airdna_data(data: AirDNAInput, db: Session = Depends(get_db)):
    """Save AirDNA data for a city, optionally with a specific zip code."""
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
    
    results = []
    for item in data.data:
        # Query includes zip_code (can be None for city-wide data)
        query = db.query(AirDNAData).filter(
            AirDNAData.city_id == city_obj.id,
            AirDNAData.bedrooms == item.bedrooms
        )
        if data.zip_code:
            query = query.filter(AirDNAData.zip_code == data.zip_code)
        else:
            query = query.filter(AirDNAData.zip_code.is_(None))
        
        existing = query.first()
        
        if existing:
            existing.average_annual_revenue = item.average_annual_revenue
            existing.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(existing)
            results.append(existing)
        else:
            airdna = AirDNAData(
                city_id=city_obj.id,
                zip_code=data.zip_code,
                bedrooms=item.bedrooms,
                average_annual_revenue=item.average_annual_revenue
            )
            db.add(airdna)
            db.commit()
            db.refresh(airdna)
            results.append(airdna)
    
    return results


@app.get("/api/airdna/{city}/{state}", response_model=List[AirDNADataResponse])
def get_airdna_data(
    city: str, 
    state: str, 
    zip_code: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get AirDNA data for a city, optionally filtered by zip code."""
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

@app.get("/api/analysis/discrepancy", response_model=List[DiscrepancyResult])
def get_discrepancy_analysis(
    city: Optional[str] = None,
    state: Optional[str] = None,
    bedrooms: Optional[int] = None,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    # Amenity filters for analysis
    has_pool: Optional[bool] = None,
    has_waterview: Optional[bool] = None,
    has_basement: Optional[bool] = None,
    has_unfinished_basement: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    Analyze discrepancy between AirDNA revenue and rental prices.
    Uses zip-code-specific AirDNA data when matching listings exist,
    otherwise falls back to city-wide AirDNA data.
    Can filter by amenities to find specific opportunities.
    """
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
        
        # Separate city-wide and zip-specific data
        city_wide_airdna = {d.bedrooms: d.average_annual_revenue for d in all_airdna if d.zip_code is None}
        zip_airdna = {}  # {zip_code: {bedrooms: revenue}}
        for d in all_airdna:
            if d.zip_code:
                if d.zip_code not in zip_airdna:
                    zip_airdna[d.zip_code] = {}
                zip_airdna[d.zip_code][d.bedrooms] = d.average_annual_revenue
        
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
            if has_waterview is True:
                base_query = base_query.filter(ZillowListing.has_waterview == True)
            if has_basement is True:
                base_query = base_query.filter(ZillowListing.has_basement == True)
            if has_unfinished_basement is True:
                base_query = base_query.filter(ZillowListing.has_unfinished_basement == True)
            
            listings = base_query.order_by(ZillowListing.price).all()
            
            if not listings:
                continue
            
            # Determine which AirDNA data to use
            # Priority: zip-code specific if available, otherwise city-wide
            airdna_annual = None
            
            # Check if we have zip-code specific data that matches listings
            listing_zips = set(l.zip_code for l in listings if l.zip_code)
            for zip_code in listing_zips:
                if zip_code in zip_airdna and br in zip_airdna[zip_code]:
                    # We have zip-specific data - could analyze per-zip
                    # For now, just use city-wide if available
                    pass
            
            # Use city-wide data
            if br in city_wide_airdna:
                airdna_annual = city_wide_airdna[br]
            elif zip_airdna:
                # Fall back to average of zip-specific data
                zip_revenues = [z[br] for z in zip_airdna.values() if br in z]
                if zip_revenues:
                    airdna_annual = sum(zip_revenues) / len(zip_revenues)
            
            if not airdna_annual:
                continue
            
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
            ))
    
    results.sort(key=lambda x: x.annual_profit_vs_bottom, reverse=True)
    return results


@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
