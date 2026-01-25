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

from .database import engine, get_db, Base, DATABASE_URL, is_sqlite, LISTING_RETENTION_DAYS
from .models import City, ZillowListing, AirDNAData, AIScreenshotAnalysis, AirbticsMarket, CustomEvent
from .schemas import (
    CityCreate, CityResponse,
    ZillowListingResponse, ListingsStatsResponse,
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
from . import events as events_module
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

def _create_listing_from_data(listing_data: Dict[str, Any], city_id: int, source: str = 'zillow') -> ZillowListing:
    """Create a ZillowListing object from scraped data."""
    now = datetime.utcnow()
    return ZillowListing(
        zillow_id=listing_data.get('zillow_id') or listing_data.get('property_id') or listing_data.get('listing_id'),
        city_id=city_id,
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
        listing_type=listing_data.get('listing_type', 'rental'),
        sale_price=listing_data.get('sale_price'),
        has_creative_financing=listing_data.get('has_creative_financing', False),
        financing_keywords=listing_data.get('financing_keywords'),
        agent_name=listing_data.get('agent_name'),
        agent_phone=listing_data.get('agent_phone'),
        agent_email=listing_data.get('agent_email'),
        agent_company=listing_data.get('agent_company'),
        listing_source=source,
        photos=json.dumps(listing_data.get('photos', [])) if listing_data.get('photos') else None,
        status='active',
        first_seen=now,
        last_seen=now,
        scraped_at=now,
    )


def _update_listing_from_data(existing: ZillowListing, listing_data: Dict[str, Any]) -> None:
    """Update an existing listing with fresh data (preserves first_seen)."""
    now = datetime.utcnow()
    existing.address = listing_data['address']
    existing.city = listing_data.get('city')
    existing.state = listing_data.get('state')
    existing.zip_code = listing_data.get('zip_code')
    existing.bedrooms = listing_data['bedrooms']
    existing.bathrooms = listing_data.get('bathrooms')
    existing.price = listing_data['price']
    existing.description = listing_data.get('description')
    existing.property_type = listing_data.get('property_type')
    existing.sqft = listing_data.get('sqft')
    existing.url = listing_data.get('url')
    existing.amenities_raw = listing_data.get('amenities_raw')
    existing.has_pool = listing_data.get('has_pool', False)
    existing.has_waterfront = listing_data.get('has_waterfront', False)
    existing.has_basement = listing_data.get('has_basement', False)
    existing.has_unfinished_basement = listing_data.get('has_unfinished_basement', False)
    existing.has_finished_basement = listing_data.get('has_finished_basement', False)
    existing.has_garage = listing_data.get('has_garage', False)
    existing.has_parking = listing_data.get('has_parking', False)
    existing.has_laundry = listing_data.get('has_laundry', False)
    existing.has_ac = listing_data.get('has_ac', False)
    existing.has_fireplace = listing_data.get('has_fireplace', False)
    existing.has_yard = listing_data.get('has_yard', False)
    existing.has_patio = listing_data.get('has_patio', False)
    existing.has_balcony = listing_data.get('has_balcony', False)
    existing.has_gym = listing_data.get('has_gym', False)
    existing.has_pet_friendly = listing_data.get('has_pet_friendly', False)
    existing.extra_rooms_count = listing_data.get('extra_rooms_count', 0)
    existing.extra_rooms_details = listing_data.get('extra_rooms_details')
    existing.potential_bedrooms = listing_data.get('potential_bedrooms')
    existing.has_office = listing_data.get('has_office', False)
    existing.has_den = listing_data.get('has_den', False)
    existing.has_bonus_room = listing_data.get('has_bonus_room', False)
    existing.has_loft = listing_data.get('has_loft', False)
    existing.has_flex_space = listing_data.get('has_flex_space', False)
    existing.has_sunroom = listing_data.get('has_sunroom', False)
    existing.has_media_room = listing_data.get('has_media_room', False)
    existing.has_game_room = listing_data.get('has_game_room', False)
    existing.has_guest_room = listing_data.get('has_guest_room', False)
    existing.has_nursery = listing_data.get('has_nursery', False)
    existing.has_studio = listing_data.get('has_studio', False)
    existing.has_attic = listing_data.get('has_attic', False)
    existing.has_mother_in_law = listing_data.get('has_mother_in_law', False)
    existing.listing_type = listing_data.get('listing_type', 'rental')
    existing.sale_price = listing_data.get('sale_price')
    existing.has_creative_financing = listing_data.get('has_creative_financing', False)
    existing.financing_keywords = listing_data.get('financing_keywords')
    # Update agent info if available
    if listing_data.get('agent_name'):
        existing.agent_name = listing_data.get('agent_name')
    if listing_data.get('agent_phone'):
        existing.agent_phone = listing_data.get('agent_phone')
    if listing_data.get('agent_email'):
        existing.agent_email = listing_data.get('agent_email')
    if listing_data.get('agent_company'):
        existing.agent_company = listing_data.get('agent_company')
    if listing_data.get('photos'):
        existing.photos = json.dumps(listing_data.get('photos', []))
    # Update timestamps - keep first_seen, update last_seen
    existing.last_seen = now
    existing.scraped_at = now
    # Re-activate if was marked as rented but came back
    if existing.status == 'rented':
        existing.status = 'active'
        existing.marked_rented_at = None
        logger.info(f"Listing {existing.zillow_id} re-activated (was rented, now back on market)")


def _normalize_address(address: str) -> str:
    """
    Normalize address for deduplication matching.
    Removes common variations to match the same property across sources.
    """
    if not address:
        return ""
    # Lowercase and strip
    addr = address.lower().strip()
    # Remove common abbreviations and normalize
    replacements = [
        (' street', ' st'),
        (' avenue', ' ave'),
        (' boulevard', ' blvd'),
        (' drive', ' dr'),
        (' road', ' rd'),
        (' lane', ' ln'),
        (' court', ' ct'),
        (' place', ' pl'),
        (' circle', ' cir'),
        (' apartment', ' apt'),
        (' suite', ' ste'),
        (' unit', ' #'),
        (' #', ' '),
        ('.', ''),
        (',', ''),
        ('  ', ' '),
    ]
    for old, new in replacements:
        addr = addr.replace(old, new)
    # Remove extra spaces
    addr = ' '.join(addr.split())
    return addr


def _merge_listing_data(zillow_data: Dict[str, Any], realtor_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge listing data from Zillow and Realtor.com.
    Prefers Realtor for agent info, uses Zillow as base with Realtor enhancements.
    """
    # Start with Zillow data as base
    merged = zillow_data.copy()
    
    # Prefer Realtor agent contact info (more reliable)
    if realtor_data.get('agent_name'):
        merged['agent_name'] = realtor_data['agent_name']
    if realtor_data.get('agent_phone'):
        merged['agent_phone'] = realtor_data['agent_phone']
    if realtor_data.get('agent_email'):
        merged['agent_email'] = realtor_data['agent_email']
    if realtor_data.get('agent_company'):
        merged['agent_company'] = realtor_data['agent_company']
    
    # Use Realtor photos if Zillow doesn't have any
    if realtor_data.get('photos') and not merged.get('photos'):
        merged['photos'] = realtor_data['photos']
    
    # Keep Realtor URL as secondary reference
    if realtor_data.get('url'):
        merged['realtor_url'] = realtor_data['url']
    
    # Merge amenities (OR logic - if either source says yes)
    amenity_fields = [
        'has_pool', 'has_waterfront', 'has_basement', 'has_garage',
        'has_parking', 'has_laundry', 'has_ac', 'has_fireplace',
        'has_yard', 'has_patio', 'has_balcony', 'has_gym', 'has_pet_friendly'
    ]
    for field in amenity_fields:
        if realtor_data.get(field) or merged.get(field):
            merged[field] = True
    
    # Mark as from both sources
    merged['listing_source'] = 'both'
    
    return merged


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
    """
    Background task to run scraping job with smart diff logic.
    
    ALWAYS fetches from both Zillow AND Realtor.com APIs:
    - Cross-references listings by address to eliminate duplicates
    - Merges data when same property found in both sources
    - Updates existing listings (preserves first_seen)
    - Adds new listings
    - Marks missing listings as 'rented' (assumes property was rented)
    - Listings are deleted after 45 days via cleanup job
    """
    job_key = f"{city}_{state}" + (f"_{zip_code}" if zip_code else "")
    scrape_jobs[job_key] = {"status": "running", "listings_found": 0, "message": "Fetching from Zillow and Realtor.com..."}
    
    try:
        # ALWAYS fetch from BOTH sources
        zillow_listings = []
        realtor_listings = []
        zillow_error = None
        realtor_error = None
        
        # Fetch from Zillow
        try:
            logger.info(f"Fetching Zillow listings for {city}, {state}")
            zillow_listings = await scrape_zillow(
                city, state, min_bedrooms, max_bedrooms, 
                zip_code=zip_code,
                include_surrounding=include_surrounding,
                surrounding_miles=surrounding_miles,
                surrounding_only=surrounding_only
            )
            logger.info(f"Found {len(zillow_listings)} Zillow listings")
        except Exception as e:
            zillow_error = str(e)
            logger.warning(f"Zillow scraper error: {e}")
        
        # ALWAYS fetch from Realtor.com (not conditional on is_configured)
        try:
            logger.info(f"Fetching Realtor.com listings for {city}, {state}")
            if realtor_api.is_configured():
                realtor_listings = await realtor_api.search_all_rentals(
                    city=city,
                    state_code=state,
                    min_beds=min_bedrooms,
                    max_beds=max_bedrooms,
                    max_listings=500
                )
                logger.info(f"Found {len(realtor_listings)} Realtor.com listings")
            else:
                realtor_error = "RAPIDAPI_KEY not configured"
                logger.warning("Realtor.com API not configured (RAPIDAPI_KEY missing)")
        except Exception as e:
            realtor_error = str(e)
            logger.warning(f"Realtor.com API error: {e}")
        
        # Check if we got any data
        if not zillow_listings and not realtor_listings:
            error_msg = "No listings found from either source."
            if zillow_error:
                error_msg += f" Zillow: {zillow_error}."
            if realtor_error:
                error_msg += f" Realtor: {realtor_error}."
            scrape_jobs[job_key] = {
                "status": "failed",
                "listings_found": 0,
                "message": error_msg
            }
            return
        
        # ============================================================
        # DEDUPLICATION: Cross-reference listings by normalized address
        # ============================================================
        
        # Index Zillow listings by normalized address
        zillow_by_address = {}
        for listing in zillow_listings:
            addr_key = _normalize_address(listing.get('address', ''))
            if addr_key:
                zillow_by_address[addr_key] = listing
        
        # Index Realtor listings by normalized address
        realtor_by_address = {}
        for listing in realtor_listings:
            addr_key = _normalize_address(listing.get('address', ''))
            if addr_key:
                realtor_by_address[addr_key] = listing
        
        # Find duplicates and merge, track unique listings
        merged_listings = []  # Listings found in both sources (merged)
        zillow_only = []      # Listings only in Zillow
        realtor_only = []     # Listings only in Realtor
        
        # Process Zillow listings, check for Realtor matches
        for addr_key, zillow_data in zillow_by_address.items():
            if addr_key in realtor_by_address:
                # DUPLICATE FOUND - merge data from both sources
                realtor_data = realtor_by_address[addr_key]
                merged = _merge_listing_data(zillow_data, realtor_data)
                merged_listings.append(merged)
                logger.debug(f"Merged duplicate listing: {zillow_data.get('address')}")
            else:
                # Zillow only
                zillow_data['listing_source'] = 'zillow'
                zillow_only.append(zillow_data)
        
        # Find Realtor-only listings (not in Zillow)
        for addr_key, realtor_data in realtor_by_address.items():
            if addr_key not in zillow_by_address:
                realtor_data['listing_source'] = 'realtor'
                realtor_only.append(realtor_data)
        
        # Combine all unique listings
        all_listings = merged_listings + zillow_only + realtor_only
        
        logger.info(f"Deduplication results: {len(merged_listings)} merged, "
                   f"{len(zillow_only)} Zillow-only, {len(realtor_only)} Realtor-only, "
                   f"{len(all_listings)} total unique listings")
        
        # ============================================================
        # DATABASE OPERATIONS
        # ============================================================
        
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
            
            # Get ALL existing listings for this city (active and rented)
            # This is important because we need to update/reactivate listings, not re-insert
            existing_listings = db.query(ZillowListing).filter(
                ZillowListing.city_id == city_obj.id
            ).all()
            active_listings = [l for l in existing_listings if l.status == 'active']
            
            # Build lookup dicts for ALL listings (not just active)
            existing_by_id = {l.zillow_id: l for l in existing_listings}
            existing_by_address = {_normalize_address(l.address): l for l in existing_listings if l.address}
            
            # Track which listings we've seen in this scrape (for marking rented)
            seen_ids = set()
            seen_addresses = set()
            new_count = 0
            updated_count = 0
            merged_count = len(merged_listings)
            
            # Process all deduplicated listings
            for listing_data in all_listings:
                # Generate a unique ID based on source
                source = listing_data.get('listing_source', 'zillow')
                if source == 'both':
                    # Use Zillow ID for merged listings
                    listing_id = listing_data.get('zillow_id')
                elif source == 'realtor':
                    listing_id = f"realtor_{listing_data.get('property_id') or listing_data.get('listing_id')}"
                else:
                    listing_id = listing_data.get('zillow_id')
                
                if not listing_id:
                    continue
                
                listing_data['zillow_id'] = listing_id
                addr_key = _normalize_address(listing_data.get('address', ''))
                
                seen_ids.add(listing_id)
                seen_addresses.add(addr_key)
                
                # Check if we already have this listing (by ID or address) - includes rented!
                existing = existing_by_id.get(listing_id) or existing_by_address.get(addr_key)
                
                if existing:
                    # Update existing listing (this also re-activates if it was rented)
                    _update_listing_from_data(existing, listing_data)
                    # Update source if now found in both
                    if source == 'both':
                        existing.listing_source = 'both'
                    updated_count += 1
                else:
                    # Also check globally (listing might be in different city record)
                    global_existing = db.query(ZillowListing).filter(
                        ZillowListing.zillow_id == listing_id
                    ).first()
                    
                    if not global_existing and addr_key:
                        # Check by address globally too
                        global_existing = db.query(ZillowListing).filter(
                            ZillowListing.address.ilike(f"%{listing_data.get('address', '')[:30]}%")
                        ).first()
                    
                    if global_existing:
                        global_existing.city_id = city_obj.id
                        _update_listing_from_data(global_existing, listing_data)
                        # Add to our local lookup for future reference
                        existing_by_id[listing_id] = global_existing
                        updated_count += 1
                    else:
                        # Truly new listing
                        new_listing = _create_listing_from_data(listing_data, city_obj.id, source=source)
                        db.add(new_listing)
                        existing_by_id[listing_id] = new_listing  # Track to avoid re-adding
                        new_count += 1
            
            # Mark active listings not seen in this scrape as 'rented'
            # (they're no longer on the market - assume rented)
            rented_count = 0
            now = datetime.utcnow()
            for listing in active_listings:  # Only check previously active listings
                addr_key = _normalize_address(listing.address) if listing.address else ""
                if listing.zillow_id not in seen_ids and addr_key not in seen_addresses:
                    listing.status = 'rented'
                    listing.marked_rented_at = now
                    rented_count += 1
                    logger.info(f"Marked listing {listing.zillow_id} as rented (no longer in either API)")
            
            city_obj.last_scraped = datetime.utcnow()
            db.commit()
            
            # Invalidate caches when new listings are scraped
            listings_cache.invalidate()
            analysis_cache.invalidate()
            
            total_unique = new_count + updated_count
            message = f"Scraped {total_unique} unique listings ({new_count} new, {updated_count} updated"
            if merged_count > 0:
                message += f", {merged_count} cross-referenced from both APIs"
            if rented_count > 0:
                message += f", {rented_count} marked as rented"
            message += ")"
            
            # Add source breakdown
            source_info = f" [Zillow: {len(zillow_listings)}, Realtor: {len(realtor_listings)}]"
            
            scrape_jobs[job_key] = {
                "status": "completed",
                "listings_found": total_unique,
                "new_listings": new_count,
                "updated_listings": updated_count,
                "merged_duplicates": merged_count,
                "rented_listings": rented_count,
                "zillow_count": len(zillow_listings),
                "realtor_count": len(realtor_listings),
                "message": message + source_info
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


# Track batch scrape job status
batch_scrape_status = {
    "status": "idle",
    "total_cities": 0,
    "completed_cities": 0,
    "failed_cities": 0,
    "current_city": None,
    "results": [],
    "message": ""
}


async def run_batch_scrape_job(cities: List[tuple], min_bedrooms: int, max_bedrooms: int, db_session_factory):
    """Background task to scrape multiple cities sequentially."""
    global batch_scrape_status
    
    batch_scrape_status["status"] = "running"
    batch_scrape_status["total_cities"] = len(cities)
    batch_scrape_status["completed_cities"] = 0
    batch_scrape_status["failed_cities"] = 0
    batch_scrape_status["results"] = []
    batch_scrape_status["message"] = f"Scraping {len(cities)} cities..."
    
    for city, state in cities:
        try:
            batch_scrape_status["current_city"] = f"{city}, {state}"
            logger.info(f"Batch scrape: Starting {city}, {state}")
            
            # Run the scrape job
            await run_scrape_job(
                city=city,
                state=state,
                min_bedrooms=min_bedrooms,
                max_bedrooms=max_bedrooms,
                db_session_factory=db_session_factory
            )
            
            # Get result from scrape_jobs
            job_key = f"{city}_{state}"
            job_result = scrape_jobs.get(job_key, {})
            
            if job_result.get("status") == "completed":
                batch_scrape_status["completed_cities"] += 1
                batch_scrape_status["results"].append({
                    "city": city,
                    "state": state,
                    "status": "completed",
                    "listings_found": job_result.get("listings_found", 0),
                    "message": job_result.get("message", "")
                })
            else:
                batch_scrape_status["failed_cities"] += 1
                batch_scrape_status["results"].append({
                    "city": city,
                    "state": state,
                    "status": "failed",
                    "message": job_result.get("message", "Unknown error")
                })
                
        except Exception as e:
            logger.error(f"Batch scrape error for {city}, {state}: {e}")
            batch_scrape_status["failed_cities"] += 1
            batch_scrape_status["results"].append({
                "city": city,
                "state": state,
                "status": "failed",
                "message": str(e)
            })
        
        # Small delay between cities to avoid rate limiting
        await asyncio.sleep(2)
    
    batch_scrape_status["status"] = "completed"
    batch_scrape_status["current_city"] = None
    completed = batch_scrape_status["completed_cities"]
    failed = batch_scrape_status["failed_cities"]
    total = batch_scrape_status["total_cities"]
    batch_scrape_status["message"] = f"Completed {completed}/{total} cities ({failed} failed)"
    logger.info(f"Batch scrape completed: {completed}/{total} cities, {failed} failed")


@app.post("/api/scrape/all-with-revenue-data")
async def scrape_all_cities_with_revenue_data(
    background_tasks: BackgroundTasks,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    db: Session = Depends(get_db)
):
    """
    Start scraping rental listings for ALL cities that have Airbtics/AirDNA revenue data.
    
    This pulls from both Zillow and Realtor.com APIs for each city,
    cross-references duplicates, and stores in PostgreSQL with 45-day retention.
    
    Runs in background - use GET /api/scrape/batch-status to monitor progress.
    """
    global batch_scrape_status
    from .database import SessionLocal
    
    # Check if already running
    if batch_scrape_status["status"] == "running":
        return {
            "status": "already_running",
            "message": f"Batch scrape already in progress: {batch_scrape_status['completed_cities']}/{batch_scrape_status['total_cities']} cities",
            "current_city": batch_scrape_status["current_city"]
        }
    
    # Get all cities that have revenue data (from Airbtics or manual AirDNA)
    cities_with_data = db.query(City).join(
        AirDNAData, City.id == AirDNAData.city_id
    ).distinct().all()
    
    if not cities_with_data:
        return {
            "status": "no_cities",
            "message": "No cities with revenue data found. Run Airbtics sync first or add manual AirDNA data.",
            "cities_count": 0
        }
    
    # Build list of (city, state) tuples
    cities_to_scrape = [(c.city, c.state) for c in cities_with_data]
    
    logger.info(f"Starting batch scrape for {len(cities_to_scrape)} cities with revenue data")
    
    # Start background task
    background_tasks.add_task(
        run_batch_scrape_job,
        cities_to_scrape,
        min_bedrooms,
        max_bedrooms,
        SessionLocal
    )
    
    # Reset status
    batch_scrape_status = {
        "status": "starting",
        "total_cities": len(cities_to_scrape),
        "completed_cities": 0,
        "failed_cities": 0,
        "current_city": None,
        "results": [],
        "message": f"Starting scrape for {len(cities_to_scrape)} cities..."
    }
    
    return {
        "status": "started",
        "message": f"Started batch scrape for {len(cities_to_scrape)} cities with revenue data",
        "cities": [f"{c}, {s}" for c, s in cities_to_scrape],
        "cities_count": len(cities_to_scrape),
        "min_bedrooms": min_bedrooms,
        "max_bedrooms": max_bedrooms
    }


@app.get("/api/scrape/batch-status")
def get_batch_scrape_status():
    """Get the status of the batch scrape job for all cities."""
    return batch_scrape_status


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
    # Listing status filter
    status: Optional[str] = 'active',  # 'active', 'rented', 'all' - defaults to active only
    listing_source: Optional[str] = None,  # 'zillow', 'realtor', or None for all
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
    
    # Listing status filter (default to active only)
    if status and status != 'all':
        query = query.filter(ZillowListing.status == status)
    
    # Listing source filter
    if listing_source:
        query = query.filter(ZillowListing.listing_source == listing_source)
    
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


@app.get("/api/listings/lifecycle-stats", response_model=ListingsStatsResponse)
def get_listings_lifecycle_stats(db: Session = Depends(get_db)):
    """
    Get listing lifecycle statistics.
    
    Shows counts by status (active/rented/expired), data sources,
    and date ranges for 45-day retention visibility.
    """
    try:
        # Try to get total count first (works even if new columns don't exist)
        total_count = db.query(func.count(ZillowListing.id)).scalar() or 0
        
        # If no listings, return empty stats
        if total_count == 0:
            return ListingsStatsResponse(
                total_listings=0,
                active_listings=0,
                rented_listings=0,
                expired_listings=0,
                listings_by_source={},
                oldest_listing_date=None,
                newest_listing_date=None,
                retention_days=LISTING_RETENTION_DAYS,
            )
        
        # Try to get status counts (may fail if column doesn't exist)
        try:
            status_counts = db.query(
                ZillowListing.status,
                func.count(ZillowListing.id).label('count')
            ).group_by(ZillowListing.status).all()
            status_dict = {s.status: s.count for s in status_counts if s.status}
        except Exception:
            # Column doesn't exist, assume all are active
            status_dict = {'active': total_count}
        
        # Try to get source counts
        try:
            source_counts = db.query(
                ZillowListing.listing_source,
                func.count(ZillowListing.id).label('count')
            ).group_by(ZillowListing.listing_source).all()
            source_dict = {s.listing_source: s.count for s in source_counts if s.listing_source}
        except Exception:
            # Column doesn't exist
            source_dict = {}
        
        # Try to get date ranges
        oldest = None
        newest = None
        try:
            date_stats = db.query(
                func.min(ZillowListing.first_seen).label('oldest'),
                func.max(ZillowListing.first_seen).label('newest')
            ).first()
            if date_stats:
                oldest = date_stats.oldest
                newest = date_stats.newest
        except Exception:
            # first_seen column doesn't exist, try scraped_at
            try:
                date_stats = db.query(
                    func.min(ZillowListing.scraped_at).label('oldest'),
                    func.max(ZillowListing.scraped_at).label('newest')
                ).first()
                if date_stats:
                    oldest = date_stats.oldest
                    newest = date_stats.newest
            except Exception:
                pass
        
        return ListingsStatsResponse(
            total_listings=total_count,
            active_listings=status_dict.get('active', total_count),
            rented_listings=status_dict.get('rented', 0),
            expired_listings=status_dict.get('expired', 0),
            listings_by_source=source_dict,
            oldest_listing_date=oldest,
            newest_listing_date=newest,
            retention_days=LISTING_RETENTION_DAYS,
        )
    except Exception as e:
        logger.error(f"Error getting listings lifecycle stats: {e}")
        # Return empty stats on any error
        return ListingsStatsResponse(
            total_listings=0,
            active_listings=0,
            rented_listings=0,
            expired_listings=0,
            listings_by_source={},
            oldest_listing_date=None,
            newest_listing_date=None,
            retention_days=LISTING_RETENTION_DAYS,
        )


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
        # Get ALL revenue data for this city (both airbtics and manual)
        all_revenue_entries = db.query(AirDNAData).filter(
            AirDNAData.city_id == city.id
        ).all()
        
        # Filter for airbtics-specific entries (for refresh logic)
        airbtics_entries = [e for e in all_revenue_entries if e.source == 'airbtics']
        
        has_data = len(all_revenue_entries) > 0
        market_id = airbtics_entries[0].airbtics_market_id if airbtics_entries else None
        last_fetch = max((e.last_api_fetch for e in airbtics_entries if e.last_api_fetch), default=None)
        # Only needs refresh if we have airbtics data that's stale, or no data at all
        needs_refresh = (len(airbtics_entries) > 0 and last_fetch and last_fetch < cutoff_date) or len(all_revenue_entries) == 0
        
        result.append(AirbticsCityStatus(
            city_id=city.id,
            city=city.city,
            state=city.state,
            zip_code=city.zip_code,
            has_airbtics_data=has_data,
            market_id=market_id,
            last_fetch=last_fetch,
            entries_count=len(all_revenue_entries),  # Count ALL revenue entries
            needs_refresh=needs_refresh
        ))
    
    return result


@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ==================== Auto-cleanup for old data ====================

def cleanup_old_listings():
    """
    Remove rental listings older than 45 days.
    
    Cleanup rules:
    - Active listings older than 45 days from first_seen are deleted (stale data)
    - Rented listings older than 45 days from marked_rented_at are deleted
    - Expired listings are deleted immediately
    
    This ensures we only keep fresh, relevant rental data.
    """
    from .database import SessionLocal
    db = SessionLocal()
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=LISTING_RETENTION_DAYS)
        
        # Delete active listings older than 45 days (stale - should have been re-scraped)
        stale_active = db.query(ZillowListing).filter(
            ZillowListing.status == 'active',
            ZillowListing.first_seen < cutoff_date
        ).delete()
        
        # Delete rented listings older than 45 days from when they were marked rented
        stale_rented = db.query(ZillowListing).filter(
            ZillowListing.status == 'rented',
            ZillowListing.marked_rented_at < cutoff_date
        ).delete()
        
        # Delete any expired listings
        expired = db.query(ZillowListing).filter(
            ZillowListing.status == 'expired'
        ).delete()
        
        db.commit()
        
        total_deleted = stale_active + stale_rented + expired
        if total_deleted > 0:
            logger.info(f"🧹 Cleaned up {total_deleted} old listings "
                       f"({stale_active} stale active, {stale_rented} old rented, {expired} expired)")
    except Exception as e:
        logger.error(f"Error cleaning up old listings: {e}")
        db.rollback()
    finally:
        db.close()


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
        # Return ADJUSTED revenue as main estimate (accounts for realistic occupancy)
        "estimated_annual_revenue": round(adjusted_revenue, 2),
        # Also provide raw potential and occupancy for transparency
        "potential_annual_revenue": round(annual_revenue, 2),
        "occupancy_rate": round(occupancy_rate, 2),
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
        # NOTE: Revenue data from the CENTER city is applied to ALL listings in the radius
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
        
        # For city_radius mode, we use the CENTER city's revenue data for all listings
        # This makes sense because STR revenue is similar within a metro area
        center_city_revenue_data = None
        center_city_record = db.query(City).filter(
            func.lower(City.city) == center_city.lower(),
            func.lower(City.state) == state_code.lower()
        ).first()
        
        if center_city_record:
            center_city_revenue_data = db.query(AirDNAData).filter(
                AirDNAData.city_id == center_city_record.id
            ).all()
        
        # If center city has no record, try to find revenue data by city name directly
        if not center_city_revenue_data:
            center_city_revenue_data = db.query(AirDNAData).join(City).filter(
                func.lower(City.city) == center_city.lower(),
                func.lower(City.state) == state_code.lower()
            ).all()
        
        # Store for later use in the city loop
        if center_city_revenue_data:
            request._center_city_revenue = center_city_revenue_data
            request._center_city_name = center_city
            request._center_state = state_code
            logger.info(f"Using {center_city}, {state_code} revenue data for all {len(cities_to_search)} cities in radius")
        else:
            warnings.append(f"No revenue data for center city {center_city}, {state_code}. Add revenue data for this city first.")
    
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
                listing_type=listing.get("listing_type", "rental"),
                sale_price=listing.get("sale_price"),
                rent_estimation_method=listing.get("rent_estimation_method"),
                agent_name=listing.get("agent_name"),
                agent_phone=listing.get("agent_phone"),
                agent_email=listing.get("agent_email"),
                agent_company=listing.get("agent_company"),
                listing_source=listing.get("listing_source", "realtor"),
                has_pool=listing.get("has_pool", False),
                has_waterfront=listing.get("has_waterfront", False),
                has_garage=listing.get("has_garage", False),
                has_yard=listing.get("has_yard", False),
                has_basement=listing.get("has_basement", False),
                has_unfinished_basement=listing.get("has_unfinished_basement", False),
                estimated_annual_revenue=metrics["estimated_annual_revenue"],
                potential_annual_revenue=metrics["potential_annual_revenue"],
                occupancy_rate=metrics["occupancy_rate"],
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
                        max_listings=500
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
    
    # ==========================================================================
    # OPTIMIZED: For city_radius mode, fetch ALL listings from DB in ONE query
    # instead of making API calls for each of 294 cities
    # ==========================================================================
    
    if search_mode == "city_radius" and hasattr(request, '_center_city_revenue') and request._center_city_revenue:
        # Build revenue lookup from center city
        revenue_by_bedroom = {}
        for rd in request._center_city_revenue:
            for br in range(rd.bedrooms_min, rd.bedrooms_max + 1):
                if br not in revenue_by_bedroom:
                    revenue_by_bedroom[br] = rd
                    revenue_sources[rd.source or "manual"] = revenue_sources.get(rd.source or "manual", 0) + 1
        
        # Get ALL rental listings from database that match our criteria (FAST - single query)
        rental_query = db.query(ZillowListing).filter(
            ZillowListing.bedrooms >= request.min_bedrooms,
            ZillowListing.bedrooms <= request.max_bedrooms,
            ZillowListing.status == 'active',
            ZillowListing.listing_type == 'rental',
            ZillowListing.price > 100,  # Filter out bad data ($1/mo rent)
            ZillowListing.price < 50000  # Filter out obvious errors
        )
        
        # Apply basement filter if specified
        if request.basement_filter == 'include':
            rental_query = rental_query.filter(ZillowListing.has_unfinished_basement == True)
        elif request.basement_filter == 'exclude':
            rental_query = rental_query.filter(
                (ZillowListing.has_unfinished_basement == False) | (ZillowListing.has_unfinished_basement == None)
            )
        
        all_db_listings = rental_query.all()
        
        # Convert to dict format
        all_listings = [{
            "listing_id": l.id,
            "address": l.address,
            "city": l.city or "",
            "state": l.state or "",
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
            "has_basement": l.has_basement,
            "has_unfinished_basement": l.has_unfinished_basement,
            "listing_type": "rental",
        } for l in all_db_listings]
        
        # Also get for-sale listings if requested
        if request.include_for_sale:
            from . import rent_estimator
            
            forsale_query = db.query(ZillowListing).filter(
                ZillowListing.bedrooms >= request.min_bedrooms,
                ZillowListing.bedrooms <= request.max_bedrooms,
                ZillowListing.status == 'active',
                ZillowListing.listing_type == 'for_sale',
                ZillowListing.sale_price > 50000,  # Filter out bad data
            )
            
            # Apply basement filter if specified
            if request.basement_filter == 'include':
                forsale_query = forsale_query.filter(ZillowListing.has_unfinished_basement == True)
            elif request.basement_filter == 'exclude':
                forsale_query = forsale_query.filter(
                    (ZillowListing.has_unfinished_basement == False) | (ZillowListing.has_unfinished_basement == None)
                )
            
            forsale_listings = forsale_query.all()
            
            for l in forsale_listings:
                # Estimate rent for for-sale listings
                est_rent, est_method = rent_estimator.estimate_rent(l, db)
                
                all_listings.append({
                    "listing_id": l.id,
                    "address": l.address,
                    "city": l.city or "",
                    "state": l.state or "",
                    "zip_code": l.zip_code,
                    "bedrooms": l.bedrooms,
                    "bathrooms": l.bathrooms,
                    "price": est_rent,  # Use estimated rent as "price"
                    "sale_price": l.sale_price,
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
                    "has_basement": l.has_basement,
                    "has_unfinished_basement": l.has_unfinished_basement,
                    "listing_type": "for_sale",
                    "rent_estimation_method": est_method,
                })
        
        logger.info(f"Analyzing {len(all_listings)} listings from database for radius search")
        
        # Analyze all listings at once
        radius_opps = await analyze_listings(
            all_listings, 
            revenue_by_bedroom, 
            request._center_city_name, 
            request._center_state, 
            None
        )
        opportunities.extend(radius_opps)
        
        # Skip the per-city loop since we've processed everything
        cities_to_search = []
    
    # Process by city (for non-radius modes)
    for city_name, state_code in cities_to_search:
        city_record = db.query(City).filter(
            func.lower(City.city) == city_name.lower(),
            func.lower(City.state) == state_code.lower()
        ).first()
        
        revenue_data_list = []
        
        # Normal lookup - check this specific city's revenue data
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
        
        # First try database listings (faster)
        listings = []
        if city_record:
            rental_query = db.query(ZillowListing).filter(
                ZillowListing.city_id == city_record.id,
                ZillowListing.bedrooms >= request.min_bedrooms,
                ZillowListing.bedrooms <= request.max_bedrooms,
                ZillowListing.status == 'active',
                ZillowListing.listing_type == 'rental',
                ZillowListing.price > 100,  # Filter bad data
                ZillowListing.price < 50000
            )
            
            # Apply basement filter if specified
            if request.basement_filter == 'include':
                rental_query = rental_query.filter(ZillowListing.has_unfinished_basement == True)
            elif request.basement_filter == 'exclude':
                rental_query = rental_query.filter(
                    (ZillowListing.has_unfinished_basement == False) | (ZillowListing.has_unfinished_basement == None)
                )
            
            db_listings = rental_query.all()
            
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
                "has_basement": l.has_basement,
                "has_unfinished_basement": l.has_unfinished_basement,
                "listing_type": "rental",
            } for l in db_listings]
            
            # Also get for-sale listings if requested
            if request.include_for_sale:
                from . import rent_estimator
                
                forsale_query = db.query(ZillowListing).filter(
                    ZillowListing.city_id == city_record.id,
                    ZillowListing.bedrooms >= request.min_bedrooms,
                    ZillowListing.bedrooms <= request.max_bedrooms,
                    ZillowListing.status == 'active',
                    ZillowListing.listing_type == 'for_sale',
                    ZillowListing.sale_price > 50000,
                )
                
                if request.basement_filter == 'include':
                    forsale_query = forsale_query.filter(ZillowListing.has_unfinished_basement == True)
                elif request.basement_filter == 'exclude':
                    forsale_query = forsale_query.filter(
                        (ZillowListing.has_unfinished_basement == False) | (ZillowListing.has_unfinished_basement == None)
                    )
                
                forsale_listings = forsale_query.all()
                
                for l in forsale_listings:
                    est_rent, est_method = rent_estimator.estimate_rent(l, db)
                    listings.append({
                        "listing_id": l.id,
                        "address": l.address,
                        "city": l.city or city_name,
                        "state": l.state or state_code,
                        "zip_code": l.zip_code,
                        "bedrooms": l.bedrooms,
                        "bathrooms": l.bathrooms,
                        "price": est_rent,
                        "sale_price": l.sale_price,
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
                        "has_basement": l.has_basement,
                        "has_unfinished_basement": l.has_unfinished_basement,
                        "listing_type": "for_sale",
                        "rent_estimation_method": est_method,
                    })
        
        # Only call API if no database listings and API is configured
        if not listings and use_realtor_api:
            try:
                api_listings = await realtor_api.search_all_rentals(
                    city=city_name,
                    state_code=state_code,
                    min_beds=request.min_bedrooms,
                    max_beds=request.max_bedrooms,
                    max_listings=500
                )
                listings = api_listings
            except Exception as e:
                logger.error(f"Realtor API error for {city_name}: {str(e)}")
                warnings.append(f"API error for {city_name}: {str(e)}")
        
        city_opps = await analyze_listings(listings, revenue_by_bedroom, city_name, state_code, None)
        opportunities.extend(city_opps)
    
    # Sort: Rentals first, then for-sale, each sorted by ROI score (highest first)
    rental_opps = [o for o in opportunities if o.listing_type == 'rental']
    forsale_opps = [o for o in opportunities if o.listing_type == 'for_sale']
    
    rental_opps.sort(key=lambda x: x.roi_score, reverse=True)
    forsale_opps.sort(key=lambda x: x.roi_score, reverse=True)
    
    # Combine: rentals first, then for-sale
    opportunities = rental_opps + forsale_opps
    
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
    Get comprehensive status of STR revenue data in the database.
    Returns markets available for nationwide search and data freshness info.
    Includes ALL sources: manual, airbtics, screenshot.
    """
    from datetime import datetime, timedelta
    
    # Get ALL STR revenue data entries (not just airbtics source)
    all_data = db.query(AirDNAData).all()
    
    # Get unique cities with ANY STR revenue data
    cities_with_data = db.query(City).join(AirDNAData).distinct().all()
    
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
            AirDNAData.city_id == city.id
        ).all()
        
        bedroom_ranges = set()
        latest_fetch = None
        sources = set()
        for d in city_data:
            bedroom_ranges.add(f"{d.bedrooms_min}-{d.bedrooms_max}")
            sources.add(d.source or 'manual')
            if d.last_api_fetch:
                if not latest_fetch or d.last_api_fetch > latest_fetch:
                    latest_fetch = d.last_api_fetch
        
        is_fresh = latest_fetch and latest_fetch > six_months_ago if latest_fetch else False
        
        markets.append({
            "city": city.city,
            "state": city.state,
            "entries_count": len(city_data),
            "bedroom_ranges": list(bedroom_ranges),
            "sources": list(sources),
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


# ==================== Events API ====================

from .schemas import EventCreate, EventResponse, EventsListResponse, MarketEventsResponse

@app.get("/api/events", response_model=EventsListResponse)
def get_all_events(
    days_ahead: int = Query(365, ge=30, le=730),
    db: Session = Depends(get_db)
):
    """
    Get all events (curated + custom) happening within the specified timeframe.
    """
    # Get custom events from database
    custom_events_db = db.query(CustomEvent).all()
    custom_events_list = [
        {
            "id": ce.id,
            "name": ce.name,
            "city": ce.city,
            "state": ce.state,
            "start_date": ce.start_date.date() if hasattr(ce.start_date, 'date') else ce.start_date,
            "end_date": ce.end_date.date() if hasattr(ce.end_date, 'date') else ce.end_date,
            "event_type": ce.event_type,
            "demand_multiplier": ce.demand_multiplier,
            "recurrence": ce.recurrence,
            "description": ce.description or "",
            "affects_radius_miles": ce.affects_radius_miles
        }
        for ce in custom_events_db
    ]
    
    # Get all upcoming events
    all_events = events_module.get_all_upcoming_events(custom_events_list, days_ahead)
    
    # Convert to response format
    events_response = [
        EventResponse(
            id=e.id,
            name=e.name,
            city=e.city,
            state=e.state,
            start_date=e.start_date.isoformat(),
            end_date=e.end_date.isoformat(),
            event_type=e.event_type.value if hasattr(e.event_type, 'value') else e.event_type,
            demand_multiplier=e.demand_multiplier,
            recurrence=e.recurrence.value if hasattr(e.recurrence, 'value') else e.recurrence,
            description=e.description,
            affects_radius_miles=e.affects_radius_miles,
            is_custom=e.is_custom,
            days_until=e.days_until,
            urgency=e.urgency_level
        )
        for e in all_events
    ]
    
    # Count unique markets
    markets = set(f"{e.city}, {e.state}" for e in all_events)
    
    return EventsListResponse(
        events=events_response,
        total_curated=len([e for e in all_events if not e.is_custom]),
        total_custom=len([e for e in all_events if e.is_custom]),
        markets_with_events=len(markets)
    )


@app.get("/api/events/by-market", response_model=MarketEventsResponse)
def get_events_by_market(
    city: str,
    state: str,
    db: Session = Depends(get_db)
):
    """
    Get all events affecting a specific market.
    """
    # Get custom events from database
    custom_events_db = db.query(CustomEvent).filter(
        func.lower(CustomEvent.city) == city.lower(),
        func.lower(CustomEvent.state) == state.lower()
    ).all()
    
    custom_events_list = [
        {
            "id": ce.id,
            "name": ce.name,
            "city": ce.city,
            "state": ce.state,
            "start_date": ce.start_date.date() if hasattr(ce.start_date, 'date') else ce.start_date,
            "end_date": ce.end_date.date() if hasattr(ce.end_date, 'date') else ce.end_date,
            "event_type": ce.event_type,
            "demand_multiplier": ce.demand_multiplier,
            "recurrence": ce.recurrence,
            "description": ce.description or "",
            "affects_radius_miles": ce.affects_radius_miles
        }
        for ce in custom_events_db
    ]
    
    # Get events for this market
    market_events = events_module.get_events_for_market(city, state, custom_events_list)
    
    # Convert to response format
    events_response = [
        EventResponse(
            id=e.id,
            name=e.name,
            city=e.city,
            state=e.state,
            start_date=e.start_date.isoformat(),
            end_date=e.end_date.isoformat(),
            event_type=e.event_type.value if hasattr(e.event_type, 'value') else e.event_type,
            demand_multiplier=e.demand_multiplier,
            recurrence=e.recurrence.value if hasattr(e.recurrence, 'value') else e.recurrence,
            description=e.description,
            affects_radius_miles=e.affects_radius_miles,
            is_custom=e.is_custom,
            days_until=e.days_until,
            urgency=e.urgency_level
        )
        for e in market_events
    ]
    
    # Calculate stats
    highest_multiplier = max((e.demand_multiplier for e in market_events), default=1.0)
    upcoming_events = [e for e in market_events if e.days_until >= 0]
    nearest_days = min((e.days_until for e in upcoming_events), default=None)
    
    return MarketEventsResponse(
        city=city,
        state=state,
        events=events_response,
        total_events=len(events_response),
        highest_demand_multiplier=highest_multiplier,
        nearest_event_days=nearest_days
    )


@app.post("/api/events", response_model=EventResponse)
def create_custom_event(
    event: EventCreate,
    db: Session = Depends(get_db)
):
    """
    Create a custom event for tracking.
    """
    from datetime import date as date_type
    
    # Create the custom event
    db_event = CustomEvent(
        name=event.name,
        city=event.city,
        state=event.state,
        start_date=event.start_date,
        end_date=event.end_date,
        event_type=event.event_type,
        demand_multiplier=event.demand_multiplier,
        recurrence=event.recurrence,
        description=event.description,
        affects_radius_miles=event.affects_radius_miles
    )
    
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    
    # Calculate days until
    today = date_type.today()
    start = db_event.start_date.date() if hasattr(db_event.start_date, 'date') else db_event.start_date
    days_until = (start - today).days
    
    # Determine urgency
    if days_until < 0:
        urgency = "past"
    elif days_until < 90:
        urgency = "urgent"
    elif days_until < 180:
        urgency = "high"
    elif days_until < 365:
        urgency = "medium"
    else:
        urgency = "strategic"
    
    return EventResponse(
        id=db_event.id,
        name=db_event.name,
        city=db_event.city,
        state=db_event.state,
        start_date=start.isoformat() if hasattr(start, 'isoformat') else str(start),
        end_date=(db_event.end_date.date() if hasattr(db_event.end_date, 'date') else db_event.end_date).isoformat(),
        event_type=db_event.event_type,
        demand_multiplier=db_event.demand_multiplier,
        recurrence=db_event.recurrence,
        description=db_event.description or "",
        affects_radius_miles=db_event.affects_radius_miles,
        is_custom=True,
        days_until=days_until,
        urgency=urgency
    )


@app.delete("/api/events/{event_id}")
def delete_custom_event(
    event_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete a custom event. Cannot delete curated events.
    """
    event = db.query(CustomEvent).filter(CustomEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Custom event not found")
    
    db.delete(event)
    db.commit()
    
    return {"message": f"Event '{event.name}' deleted successfully"}


@app.get("/api/events/for-user-markets")
def get_events_for_user_markets(db: Session = Depends(get_db)):
    """
    Get all events affecting markets that the user has configured.
    Returns events grouped by urgency level.
    """
    # Get all user's configured cities
    cities = db.query(City).all()
    if not cities:
        return {
            "urgent": [],
            "high": [],
            "medium": [],
            "strategic": [],
            "total_events": 0,
            "markets_affected": 0
        }
    
    # Get custom events
    custom_events_db = db.query(CustomEvent).all()
    custom_events_list = [
        {
            "id": ce.id,
            "name": ce.name,
            "city": ce.city,
            "state": ce.state,
            "start_date": ce.start_date.date() if hasattr(ce.start_date, 'date') else ce.start_date,
            "end_date": ce.end_date.date() if hasattr(ce.end_date, 'date') else ce.end_date,
            "event_type": ce.event_type,
            "demand_multiplier": ce.demand_multiplier,
            "recurrence": ce.recurrence,
            "description": ce.description or "",
            "affects_radius_miles": ce.affects_radius_miles
        }
        for ce in custom_events_db
    ]
    
    # Collect events for all user markets
    all_market_events = []
    affected_markets = set()
    
    for city in cities:
        market_events = events_module.get_events_for_market(city.city, city.state, custom_events_list)
        if market_events:
            affected_markets.add(f"{city.city}, {city.state}")
            for e in market_events:
                all_market_events.append(e)
    
    # Remove duplicates (same event affecting multiple nearby markets)
    seen = set()
    unique_events = []
    for e in all_market_events:
        key = (e.name, e.start_date.isoformat())
        if key not in seen:
            seen.add(key)
            unique_events.append(e)
    
    # Group by urgency
    result = {
        "urgent": [],
        "high": [],
        "medium": [],
        "strategic": [],
        "past": []
    }
    
    for e in unique_events:
        event_data = {
            "id": e.id,
            "name": e.name,
            "city": e.city,
            "state": e.state,
            "start_date": e.start_date.isoformat(),
            "end_date": e.end_date.isoformat(),
            "event_type": e.event_type.value if hasattr(e.event_type, 'value') else e.event_type,
            "demand_multiplier": e.demand_multiplier,
            "days_until": e.days_until,
            "description": e.description,
            "is_custom": e.is_custom
        }
        result[e.urgency_level].append(event_data)
    
    # Remove past events from count
    del result["past"]
    
    return {
        **result,
        "total_events": len(unique_events),
        "markets_affected": len(affected_markets)
    }


# ==================== AI Investment Suggestions ====================

@app.post("/api/ai/investment-suggestions")
async def get_investment_suggestions(db: Session = Depends(get_db)):
    """
    Generate AI-powered investment suggestions based on all available data.
    
    Enhanced to consider:
    - Curated event database (sports, conferences, festivals, holidays)
    - User-defined custom events
    - AI dynamic research on market trends and upcoming events
    - ROI analysis and market conditions
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
    
    # Gather all data
    cities = db.query(City).all()
    if not cities:
        return {
            "suggestions": "No cities configured yet. Add some cities to analyze investment opportunities.",
            "top_opportunities": [],
            "event_opportunities": [],
            "events_by_urgency": {"urgent": [], "high": [], "medium": [], "strategic": []},
            "warnings": ["No data available for analysis"],
            "markets_analyzed": 0,
            "total_data_points": 0
        }
    
    # Get all AirDNA/Airbtics data
    airdna_data = db.query(AirDNAData).all()
    
    # Get custom events from database
    custom_events_db = db.query(CustomEvent).all()
    custom_events_list = [
        {
            "id": ce.id,
            "name": ce.name,
            "city": ce.city,
            "state": ce.state,
            "start_date": ce.start_date.date() if hasattr(ce.start_date, 'date') else ce.start_date,
            "end_date": ce.end_date.date() if hasattr(ce.end_date, 'date') else ce.end_date,
            "event_type": ce.event_type,
            "demand_multiplier": ce.demand_multiplier,
            "recurrence": ce.recurrence,
            "description": ce.description or "",
            "affects_radius_miles": ce.affects_radius_miles
        }
        for ce in custom_events_db
    ]
    
    # Build market summaries with event data
    market_summaries = []
    markets_with_events = []
    all_relevant_events = []
    
    for city in cities:
        # Get revenue data
        city_airdna = db.query(AirDNAData).filter(
            AirDNAData.city_id == city.id
        ).all()
        
        # Get events for this market
        market_events = events_module.get_events_for_market(city.city, city.state, custom_events_list)
        
        if city_airdna:
            revenues = [a.average_annual_revenue for a in city_airdna if a.average_annual_revenue]
            bedrooms = set(a.bedrooms_min for a in city_airdna if a.bedrooms_min)
            sources = set(a.source for a in city_airdna if a.source)
            
            avg_revenue = sum(revenues) / len(revenues) if revenues else 0
            
            market_data = {
                "city": city.city,
                "state": city.state,
                "avg_annual_revenue": round(avg_revenue),
                "data_points": len(city_airdna),
                "bedroom_counts": sorted(list(bedrooms)),
                "data_sources": list(sources),
                "has_pool_data": any(a.has_pool is not None for a in city_airdna),
                "has_waterfront_data": any(a.has_waterfront is not None for a in city_airdna),
                "events": []
            }
            
            # Add event info to market data
            if market_events:
                for event in market_events:
                    event_info = {
                        "name": event.name,
                        "dates": f"{event.start_date.strftime('%b %d')} - {event.end_date.strftime('%b %d, %Y')}",
                        "days_until": event.days_until,
                        "urgency": event.urgency_level,
                        "demand_multiplier": event.demand_multiplier,
                        "type": event.event_type.value if hasattr(event.event_type, 'value') else event.event_type
                    }
                    market_data["events"].append(event_info)
                    all_relevant_events.append({**event_info, "city": city.city, "state": city.state})
                markets_with_events.append(market_data)
            
            market_summaries.append(market_data)
    
    # Format events for the prompt
    events_text = events_module.format_events_for_prompt(
        [e for events in [events_module.get_events_for_market(c.city, c.state, custom_events_list) for c in cities] for e in events]
    )
    
    # Remove duplicate events
    seen_events = set()
    unique_events = []
    for e in all_relevant_events:
        key = (e["name"], e.get("city", ""))
        if key not in seen_events:
            seen_events.add(key)
            unique_events.append(e)
    
    # Group events by urgency for response
    events_by_urgency = {"urgent": [], "high": [], "medium": [], "strategic": []}
    for e in unique_events:
        urgency = e.get("urgency", "medium")
        if urgency in events_by_urgency:
            events_by_urgency[urgency].append(e)
    
    # Get today's date dynamically
    today = datetime.now()
    today_str = today.strftime("%B %d, %Y")
    
    # Build the enhanced prompt
    prompt = f"""You are an expert real estate investment analyst specializing in short-term rental (STR) arbitrage.

TODAY'S DATE: {today_str}

=== KNOWN UPCOMING EVENTS AFFECTING USER'S MARKETS ===
{events_text if events_text != "No major upcoming events identified." else "No major events in user's current markets from our database."}

=== MARKET REVENUE DATA FROM USER'S DATABASE ===
{json.dumps(market_summaries, indent=2)}

=== YOUR ANALYSIS TASKS ===

1. **COMPREHENSIVE DEMAND COMPRESSION RESEARCH**: 
   For EACH city in the user's markets, actively research and identify ALL factors that create demand compression (supply/demand imbalance driving up prices):

   **MAJOR EVENTS & ENTERTAINMENT:**
   - Stadium concerts and tours (Taylor Swift, Beyoncé, major artists)
   - Music festivals not in our database
   - Comedy tours, Broadway shows, theatrical productions
   - Award shows, film premieres, red carpet events
   - Gaming tournaments, esports championships

   **SPORTS (beyond what's in our database):**
   - NFL/NBA/MLB/NHL playoff runs for LOCAL teams (when teams are doing well)
   - College football rivalry games, bowl games
   - College basketball March Madness regionals
   - Golf majors, tennis tournaments
   - NASCAR, Formula 1, IndyCar races
   - UFC/boxing championship fights
   - Olympic trials, World Championships
   - Marathon and running events (Boston, NYC, Chicago marathons)

   **BUSINESS & PROFESSIONAL:**
   - Industry conferences and trade shows
   - Medical/scientific conferences (can be 50,000+ attendees)
   - Tech summits and product launches
   - Corporate relocations bringing workers (Tesla, Apple, etc.)
   - Film and TV productions on location

   **SEASONAL TOURISM PATTERNS:**
   - Beach towns: When does peak season start/end?
   - Ski resorts: Snow season timing
   - Fall foliage destinations
   - Cherry blossom season (DC, etc.)
   - Holiday shopping weekends (Black Friday)
   - Spring break patterns by region
   - Summer vacation patterns

   **ACADEMIC & EDUCATION:**
   - College graduation weekends (HUGE for college towns)
   - Move-in weekends for universities
   - Parents weekends
   - Homecoming weekends
   - College sports seasons

   **CULTURAL & RELIGIOUS:**
   - Major religious holidays affecting travel
   - Cultural festivals and parades
   - Pride events and celebrations
   - Food and wine festivals
   - Art fairs and exhibitions

   **ECONOMIC INDICATORS:**
   - New company headquarters or expansions
   - Factory openings bringing temporary workers
   - Construction projects requiring housing
   - Military base activities
   - Government events and inaugurations

   **WEATHER-DRIVEN:**
   - "Snowbird" migration patterns (FL, AZ, TX in winter)
   - Summer exodus from hot climates
   - Hurricane season effects (evacuation destinations)
   - Eclipse paths and astronomical events

2. **DEMAND MULTIPLIER ANALYSIS**:
   For each identified event/factor, estimate:
   - Expected demand increase (1.5x to 5x normal)
   - Duration of impact (days, weeks, or seasonal)
   - Geographic reach (just the city or surrounding areas)
   - How far in advance bookings spike

3. **TIMING & URGENCY**:
   - Rate each opportunity: URGENT (<3 months), HIGH (3-6 months), MEDIUM (6-12 months), STRATEGIC (>1 year)
   - Identify "investment windows" - when properties need to be acquired to capitalize
   - Note recurring annual patterns vs one-time events

4. **ROI ANALYSIS**: For each promising market:
   - Estimated annual revenue potential (from data provided)
   - Expected profit margins for arbitrage
   - Time to break even
   - Risk factors and seasonality considerations

5. **ACTIONABLE RECOMMENDATIONS**:
   - Top 3-5 markets to prioritize RIGHT NOW and WHY
   - Specific bedroom counts that show best margins
   - Markets with multiple demand drivers (more stable income)
   - Markets to avoid and why
   - Hidden gem opportunities others might miss

Format your response as a clear, actionable investment briefing with the following sections:
- **DISCOVERED EVENTS** (events you found beyond our database)
- **URGENT OPPORTUNITIES** (events < 3 months away)
- **HIGH PRIORITY** (events 3-6 months away)  
- **STRATEGIC PLAYS** (longer-term opportunities)
- **MARKET RANKINGS** (top markets by ROI potential)
- **ACTION ITEMS** (specific next steps)

Be specific with numbers, dates, and reasoning. Keep the response comprehensive but focused (500-800 words)."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """You are an expert real estate investment analyst and market researcher specializing in short-term rental (STR) arbitrage.

Your core mission is to ACTIVELY RESEARCH and identify demand compression events - situations where demand exceeds supply, driving up rental prices. You have comprehensive knowledge of:

EVENTS & ENTERTAINMENT:
- Major concert tours and their schedules (Taylor Swift, Beyoncé, etc.)
- Music festivals, sporting events, conferences across all US cities
- Award shows, film festivals, theatrical productions
- Gaming tournaments and esports events

SPORTS KNOWLEDGE:
- NFL, NBA, MLB, NHL schedules and playoff implications
- College football and basketball - rivalries, bowl games, March Madness
- Golf majors, tennis Grand Slams, NASCAR, F1
- UFC/boxing events, marathons, Olympics

BUSINESS & PROFESSIONAL:
- Major industry conferences (CES, SXSW, medical conferences, etc.)
- Corporate relocations and tech hub developments
- Film/TV production locations

SEASONAL & TOURISM:
- Beach season timing by region
- Ski season patterns
- College graduation and move-in weekends
- Spring break destinations and timing
- Snowbird migration patterns
- Holiday travel patterns

Your analysis should be SPECIFIC with dates, expected demand multipliers, and concrete recommendations. Don't just list generic advice - provide actionable intelligence about SPECIFIC events affecting the user's markets. Research thoroughly and report what you discover."""
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=3000,  # More space for comprehensive event research
            temperature=0.7,
        )
        
        suggestions = response.choices[0].message.content
        
        # Extract top opportunities from market data
        top_opportunities = sorted(
            [m for m in market_summaries if m["avg_annual_revenue"] > 0],
            key=lambda x: x["avg_annual_revenue"],
            reverse=True
        )[:5]
        
        # Markets with events (sorted by nearest event)
        event_opportunities = sorted(
            markets_with_events,
            key=lambda x: min([e["days_until"] for e in x["events"]] or [9999])
        )
        
        return {
            "suggestions": suggestions,
            "top_opportunities": top_opportunities,
            "event_opportunities": event_opportunities,
            "events_by_urgency": events_by_urgency,
            "generated_at": datetime.now().isoformat(),
            "markets_analyzed": len(market_summaries),
            "total_data_points": len(airdna_data),
            "total_events_tracked": len(unique_events)
        }
        
    except Exception as e:
        logger.error(f"OpenAI API error in investment suggestions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


# ==================== AI Advisor Q&A ====================

from pydantic import BaseModel as PydanticBaseModel

class AIQuestionRequest(PydanticBaseModel):
    question: str
    context: Optional[Dict[str, Any]] = None

class AIQuestionResponse(PydanticBaseModel):
    answer: str
    source: str  # "rule_based" or "openai"
    suggestions: List[str] = []
    data: Optional[Dict[str, Any]] = None

@app.post("/api/ai/ask", response_model=AIQuestionResponse)
async def ask_ai_advisor(request: AIQuestionRequest, db: Session = Depends(get_db)):
    """
    Ask the AI Advisor a question about markets, properties, or arbitrage strategies.
    
    Uses rule-based responses by default. Falls back to OpenAI if:
    - OPENAI_API_KEY is configured
    - The rule-based engine doesn't have a specific answer
    """
    from .ai_advisor import RuleBasedAdvisor
    
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    
    # Try rule-based response first
    advisor = RuleBasedAdvisor(db)
    result = advisor.answer(question, request.context)
    
    # If we got a meaningful answer from rules, return it
    if result.get("answer") and "I can help you with questions" not in result["answer"]:
        return AIQuestionResponse(
            answer=result["answer"],
            source="rule_based",
            suggestions=result.get("suggestions", []),
            data=result.get("data")
        )
    
    # Check if OpenAI is available for fallback
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            
            # Build context about available data
            cities = db.query(City).all()
            city_list = ", ".join([f"{c.city}, {c.state}" for c in cities[:10]])
            
            total_listings = db.query(func.count(ZillowListing.id)).filter(
                ZillowListing.status == 'active'
            ).scalar() or 0
            
            revenue_data = db.query(
                City.city,
                func.avg(AirDNAData.annual_revenue).label('avg')
            ).join(AirDNAData, City.id == AirDNAData.city_id)\
            .group_by(City.id).all()
            
            revenue_summary = "; ".join([f"{r.city}: ${r.avg:,.0f}/yr avg" for r in revenue_data[:5]])
            
            system_prompt = f"""You are an AI advisor for rental arbitrage investment. You help users find profitable short-term rental opportunities.

Available data in the system:
- Markets tracked: {city_list}
- Total active listings: {total_listings}
- Revenue data: {revenue_summary}

Provide concise, actionable advice. If asked about specific data you don't have, suggest what the user should do (e.g., "Add revenue data for that market" or "Fetch listings first")."""

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": question}
                ],
                max_tokens=500,
                temperature=0.7
            )
            
            return AIQuestionResponse(
                answer=response.choices[0].message.content,
                source="openai",
                suggestions=["Try asking about specific markets", "Compare cities", "Ask about profit potential"]
            )
            
        except Exception as e:
            logger.warning(f"OpenAI fallback failed: {e}")
            # Fall through to rule-based response
    
    # Return the rule-based response (even if generic)
    return AIQuestionResponse(
        answer=result["answer"],
        source="rule_based",
        suggestions=result.get("suggestions", []),
        data=result.get("data")
    )


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
    logger.info("🚀 Starting up - running cleanup tasks...")
    
    # Cleanup old rental listings (45-day retention)
    cleanup_old_listings()
    
    # Cleanup old manual AirDNA data (1-year retention)
    cleanup_old_airdna_data()
    
    # Start Airbtics sync in background for cities needing refresh
    asyncio.create_task(airbtics.startup_sync())
    
    logger.info(f"✅ Startup complete. Listings retained for {LISTING_RETENTION_DAYS} days.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
