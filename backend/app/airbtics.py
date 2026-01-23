"""
Airbtics API Service

Handles all interactions with the Airbtics API for fetching short-term rental revenue data.
API Documentation: https://documenter.getpostman.com/view/...

Endpoints used:
- markets/search: Find market ID for a city/zip
- markets/metrics/revenue: Get revenue data by bedroom count
"""

import os
import httpx
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from .models import AirDNAData, AirbticsMarket, City
from .database import SessionLocal

logger = logging.getLogger(__name__)

# Airbtics API Configuration
AIRBTICS_BASE_URL = "https://crap0y5bx5.execute-api.us-east-2.amazonaws.com/prod"
AIRBTICS_API_KEY = os.getenv("AIRBTICS_API_KEY", "")

# Sync configuration
REFRESH_INTERVAL_DAYS = 180  # 6 months
BEDROOM_RANGE = range(1, 9)  # 1-8 bedrooms
NUMBER_OF_MONTHS = 36  # 3 years of historical data
API_RATE_LIMIT_DELAY = 0.5  # Seconds between API calls

# Global sync status
sync_status = {
    "status": "idle",
    "total_cities": 0,
    "synced_cities": 0,
    "failed_cities": 0,
    "current_city": None,
    "last_sync": None,
    "message": "",
    "errors": []
}


def get_api_key() -> str:
    """Get API key from environment"""
    key = os.getenv("AIRBTICS_API_KEY", "")
    if not key:
        logger.warning("AIRBTICS_API_KEY not configured")
    return key


async def search_market(
    city: str, 
    state: str, 
    zip_code: Optional[str] = None,
    country_code: str = "US"
) -> Optional[Dict[str, Any]]:
    """
    Search for a market ID in Airbtics.
    
    Args:
        city: City name
        state: State abbreviation (e.g., "TX")
        zip_code: Optional zip code for more precise search
        country_code: Country code (default "US")
    
    Returns:
        Dict with market_id and market_name, or None if not found
    """
    api_key = get_api_key()
    if not api_key:
        return None
    
    # Build search query - prefer zip code if available
    if zip_code:
        query = zip_code
    else:
        query = f"{city}, {state}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{AIRBTICS_BASE_URL}/markets/search",
                params={
                    "query": query,
                    "country_code": country_code
                },
                headers={"x-api-key": api_key}
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for API error messages
                if isinstance(data, dict) and "message" in data:
                    error_msg = data.get("message", "")
                    if "insufficient_credits" in error_msg.lower() or "credit" in error_msg.lower():
                        logger.error(f"Airbtics API: Insufficient credits. Please add credits to your Airbtics account.")
                        return None
                    if "invalid" in error_msg.lower() or "unauthorized" in error_msg.lower():
                        logger.error(f"Airbtics API: Invalid API key or unauthorized")
                        return None
                
                # Response should be a list of markets
                markets = data if isinstance(data, list) else data.get("markets", data.get("data", []))
                
                if markets and len(markets) > 0:
                    # Return the first/best match
                    market = markets[0]
                    return {
                        "market_id": str(market.get("id") or market.get("market_id")),
                        "market_name": market.get("name") or market.get("market_name") or f"{city}, {state}"
                    }
                else:
                    logger.warning(f"No markets found for query: {query}")
                    return None
            else:
                logger.error(f"Airbtics search failed: {response.status_code} - {response.text}")
                return None
                
    except Exception as e:
        logger.error(f"Error searching Airbtics market: {e}")
        return None


async def fetch_revenue_metrics(
    market_id: str, 
    bedrooms: int,
    number_of_months: int = NUMBER_OF_MONTHS
) -> Optional[Dict[str, Any]]:
    """
    Fetch revenue metrics for a market and bedroom count.
    
    Args:
        market_id: Airbtics market identifier
        bedrooms: Number of bedrooms
        number_of_months: Historical data range (default 36)
    
    Returns:
        Dict with revenue percentiles (p25, p50, p75, p90) as annual values
    """
    api_key = get_api_key()
    if not api_key:
        return None
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{AIRBTICS_BASE_URL}/markets/metrics/revenue",
                params={
                    "market_id": market_id,
                    "bedrooms": bedrooms,
                    "number_of_months": number_of_months
                },
                headers={"x-api-key": api_key}
            )
            
            if response.status_code == 200:
                data = response.json()
                # Response format: {"message": [{"month": "2022-09", "p25": 2367, ...}, ...]}
                monthly_data = data.get("message", [])
                
                if not monthly_data:
                    logger.warning(f"No revenue data for market {market_id}, {bedrooms} BR")
                    return None
                
                # Calculate average of recent 12 months for each percentile
                recent_months = monthly_data[:12] if len(monthly_data) >= 12 else monthly_data
                
                if not recent_months:
                    return None
                
                # Calculate averages
                avg_p25 = sum(m.get("p25", 0) for m in recent_months) / len(recent_months)
                avg_p50 = sum(m.get("p50", 0) for m in recent_months) / len(recent_months)
                avg_p75 = sum(m.get("p75", 0) for m in recent_months) / len(recent_months)
                avg_p90 = sum(m.get("p90", 0) for m in recent_months) / len(recent_months)
                
                # Convert to annual values
                return {
                    "p25": round(avg_p25 * 12, 2),
                    "p50": round(avg_p50 * 12, 2),
                    "p75": round(avg_p75 * 12, 2),
                    "p90": round(avg_p90 * 12, 2),
                    "months_of_data": len(monthly_data)
                }
            else:
                logger.error(f"Airbtics revenue fetch failed: {response.status_code} - {response.text}")
                return None
                
    except Exception as e:
        logger.error(f"Error fetching Airbtics revenue: {e}")
        return None


# Amenity mapping from Airbtics to our categories
# Our waterfront category includes multiple Airbtics amenities
AMENITY_FILTERS = [
    {
        "name": "pool",
        "our_field": "has_pool",
        "airbtics_filters": {"pool": True}
    },
    {
        "name": "hot_tub", 
        "our_field": "has_hot_tub",
        "airbtics_filters": {"hot_tub": True}
    },
    {
        "name": "waterfront",
        "our_field": "has_waterfront",
        # Waterfront includes beachfront, amazing_views, lake views, ocean views
        "airbtics_filters": {"beachfront": True}  # Will also check amazing_views
    },
    {
        "name": "pets",
        "our_field": "has_pet_friendly", 
        "airbtics_filters": {"pets": True}
    },
]


async def search_listings_by_market(
    market_id: str,
    bedrooms: int,
    amenity_filters: Optional[Dict[str, bool]] = None,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """
    Search listings in a market with optional amenity filters.
    Uses POST /listings/search/market endpoint.
    
    Args:
        market_id: Airbtics market identifier
        bedrooms: Number of bedrooms to filter by
        amenity_filters: Dict of amenity filters (e.g., {"pool": True, "pets": True})
        limit: Maximum listings to return
    
    Returns:
        List of listings with their revenue data
    """
    api_key = get_api_key()
    if not api_key:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Build request body
            body = {
                "market_id": market_id,
                "bedrooms": bedrooms,
                "limit": limit
            }
            
            # Add amenity filters if provided
            if amenity_filters:
                body["amenities"] = amenity_filters
            
            response = await client.post(
                f"{AIRBTICS_BASE_URL}/listings/search/market",
                json=body,
                headers={"x-api-key": api_key}
            )
            
            if response.status_code == 200:
                data = response.json()
                # Response could be a list or have a "listings" key
                listings = data if isinstance(data, list) else data.get("listings", data.get("message", []))
                return listings if listings else []
            else:
                logger.warning(f"Listings search failed: {response.status_code} - {response.text[:200]}")
                return []
                
    except Exception as e:
        logger.error(f"Error searching listings: {e}")
        return []


def calculate_revenue_from_listings(listings: List[Dict]) -> Optional[Dict[str, Any]]:
    """
    Calculate revenue percentiles from a list of listings.
    
    Args:
        listings: List of listing dicts with revenue data
    
    Returns:
        Dict with p25, p50, p75, p90 annual revenue values, or None if insufficient data
    """
    if not listings or len(listings) < 3:
        return None
    
    # Extract annual revenue from listings
    # Revenue might be in different fields depending on API response
    revenues = []
    for listing in listings:
        # Try different possible field names
        revenue = (
            listing.get("annual_revenue") or 
            listing.get("revenue") or 
            listing.get("ltm_revenue") or  # Last twelve months
            listing.get("estimated_revenue")
        )
        if revenue and revenue > 0:
            revenues.append(float(revenue))
    
    if len(revenues) < 3:
        return None
    
    # Sort for percentile calculation
    revenues.sort()
    n = len(revenues)
    
    def percentile(data, p):
        """Calculate p-th percentile"""
        k = (len(data) - 1) * p / 100
        f = int(k)
        c = f + 1 if f + 1 < len(data) else f
        return data[f] + (k - f) * (data[c] - data[f]) if f != c else data[f]
    
    return {
        "p25": round(percentile(revenues, 25), 2),
        "p50": round(percentile(revenues, 50), 2),
        "p75": round(percentile(revenues, 75), 2),
        "p90": round(percentile(revenues, 90), 2),
        "listing_count": len(revenues)
    }


async def fetch_amenity_filtered_revenue(
    market_id: str,
    bedrooms: int,
    amenity_name: str,
    airbtics_filters: Dict[str, bool]
) -> Optional[Dict[str, Any]]:
    """
    Fetch revenue for listings with specific amenities.
    
    Args:
        market_id: Airbtics market identifier
        bedrooms: Number of bedrooms
        amenity_name: Name of amenity for logging
        airbtics_filters: Airbtics amenity filter dict
    
    Returns:
        Revenue percentiles dict or None
    """
    await asyncio.sleep(API_RATE_LIMIT_DELAY)  # Rate limiting
    
    listings = await search_listings_by_market(
        market_id=market_id,
        bedrooms=bedrooms,
        amenity_filters=airbtics_filters
    )
    
    if not listings:
        logger.debug(f"No listings found for {bedrooms}BR with {amenity_name}")
        return None
    
    revenue_data = calculate_revenue_from_listings(listings)
    
    if revenue_data:
        logger.info(f"  {amenity_name}: {len(listings)} listings, p50=${revenue_data['p50']:,.0f}/yr")
    
    return revenue_data


async def sync_city_data(
    db: Session,
    city_record: City,
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Sync Airbtics data for a single city.
    
    Args:
        db: Database session
        city_record: City model instance
        force_refresh: If True, ignore 6-month check
    
    Returns:
        Dict with sync results (entries_created, entries_updated, errors)
    """
    result = {
        "city": city_record.city,
        "state": city_record.state,
        "zip_code": city_record.zip_code,
        "entries_created": 0,
        "entries_updated": 0,
        "errors": []
    }
    
    city = city_record.city
    state = city_record.state
    zip_code = city_record.zip_code
    
    # Check if we have a cached market ID
    cached_market = db.query(AirbticsMarket).filter(
        AirbticsMarket.city == city,
        AirbticsMarket.state == state,
        AirbticsMarket.zip_code == zip_code if zip_code else AirbticsMarket.zip_code.is_(None)
    ).first()
    
    market_id = None
    market_name = None
    
    if cached_market:
        market_id = cached_market.market_id
        market_name = cached_market.market_name
        logger.info(f"Using cached market ID {market_id} for {city}, {state}")
    else:
        # Search for market
        logger.info(f"Searching Airbtics for market: {city}, {state}, {zip_code}")
        market_result = await search_market(city, state, zip_code)
        
        if market_result:
            market_id = market_result["market_id"]
            market_name = market_result["market_name"]
            
            # Cache the market ID
            new_market = AirbticsMarket(
                city=city,
                state=state,
                zip_code=zip_code,
                market_id=market_id,
                market_name=market_name
            )
            db.add(new_market)
            db.commit()
            logger.info(f"Cached new market ID {market_id} for {city}, {state}")
        else:
            result["errors"].append(f"Market not found for {city}, {state}")
            return result
    
    # Fetch revenue for each bedroom count
    for bedrooms in BEDROOM_RANGE:
        await asyncio.sleep(API_RATE_LIMIT_DELAY)  # Rate limiting
        
        # Check if we already have recent data
        existing = db.query(AirDNAData).filter(
            AirDNAData.city_id == city_record.id,
            AirDNAData.bedrooms_min == bedrooms,
            AirDNAData.bedrooms_max == bedrooms,
            AirDNAData.source == 'airbtics'
        ).first()
        
        if existing and not force_refresh:
            # Check if data is still fresh (< 6 months old)
            if existing.last_api_fetch:
                age = datetime.utcnow() - existing.last_api_fetch
                if age.days < REFRESH_INTERVAL_DAYS:
                    logger.debug(f"Skipping {city}, {state} {bedrooms}BR - data is fresh")
                    continue
        
        # Fetch base revenue data (no amenity filter)
        revenue_data = await fetch_revenue_metrics(market_id, bedrooms)
        
        now = datetime.utcnow()
        
        if revenue_data:
            if existing:
                # Update existing entry
                existing.average_annual_revenue = revenue_data["p50"]
                existing.revenue_p25 = revenue_data["p25"]
                existing.revenue_p50 = revenue_data["p50"]
                existing.revenue_p75 = revenue_data["p75"]
                existing.revenue_p90 = revenue_data["p90"]
                existing.airbtics_market_id = market_id
                existing.last_api_fetch = now
                existing.updated_at = now
                result["entries_updated"] += 1
            else:
                # Create new entry (base - no amenity filter)
                new_entry = AirDNAData(
                    city_id=city_record.id,
                    zip_code=zip_code,
                    bedrooms_min=bedrooms,
                    bedrooms_max=bedrooms,
                    average_annual_revenue=revenue_data["p50"],
                    revenue_p25=revenue_data["p25"],
                    revenue_p50=revenue_data["p50"],
                    revenue_p75=revenue_data["p75"],
                    revenue_p90=revenue_data["p90"],
                    source='airbtics',
                    airbtics_market_id=market_id,
                    last_api_fetch=now,
                    created_at=now,
                    updated_at=now
                )
                db.add(new_entry)
                result["entries_created"] += 1
            
            logger.info(f"Synced {city}, {state} {bedrooms}BR: p50=${revenue_data['p50']:,.0f}/yr")
        else:
            result["errors"].append(f"No base data for {bedrooms}BR")
        
        # Now fetch amenity-filtered revenue data
        for amenity_config in AMENITY_FILTERS:
            amenity_name = amenity_config["name"]
            our_field = amenity_config["our_field"]
            airbtics_filters = amenity_config["airbtics_filters"]
            
            # Check if we already have recent amenity-filtered data
            existing_amenity = db.query(AirDNAData).filter(
                AirDNAData.city_id == city_record.id,
                AirDNAData.bedrooms_min == bedrooms,
                AirDNAData.bedrooms_max == bedrooms,
                AirDNAData.source == 'airbtics',
                getattr(AirDNAData, our_field) == True
            ).first()
            
            if existing_amenity and not force_refresh:
                if existing_amenity.last_api_fetch:
                    age = datetime.utcnow() - existing_amenity.last_api_fetch
                    if age.days < REFRESH_INTERVAL_DAYS:
                        continue  # Skip, data is fresh
            
            # Fetch amenity-filtered revenue
            amenity_revenue = await fetch_amenity_filtered_revenue(
                market_id, bedrooms, amenity_name, airbtics_filters
            )
            
            if amenity_revenue:
                if existing_amenity:
                    # Update existing
                    existing_amenity.average_annual_revenue = amenity_revenue["p50"]
                    existing_amenity.revenue_p25 = amenity_revenue["p25"]
                    existing_amenity.revenue_p50 = amenity_revenue["p50"]
                    existing_amenity.revenue_p75 = amenity_revenue["p75"]
                    existing_amenity.revenue_p90 = amenity_revenue["p90"]
                    existing_amenity.last_api_fetch = now
                    existing_amenity.updated_at = now
                    result["entries_updated"] += 1
                else:
                    # Create new amenity-filtered entry
                    amenity_entry = AirDNAData(
                        city_id=city_record.id,
                        zip_code=zip_code,
                        bedrooms_min=bedrooms,
                        bedrooms_max=bedrooms,
                        average_annual_revenue=amenity_revenue["p50"],
                        revenue_p25=amenity_revenue["p25"],
                        revenue_p50=amenity_revenue["p50"],
                        revenue_p75=amenity_revenue["p75"],
                        revenue_p90=amenity_revenue["p90"],
                        source='airbtics',
                        airbtics_market_id=market_id,
                        last_api_fetch=now,
                        created_at=now,
                        updated_at=now,
                        # Set the amenity flag
                        **{our_field: True}
                    )
                    db.add(amenity_entry)
                    result["entries_created"] += 1
    
    db.commit()
    return result


async def sync_all_cities(
    db: Session,
    city_ids: Optional[List[int]] = None,
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Sync Airbtics data for all cities (or specified cities).
    
    Args:
        db: Database session
        city_ids: Optional list of city IDs to sync. If None, sync all.
        force_refresh: If True, ignore 6-month check
    
    Returns:
        Dict with overall sync results
    """
    global sync_status
    
    # Get cities to sync
    query = db.query(City)
    if city_ids:
        query = query.filter(City.id.in_(city_ids))
    cities = query.all()
    
    if not cities:
        return {
            "status": "completed",
            "message": "No cities to sync",
            "total": 0,
            "synced": 0,
            "failed": 0
        }
    
    # Update global status
    sync_status = {
        "status": "syncing",
        "total_cities": len(cities),
        "synced_cities": 0,
        "failed_cities": 0,
        "current_city": None,
        "last_sync": None,
        "message": f"Starting sync for {len(cities)} cities...",
        "errors": []
    }
    
    total_created = 0
    total_updated = 0
    failed_cities = []
    
    for city in cities:
        city_name = f"{city.city}, {city.state}"
        if city.zip_code:
            city_name += f" ({city.zip_code})"
        
        sync_status["current_city"] = city_name
        sync_status["message"] = f"Syncing {city_name}..."
        
        try:
            result = await sync_city_data(db, city, force_refresh)
            
            total_created += result["entries_created"]
            total_updated += result["entries_updated"]
            
            if result["errors"]:
                # Check if it's a complete failure (market not found)
                if any("Market not found" in e for e in result["errors"]):
                    failed_cities.append(city_name)
                    sync_status["failed_cities"] += 1
                    sync_status["errors"].extend(result["errors"])
                else:
                    sync_status["synced_cities"] += 1
            else:
                sync_status["synced_cities"] += 1
                
        except Exception as e:
            logger.error(f"Error syncing {city_name}: {e}")
            failed_cities.append(city_name)
            sync_status["failed_cities"] += 1
            sync_status["errors"].append(f"{city_name}: {str(e)}")
    
    # Final status update
    sync_status["status"] = "completed"
    sync_status["current_city"] = None
    sync_status["last_sync"] = datetime.utcnow()
    sync_status["message"] = f"Sync completed: {total_created} created, {total_updated} updated"
    
    return {
        "status": "completed",
        "total_cities": len(cities),
        "synced_cities": sync_status["synced_cities"],
        "failed_cities": sync_status["failed_cities"],
        "entries_created": total_created,
        "entries_updated": total_updated,
        "failed_city_names": failed_cities,
        "errors": sync_status["errors"]
    }


def get_sync_status() -> Dict[str, Any]:
    """Get current sync status"""
    return sync_status.copy()


def get_cities_needing_refresh(db: Session) -> List[City]:
    """Get cities that need Airbtics data refresh (>6 months old or no data)"""
    cutoff_date = datetime.utcnow() - timedelta(days=REFRESH_INTERVAL_DAYS)
    
    # Get all cities
    all_cities = db.query(City).all()
    
    cities_needing_refresh = []
    
    for city in all_cities:
        # Check if city has any Airbtics data
        airbtics_data = db.query(AirDNAData).filter(
            AirDNAData.city_id == city.id,
            AirDNAData.source == 'airbtics'
        ).first()
        
        if not airbtics_data:
            # No Airbtics data at all
            cities_needing_refresh.append(city)
        elif airbtics_data.last_api_fetch and airbtics_data.last_api_fetch < cutoff_date:
            # Data is stale
            cities_needing_refresh.append(city)
    
    return cities_needing_refresh


async def startup_sync():
    """Run sync on startup for cities needing refresh"""
    db = SessionLocal()
    try:
        api_key = get_api_key()
        if not api_key:
            logger.warning("AIRBTICS_API_KEY not set - skipping startup sync")
            return
        
        cities_to_sync = get_cities_needing_refresh(db)
        
        if cities_to_sync:
            logger.info(f"Starting Airbtics sync for {len(cities_to_sync)} cities needing refresh")
            city_ids = [c.id for c in cities_to_sync]
            await sync_all_cities(db, city_ids=city_ids)
        else:
            logger.info("All cities have fresh Airbtics data - no sync needed")
            
    except Exception as e:
        logger.error(f"Error during startup sync: {e}")
    finally:
        db.close()
