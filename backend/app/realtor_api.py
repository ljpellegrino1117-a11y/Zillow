"""
Realtor.com API Client via RapidAPI

Provides reliable rental listing data with agent contact information.
Replaces the fragile Zillow scraper approach.
"""

import httpx
import asyncio
import logging
import os
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# RapidAPI configuration
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com"
BASE_URL = "https://realty-in-us.p.rapidapi.com"

# Rate limiting
API_RATE_LIMIT_DELAY = 0.5  # seconds between requests
MAX_RETRIES = 3


def get_headers() -> Dict[str, str]:
    """Get headers for RapidAPI requests"""
    if not RAPIDAPI_KEY:
        raise ValueError("RAPIDAPI_KEY environment variable not set")
    
    return {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    }


async def search_rentals(
    city: str,
    state_code: str,
    min_beds: int = 3,
    max_beds: int = 8,
    limit: int = 200,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Search for rental listings in a city.
    
    Args:
        city: City name (e.g., "Austin")
        state_code: State code (e.g., "TX")
        min_beds: Minimum bedrooms
        max_beds: Maximum bedrooms
        limit: Max results per request (max 200)
        offset: Pagination offset
    
    Returns:
        Dict with 'listings' and 'total_count'
    """
    if not RAPIDAPI_KEY:
        logger.warning("RAPIDAPI_KEY not configured - returning empty results")
        return {"listings": [], "total_count": 0, "error": "API key not configured"}
    
    url = f"{BASE_URL}/properties/v3/list"
    
    # Build payload for realty-in-us API
    # Filter by property type to get listings with actual prices
    # (apartment complexes often lack unit-level pricing)
    payload = {
        "limit": limit,
        "offset": offset,
        "city": city,
        "state_code": state_code.upper(),
        "status": ["for_rent"],
        "type": ["single_family", "condos", "townhomes", "duplex_triplex", "multi_family"],
        "beds_min": min_beds,
        "beds_max": max_beds,
        "sort": {"direction": "desc", "field": "list_date"}
    }
    
    headers = get_headers()
    headers["Content-Type"] = "application/json"
    
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    data = response.json()
                    # Parse response from realty-in-us API (uses .results not .properties)
                    results = data.get("data", {}).get("home_search", {}).get("results", [])
                    total = data.get("data", {}).get("home_search", {}).get("total", 0)
                    if not total:
                        total = data.get("data", {}).get("home_search", {}).get("count", len(results))
                    
                    listings = []
                    for result in results:
                        listing = parse_listing(result)
                        if listing:
                            listings.append(listing)
                    
                    logger.info(f"Found {len(listings)} rentals in {city}, {state_code}")
                    return {
                        "listings": listings,
                        "total_count": total,
                        "offset": offset
                    }
                
                elif response.status_code == 429:
                    # Rate limited
                    wait_time = (attempt + 1) * 2
                    logger.warning(f"Rate limited, waiting {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                elif response.status_code in [401, 403]:
                    logger.error(f"Authentication error: {response.status_code}")
                    return {"listings": [], "total_count": 0, "error": "Authentication failed"}
                
                else:
                    logger.error(f"API error {response.status_code}: {response.text[:200]}")
                    
        except httpx.TimeoutException:
            logger.warning(f"Timeout on attempt {attempt + 1}")
            await asyncio.sleep(API_RATE_LIMIT_DELAY)
        except Exception as e:
            logger.error(f"Request error: {str(e)}")
            await asyncio.sleep(API_RATE_LIMIT_DELAY)
    
    return {"listings": [], "total_count": 0, "error": "Max retries exceeded"}


def parse_listing(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse a single listing from the API response.
    
    Extracts all relevant fields including agent contact info.
    Compatible with realty-in-us.p.rapidapi.com response format.
    """
    try:
        location = data.get("location", {})
        address = location.get("address", {})
        description = data.get("description", {})
        
        # Extract photos - realty-in-us uses primary_photo object
        photos = []
        primary_photo = data.get("primary_photo", {})
        if primary_photo and primary_photo.get("href"):
            photos.append(primary_photo.get("href"))
        
        # Basic listing info
        listing = {
            "property_id": data.get("property_id"),
            "listing_id": data.get("listing_id"),
            "address": address.get("line", ""),
            "city": address.get("city", ""),
            "state": address.get("state_code", ""),
            "zip_code": address.get("postal_code", ""),
            "bedrooms": description.get("beds") or 0,
            "bathrooms": description.get("baths") or 0,
            "sqft": description.get("sqft"),
            "price": data.get("list_price"),
            "property_type": description.get("type", ""),
            "year_built": description.get("year_built"),
            "lot_sqft": description.get("lot_sqft"),
            # realty-in-us API returns href directly as full URL
            "url": data.get("href"),
            "photos": photos,
            "list_date": data.get("list_date"),
        }
        
        # Agent/Advertiser info - realty-in-us uses advertisers array
        advertisers = data.get("advertisers", [])
        if advertisers:
            agent = advertisers[0]
            listing["agent_name"] = agent.get("name")
            listing["agent_email"] = agent.get("email")
            listing["agent_company"] = agent.get("office", {}).get("name") if agent.get("office") else None
            
            # Phone numbers (if available in API response)
            phones = agent.get("phones", [])
            if phones:
                listing["agent_phone"] = phones[0].get("number")
            else:
                listing["agent_phone"] = None
        else:
            listing["agent_name"] = None
            listing["agent_email"] = None
            listing["agent_company"] = None
            listing["agent_phone"] = None
        
        # Branding info as fallback for company name
        branding = data.get("branding", [])
        if branding and not listing.get("agent_company"):
            listing["agent_company"] = branding[0].get("name")
        
        # Source/MLS agent info as additional fallback
        source = data.get("source", {})
        source_agents = source.get("agents", [])
        if source_agents and not listing.get("agent_name"):
            listing["agent_name"] = source_agents[0].get("agent_name")
            if not listing.get("agent_company"):
                listing["agent_company"] = source_agents[0].get("office_name")
        
        # Features/Amenities from tags
        features = data.get("tags", []) or []
        listing["features"] = features
        
        # Parse amenities from features
        features_lower = [f.lower() for f in features if f]
        listing["has_pool"] = any("pool" in f for f in features_lower)
        listing["has_garage"] = any("garage" in f for f in features_lower)
        listing["has_waterfront"] = any(
            w in f for f in features_lower 
            for w in ["waterfront", "water view", "lake", "ocean", "beach"]
        )
        listing["has_basement"] = any("basement" in f for f in features_lower)
        listing["has_ac"] = any(
            w in f for f in features_lower 
            for w in ["air conditioning", "central air", "a/c"]
        )
        listing["has_fireplace"] = any("fireplace" in f for f in features_lower)
        listing["has_yard"] = any(
            w in f for f in features_lower 
            for w in ["yard", "backyard", "fenced"]
        )
        
        # Pet policy
        pet_policy = data.get("pet_policy", {})
        if pet_policy:
            listing["allows_cats"] = pet_policy.get("cats", False)
            listing["allows_dogs"] = pet_policy.get("dogs", False)
        
        # Flags for listing status
        flags = data.get("flags", {})
        if flags:
            listing["is_new_listing"] = flags.get("is_new_listing", False)
            listing["is_price_reduced"] = flags.get("is_price_reduced", False)
        
        # Validate required fields - for rentals, price is the key field
        if not listing["address"] or not listing["price"]:
            return None
        
        return listing
        
    except Exception as e:
        logger.error(f"Error parsing listing: {str(e)}")
        return None


async def search_all_rentals(
    city: str,
    state_code: str,
    min_beds: int = 3,
    max_beds: int = 8,
    max_listings: int = 500,
) -> List[Dict[str, Any]]:
    """
    Search for all rental listings in a city, handling pagination.
    
    Args:
        city: City name
        state_code: State code
        min_beds: Minimum bedrooms
        max_beds: Maximum bedrooms
        max_listings: Maximum total listings to fetch
    
    Returns:
        List of all listings
    """
    all_listings = []
    offset = 0
    limit = 200  # Max per request
    
    while len(all_listings) < max_listings:
        result = await search_rentals(
            city=city,
            state_code=state_code,
            min_beds=min_beds,
            max_beds=max_beds,
            limit=limit,
            offset=offset
        )
        
        if result.get("error"):
            logger.error(f"Search error: {result['error']}")
            break
        
        listings = result.get("listings", [])
        if not listings:
            break
        
        all_listings.extend(listings)
        
        total = result.get("total_count", 0)
        offset += len(listings)
        
        # Stop if we've fetched all available
        if offset >= total:
            break
        
        # Rate limiting
        await asyncio.sleep(API_RATE_LIMIT_DELAY)
    
    logger.info(f"Total listings fetched for {city}, {state_code}: {len(all_listings)}")
    return all_listings[:max_listings]


async def search_rentals_by_zip(
    zip_code: str,
    min_beds: int = 3,
    max_beds: int = 8,
    limit: int = 200,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Search for rental listings by zip code.
    
    Args:
        zip_code: ZIP code (e.g., "78701")
        min_beds: Minimum bedrooms
        max_beds: Maximum bedrooms
        limit: Max results per request (max 200)
        offset: Pagination offset
    
    Returns:
        Dict with 'listings' and 'total_count'
    """
    if not RAPIDAPI_KEY:
        logger.warning("RAPIDAPI_KEY not configured - returning empty results")
        return {"listings": [], "total_count": 0, "error": "API key not configured"}
    
    url = f"{BASE_URL}/properties/v3/list"
    
    # Build payload for realty-in-us API with zip code
    # Filter by property type to get listings with actual prices
    payload = {
        "limit": limit,
        "offset": offset,
        "postal_code": zip_code,
        "status": ["for_rent"],
        "type": ["single_family", "condos", "townhomes", "duplex_triplex", "multi_family"],
        "beds_min": min_beds,
        "beds_max": max_beds,
        "sort": {"direction": "desc", "field": "list_date"}
    }
    
    headers = get_headers()
    headers["Content-Type"] = "application/json"
    
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    data = response.json()
                    # Parse response from realty-in-us API (uses .results not .properties)
                    results = data.get("data", {}).get("home_search", {}).get("results", [])
                    total = data.get("data", {}).get("home_search", {}).get("total", 0)
                    if not total:
                        total = data.get("data", {}).get("home_search", {}).get("count", len(results))
                    
                    listings = []
                    for result in results:
                        listing = parse_listing(result)
                        if listing:
                            listings.append(listing)
                    
                    logger.info(f"Found {len(listings)} rentals in zip code {zip_code}")
                    return {
                        "listings": listings,
                        "total_count": total,
                        "offset": offset
                    }
                
                elif response.status_code == 429:
                    wait_time = (attempt + 1) * 2
                    logger.warning(f"Rate limited, waiting {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                
                elif response.status_code in [401, 403]:
                    logger.error(f"Authentication error: {response.status_code}")
                    return {"listings": [], "total_count": 0, "error": "Authentication failed"}
                
                else:
                    logger.error(f"API error {response.status_code}: {response.text[:200]}")
                    
        except httpx.TimeoutException:
            logger.warning(f"Timeout on attempt {attempt + 1}")
            await asyncio.sleep(API_RATE_LIMIT_DELAY)
        except Exception as e:
            logger.error(f"Request error: {str(e)}")
            await asyncio.sleep(API_RATE_LIMIT_DELAY)
    
    return {"listings": [], "total_count": 0, "error": "Max retries exceeded"}


async def search_all_rentals_by_zip(
    zip_code: str,
    min_beds: int = 3,
    max_beds: int = 8,
    max_listings: int = 500,
) -> List[Dict[str, Any]]:
    """
    Search for all rental listings in a zip code, handling pagination.
    
    Args:
        zip_code: ZIP code
        min_beds: Minimum bedrooms
        max_beds: Maximum bedrooms
        max_listings: Maximum total listings to fetch
    
    Returns:
        List of all listings
    """
    all_listings = []
    offset = 0
    limit = 200
    
    while len(all_listings) < max_listings:
        result = await search_rentals_by_zip(
            zip_code=zip_code,
            min_beds=min_beds,
            max_beds=max_beds,
            limit=limit,
            offset=offset
        )
        
        if result.get("error"):
            logger.error(f"Search error: {result['error']}")
            break
        
        listings = result.get("listings", [])
        if not listings:
            break
        
        all_listings.extend(listings)
        
        total = result.get("total_count", 0)
        offset += len(listings)
        
        if offset >= total:
            break
        
        await asyncio.sleep(API_RATE_LIMIT_DELAY)
    
    logger.info(f"Total listings fetched for zip {zip_code}: {len(all_listings)}")
    return all_listings[:max_listings]


async def get_listing_details(property_id: str) -> Optional[Dict[str, Any]]:
    """
    Get detailed information about a specific property.
    
    Args:
        property_id: The property ID from search results
    
    Returns:
        Detailed listing information
    """
    if not RAPIDAPI_KEY:
        return None
    
    url = f"{BASE_URL}/properties/v3/detail"
    
    params = {
        "property_id": property_id
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                headers=get_headers(),
                params=params
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("data", {}).get("home", {})
            else:
                logger.error(f"Detail fetch error {response.status_code}")
                return None
                
    except Exception as e:
        logger.error(f"Error fetching listing details: {str(e)}")
        return None


def is_configured() -> bool:
    """Check if the API is properly configured"""
    return bool(RAPIDAPI_KEY)


async def test_connection() -> Dict[str, Any]:
    """
    Test the API connection with a simple search.
    
    Returns status and any error messages.
    """
    if not RAPIDAPI_KEY:
        return {
            "status": "error",
            "message": "RAPIDAPI_KEY not configured",
            "configured": False
        }
    
    try:
        result = await search_rentals(
            city="Austin",
            state_code="TX",
            min_beds=3,
            max_beds=4,
            limit=1
        )
        
        if result.get("error"):
            return {
                "status": "error",
                "message": result["error"],
                "configured": True
            }
        
        return {
            "status": "ok",
            "message": f"Connected successfully. Test found {result['total_count']} listings.",
            "configured": True,
            "sample_count": result["total_count"]
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "configured": True
        }
