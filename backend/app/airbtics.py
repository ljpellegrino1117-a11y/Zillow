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
                # Response should be a list of markets
                markets = data if isinstance(data, list) else data.get("markets", [])
                
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
        
        # Fetch revenue data
        revenue_data = await fetch_revenue_metrics(market_id, bedrooms)
        
        if revenue_data:
            now = datetime.utcnow()
            
            if existing:
                # Update existing entry
                existing.average_annual_revenue = revenue_data["p50"]  # Use median as default
                existing.revenue_p25 = revenue_data["p25"]
                existing.revenue_p50 = revenue_data["p50"]
                existing.revenue_p75 = revenue_data["p75"]
                existing.revenue_p90 = revenue_data["p90"]
                existing.airbtics_market_id = market_id
                existing.last_api_fetch = now
                existing.updated_at = now
                result["entries_updated"] += 1
            else:
                # Create new entry
                new_entry = AirDNAData(
                    city_id=city_record.id,
                    zip_code=zip_code,
                    bedrooms_min=bedrooms,
                    bedrooms_max=bedrooms,
                    average_annual_revenue=revenue_data["p50"],  # Use median as default
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
            result["errors"].append(f"No data for {bedrooms}BR")
    
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
