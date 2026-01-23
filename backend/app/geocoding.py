"""
Geocoding utilities for finding cities within a radius.

Uses the free Nominatim (OpenStreetMap) API for geocoding.
"""

import httpx
import math
from typing import Optional, Tuple, List, Dict
import logging
import asyncio

logger = logging.getLogger(__name__)

# Cache for geocoding results to avoid repeated API calls
_geocode_cache: Dict[str, Tuple[float, float]] = {}


async def geocode_city(city: str, state: str) -> Optional[Tuple[float, float]]:
    """
    Get latitude and longitude for a city.
    
    Args:
        city: City name
        state: State abbreviation (e.g., "IL", "FL")
        
    Returns:
        Tuple of (latitude, longitude) or None if not found
    """
    cache_key = f"{city.lower()}_{state.lower()}"
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]
    
    # Use Nominatim (OpenStreetMap) free geocoding API
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": f"{city}, {state}, USA",
        "format": "json",
        "limit": 1,
    }
    headers = {
        "User-Agent": "ZillowArbitrageApp/1.0"  # Required by Nominatim
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, headers=headers, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            
            if data and len(data) > 0:
                lat = float(data[0]["lat"])
                lon = float(data[0]["lon"])
                _geocode_cache[cache_key] = (lat, lon)
                logger.info(f"Geocoded {city}, {state}: ({lat}, {lon})")
                return (lat, lon)
            
            logger.warning(f"No geocoding results for {city}, {state}")
            return None
            
    except Exception as e:
        logger.error(f"Geocoding error for {city}, {state}: {e}")
        return None


def calculate_bounding_box(
    lat: float, 
    lon: float, 
    radius_miles: float
) -> Tuple[float, float, float, float]:
    """
    Calculate a bounding box around a point.
    
    Args:
        lat: Center latitude
        lon: Center longitude
        radius_miles: Radius in miles
        
    Returns:
        Tuple of (south, west, north, east) coordinates
    """
    # Earth's radius in miles
    earth_radius = 3959
    
    # Convert radius to degrees
    # 1 degree latitude ≈ 69 miles
    lat_delta = radius_miles / 69
    
    # 1 degree longitude varies by latitude
    # At equator ≈ 69 miles, decreases toward poles
    lon_delta = radius_miles / (69 * math.cos(math.radians(lat)))
    
    south = lat - lat_delta
    north = lat + lat_delta
    west = lon - lon_delta
    east = lon + lon_delta
    
    return (south, west, north, east)


def calculate_donut_boxes(
    lat: float,
    lon: float,
    inner_radius_miles: float,
    outer_radius_miles: float
) -> List[Tuple[float, float, float, float]]:
    """
    Calculate bounding boxes for a "donut" shape (outer ring, excluding center).
    
    This returns 4 rectangular boxes that approximate a ring around the center,
    useful for searching surrounding areas while excluding the main city.
    
    Args:
        lat: Center latitude
        lon: Center longitude
        inner_radius_miles: Inner radius (area to exclude)
        outer_radius_miles: Outer radius (max search distance)
        
    Returns:
        List of 4 bounding boxes (south, west, north, east) for the ring
    """
    # For simplicity, we'll just use the outer bounding box
    # and filter results by actual distance later
    # This is because Zillow doesn't support donut-shaped searches
    outer_box = calculate_bounding_box(lat, lon, outer_radius_miles)
    return [outer_box]


async def get_nearby_cities(
    city: str,
    state: str,
    radius_miles: int,
    exclude_center: bool = False
) -> List[Dict[str, str]]:
    """
    Get a list of cities within a radius.
    
    Note: This uses OpenStreetMap's Nominatim API to find nearby places.
    For better results, consider using a commercial API.
    
    Args:
        city: Center city name
        state: State abbreviation
        radius_miles: Search radius
        exclude_center: If True, exclude the center city
        
    Returns:
        List of dicts with 'city' and 'state' keys
    """
    coords = await geocode_city(city, state)
    if not coords:
        return [{"city": city, "state": state}] if not exclude_center else []
    
    lat, lon = coords
    south, west, north, east = calculate_bounding_box(lat, lon, radius_miles)
    
    # Use Overpass API to find cities/towns in the bounding box
    # This is a more reliable way to find nearby places
    overpass_url = "https://overpass-api.de/api/interpreter"
    
    # Query for cities and towns in the bounding box
    query = f"""
    [out:json][timeout:25];
    (
      node["place"~"city|town|village"]({south},{west},{north},{east});
    );
    out body;
    """
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                overpass_url,
                data={"data": query},
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            cities = []
            center_city_lower = city.lower()
            
            for element in data.get("elements", []):
                tags = element.get("tags", {})
                place_name = tags.get("name", "")
                
                if not place_name:
                    continue
                
                # Skip the center city if requested
                if exclude_center and place_name.lower() == center_city_lower:
                    continue
                
                # Calculate distance from center
                place_lat = element.get("lat", 0)
                place_lon = element.get("lon", 0)
                distance = haversine_distance(lat, lon, place_lat, place_lon)
                
                if distance <= radius_miles:
                    cities.append({
                        "city": place_name,
                        "state": state,  # Assume same state for nearby cities
                        "distance": round(distance, 1)
                    })
            
            # Sort by distance
            cities.sort(key=lambda x: x.get("distance", 0))
            
            # Add center city at the beginning if not excluded
            if not exclude_center:
                cities.insert(0, {"city": city, "state": state, "distance": 0})
            
            logger.info(f"Found {len(cities)} cities within {radius_miles} miles of {city}, {state}")
            return cities
            
    except Exception as e:
        logger.error(f"Error finding nearby cities: {e}")
        # Fallback to just the center city
        return [{"city": city, "state": state}] if not exclude_center else []


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth.
    
    Args:
        lat1, lon1: First point coordinates
        lat2, lon2: Second point coordinates
        
    Returns:
        Distance in miles
    """
    R = 3959  # Earth's radius in miles
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_lat / 2) ** 2 + 
         math.cos(lat1_rad) * math.cos(lat2_rad) * 
         math.sin(delta_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def build_zillow_map_url(
    south: float,
    west: float, 
    north: float,
    east: float,
    bedrooms: int,
    listing_type: str = 'rental'
) -> str:
    """
    Build a Zillow search URL using map bounds.
    
    Args:
        south, west, north, east: Bounding box coordinates
        bedrooms: Number of bedrooms
        listing_type: 'rental' or 'for_sale'
        
    Returns:
        Zillow search URL
    """
    # Zillow uses a specific URL format for map searches
    # The searchQueryState parameter contains the map bounds
    import json
    import urllib.parse
    
    if listing_type == 'for_sale':
        base = "https://www.zillow.com/homes/"
        filter_state = {
            "isForSaleByAgent": {"value": True},
            "isForSaleByOwner": {"value": True},
            "isNewConstruction": {"value": False},
            "isComingSoon": {"value": False},
            "isAuction": {"value": False},
            "isForSaleForeclosure": {"value": True},
        }
    else:
        base = "https://www.zillow.com/homes/for_rent/"
        filter_state = {
            "isForRent": {"value": True},
        }
    
    filter_state["beds"] = {"min": bedrooms, "max": bedrooms}
    
    search_state = {
        "mapBounds": {
            "north": north,
            "south": south,
            "east": east,
            "west": west,
        },
        "filterState": filter_state,
        "isListVisible": True,
        "isMapVisible": True,
    }
    
    encoded = urllib.parse.quote(json.dumps(search_state))
    return f"{base}?searchQueryState={encoded}"
