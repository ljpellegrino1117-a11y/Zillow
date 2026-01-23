"""
Zillow Scraper using ScraperAPI

This scraper uses ScraperAPI (https://www.scraperapi.com) to handle:
- JavaScript rendering
- Proxy rotation
- CAPTCHA solving
- Rate limiting

You'll need a ScraperAPI key. Sign up at https://www.scraperapi.com for a free tier (5,000 credits).
Set your API key in the SCRAPER_API_KEY environment variable.
"""

import asyncio
import re
import json
import os
from typing import List, Dict, Any, Optional, Callable
import httpx
from bs4 import BeautifulSoup
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get API key from environment variable
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
SCRAPER_API_URL = "https://api.scraperapi.com/"


# Amenity detection patterns
AMENITY_PATTERNS = {
    'has_pool': [
        r'\bpool\b', r'\bswimming\b', r'\bswim\b'
    ],
    'has_hot_tub': [
        r'\bhot\s*tub\b', r'\bjacuzzi\b', r'\bspa\b', r'\bwhirlpool\b', r'\bjetted\s*tub\b'
    ],
    'has_waterfront': [  # Combined waterfront AND waterview
        r'\bwater\s*view\b', r'\bwaterview\b', r'\bocean\s*view\b', r'\blake\s*view\b',
        r'\briver\s*view\b', r'\bbay\s*view\b', r'\bsea\s*view\b', r'\bbeach\s*view\b',
        r'\bwaterfront\b', r'\bwater\s*front\b', r'\boceanfront\b', r'\blakefront\b',
        r'\briverfront\b', r'\bbeachfront\b', r'\bbayfront\b'
    ],
    'has_basement': [
        r'\bbasement\b'
    ],
    'has_unfinished_basement': [
        r'\bunfinished\s*basement\b', r'\bbasement\s*unfinished\b',
        r'\bpartially\s*finished\s*basement\b', r'\braw\s*basement\b'
    ],
    'has_finished_basement': [
        r'\bfinished\s*basement\b', r'\bbasement\s*finished\b',
        r'\bfully\s*finished\s*basement\b', r'\bcompleted\s*basement\b'
    ],
    'has_garage': [
        r'\bgarage\b', r'\bcar\s*garage\b', r'\bparking\s*garage\b'
    ],
    'has_parking': [
        r'\bparking\b', r'\bdriveway\b', r'\bcarport\b', r'\bcar\s*port\b'
    ],
    'has_laundry': [
        r'\blaundry\b', r'\bwasher\b', r'\bdryer\b', r'\bw/d\b', r'\bwasher/dryer\b'
    ],
    'has_ac': [
        r'\ba/?c\b', r'\bair\s*condition', r'\bcentral\s*air\b', r'\bcooling\b', r'\bhvac\b'
    ],
    'has_fireplace': [
        r'\bfireplace\b', r'\bfire\s*place\b', r'\bwood\s*burning\b'
    ],
    'has_yard': [
        r'\byard\b', r'\bbackyard\b', r'\bback\s*yard\b', r'\bfront\s*yard\b', 
        r'\bfenced\s*yard\b', r'\bprivate\s*yard\b'
    ],
    'has_patio': [
        r'\bpatio\b', r'\bdeck\b', r'\bterrace\b', r'\boutdoor\s*space\b'
    ],
    'has_balcony': [
        r'\bbalcony\b', r'\bbalconies\b'
    ],
    'has_gym': [
        r'\bgym\b', r'\bfitness\b', r'\bexercise\s*room\b', r'\bworkout\b'
    ],
    'has_pet_friendly': [
        r'\bpet\s*friendly\b', r'\bpets\s*allowed\b', r'\bpets\s*ok\b',
        r'\bdog\s*friendly\b', r'\bcat\s*friendly\b', r'\bpets\s*welcome\b'
    ],
}

# Extra rooms that could potentially be used as bedrooms
# Each pattern maps to a room type and whether it counts as a potential bedroom
EXTRA_ROOM_PATTERNS = {
    'has_office': {
        'patterns': [
            r'\boffice\b', r'\bhome\s*office\b', r'\bwork\s*from\s*home\b',
            r'\bwfh\s*space\b', r'\bremote\s*work\b'
        ],
        'label': 'Office',
        'counts_as_bedroom': True
    },
    'has_den': {
        'patterns': [
            r'\bden\b', r'\bstudy\b', r'\blibrary\b', r'\breading\s*room\b',
            r'\bprivate\s*room\b', r'\bsitting\s*room\b', r'\bparlor\b',
            r'\bparlour\b', r'\bmorning\s*room\b', r'\bkeeping\s*room\b'
        ],
        'label': 'Den/Study',
        'counts_as_bedroom': True
    },
    'has_bonus_room': {
        'patterns': [
            r'\bbonus\s*room\b', r'\bbonus\s*space\b', r'\bextra\s*room\b',
            r'\badditional\s*room\b', r'\bspare\s*room\b', r'\b4th\s*room\b',
            r'\b5th\s*room\b', r'\b6th\s*room\b', r'\bfourth\s*room\b',
            r'\bfifth\s*room\b', r'\bsixth\s*room\b', r'\bextra\s*space\b',
            r'\badditional\s*space\b', r'\bversatile\s*room\b',
            r'\bpossible\s*(?:4th|5th|fourth|fifth)\s*(?:bed)?(?:room)?\b',
            r'\bcould\s*be\s*(?:a\s*)?(?:bed)?room\b', r'\bpotential\s*bedroom\b'
        ],
        'label': 'Bonus Room',
        'counts_as_bedroom': True
    },
    'has_loft': {
        'patterns': [
            r'\bloft\b', r'\bloft\s*space\b', r'\bloft\s*area\b',
            r'\bmezzanine\b', r'\bupper\s*level\s*(?:open|loft)\b'
        ],
        'label': 'Loft',
        'counts_as_bedroom': True
    },
    'has_flex_space': {
        'patterns': [
            r'\bflex\s*space\b', r'\bflex\s*room\b', r'\bmulti-?purpose\b',
            r'\bversatile\s*space\b', r'\bconvertible\b', r'\bmultiple\s*uses\b',
            r'\buse\s*as\s*(?:you\s*)?(?:like|wish|want)\b'
        ],
        'label': 'Flex Space',
        'counts_as_bedroom': True
    },
    'has_sunroom': {
        'patterns': [
            r'\bsunroom\b', r'\bsun\s*room\b', r'\bsolarium\b', 
            r'\bflorida\s*room\b', r'\bconservatory\b', r'\benclosed\s*porch\b',
            r'\bthree[\s-]?season\b', r'\b3[\s-]?season\b', r'\bfour[\s-]?season\b',
            r'\b4[\s-]?season\b', r'\bscreened\s*(?:in\s*)?(?:room|porch)\b'
        ],
        'label': 'Sunroom',
        'counts_as_bedroom': True
    },
    'has_media_room': {
        'patterns': [
            r'\bmedia\s*room\b', r'\btheater\s*room\b', r'\btheatre\s*room\b',
            r'\bhome\s*theater\b', r'\bmovie\s*room\b', r'\bscreening\s*room\b',
            r'\btv\s*room\b', r'\btelevision\s*room\b'
        ],
        'label': 'Media Room',
        'counts_as_bedroom': True
    },
    'has_game_room': {
        'patterns': [
            r'\bgame\s*room\b', r'\brec\s*room\b', r'\brecreation\s*room\b',
            r'\bplay\s*room\b', r'\bplayroom\b', r'\bentertainment\s*room\b',
            r'\bman\s*cave\b', r'\bshe\s*shed\b', r'\bhang\s*out\b'
        ],
        'label': 'Game/Rec Room',
        'counts_as_bedroom': True
    },
    'has_guest_room': {
        'patterns': [
            r'\bguest\s*room\b', r'\bguest\s*suite\b', r'\bguest\s*quarters\b'
        ],
        'label': 'Guest Room',
        'counts_as_bedroom': False  # Already counted as bedroom usually
    },
    'has_nursery': {
        'patterns': [
            r'\bnursery\b', r'\bbaby\s*room\b', r"\bchild(?:ren)?'?s?\s*room\b"
        ],
        'label': 'Nursery',
        'counts_as_bedroom': False  # Already counted as bedroom usually
    },
    'has_studio': {
        'patterns': [
            r'\bstudio\s*space\b', r'\bart\s*studio\b', r'\bmusic\s*studio\b',
            r'\bcraft\s*room\b', r'\bhobby\s*room\b', r'\bworkshop\b',
            r'\bsewing\s*room\b', r'\bexercise\s*room\b'
        ],
        'label': 'Studio/Hobby Room',
        'counts_as_bedroom': True
    },
    'has_attic': {
        'patterns': [
            r'\bfinished\s*attic\b', r'\battic\s*space\b', r'\battic\s*room\b',
            r'\bconverted\s*attic\b', r'\busable\s*attic\b', r'\bwalk[\s-]?up\s*attic\b',
            r'\battic\s*(?:bed)?room\b'
        ],
        'label': 'Finished Attic',
        'counts_as_bedroom': True
    },
    'has_mother_in_law': {
        'patterns': [
            r'\bmother[\s-]?in[\s-]?law\b', r'\bin[\s-]?law\s*suite\b',
            r'\bguest\s*house\b', r'\bgranny\s*flat\b', r'\badu\b',
            r'\baccessory\s*dwelling\b', r'\bseparate\s*living\b',
            r'\bcarriage\s*house\b', r'\bpool\s*house\b', r'\bcasita\b',
            r'\bdetached\s*(?:unit|suite|apartment)\b', r'\bsecond\s*(?:unit|suite)\b',
            r'\brental\s*unit\b', r'\bincome\s*(?:unit|property|potential)\b'
        ],
        'label': 'In-Law Suite/ADU',
        'counts_as_bedroom': True
    },
}

# Creative financing keywords for for-sale listings
CREATIVE_FINANCING_PATTERNS = [
    r'\bowner\s*financ(?:e|ing)\b', r'\bseller\s*financ(?:e|ing)\b',
    r'\brent[\s-]?to[\s-]?own\b', r'\blease[\s-]?(?:to[\s-]?)?(?:own|option|purchase)\b',
    r'\bcreative\s*financ(?:e|ing)\b', r'\bseller\s*motivated\b',
    r'\bmotivated\s*seller\b', r'\bflexible\s*(?:terms|financing)\b',
    r'\bwill\s*(?:consider|carry)\b', r'\bcarry\s*(?:back|the\s*note)\b',
    r'\bno\s*(?:bank|credit)\s*(?:needed|required|check)\b',
    r'\bsubject[\s-]?to\b', r'\bassumable\s*(?:loan|mortgage)\b',
    r'\bwrap(?:around)?\s*(?:mortgage|loan)\b', r'\bcontract\s*for\s*deed\b',
    r'\bland\s*contract\b', r'\binstallment\s*(?:sale|contract)\b',
    r'\bbond\s*for\s*(?:deed|title)\b', r'\bequity\s*share\b',
    r'\bmaster\s*lease\b', r'\bsandwich\s*lease\b',
    r'\bmake\s*(?:an?\s*)?offer\b', r'\bwill\s*negotiate\b',
    r'\bbring\s*(?:all\s*)?offers\b', r'\ball\s*offers\s*(?:considered|welcome)\b',
    r'\bmust\s*sell\b', r'\bquick\s*sale\b', r'\bprice\s*reduced\b',
    r'\bdesperate\b', r'\brelocating\b', r'\bdivorce\b',
]


def detect_amenities(description: str, amenities_list: List[str] = None) -> Dict[str, bool]:
    """
    Detect amenities from description text and amenities list.
    
    Args:
        description: Property description text
        amenities_list: List of amenities from the listing
        
    Returns:
        Dict of amenity flags
    """
    # Combine description and amenities into one searchable text
    text_parts = []
    if description:
        text_parts.append(description)
    if amenities_list:
        text_parts.extend(amenities_list)
    
    combined_text = ' '.join(text_parts).lower()
    
    results = {}
    for amenity_key, patterns in AMENITY_PATTERNS.items():
        found = False
        for pattern in patterns:
            if re.search(pattern, combined_text, re.IGNORECASE):
                found = True
                break
        results[amenity_key] = found
    
    # Special logic: if basement is found but neither finished nor unfinished specified
    # it could be either, so we just mark has_basement
    if results.get('has_basement'):
        # If unfinished patterns found, mark unfinished
        # If finished patterns found, mark finished
        # has_basement stays true either way
        pass
    
    return results


def detect_extra_rooms(description: str, amenities_list: List[str] = None, bedrooms: int = 0) -> Dict[str, Any]:
    """
    Detect extra rooms that could potentially be used as bedrooms.
    Scans description and amenities for office, den, loft, bonus room, etc.
    
    Args:
        description: Property description text
        amenities_list: List of amenities from the listing
        bedrooms: Listed bedroom count
        
    Returns:
        Dict with extra room flags, count, and potential bedrooms
    """
    # Combine description and amenities into one searchable text
    text_parts = []
    if description:
        text_parts.append(description)
    if amenities_list:
        text_parts.extend(amenities_list)
    
    combined_text = ' '.join(text_parts).lower()
    
    results = {}
    extra_rooms_found = []
    extra_bedroom_count = 0
    
    for room_key, room_config in EXTRA_ROOM_PATTERNS.items():
        found = False
        for pattern in room_config['patterns']:
            if re.search(pattern, combined_text, re.IGNORECASE):
                found = True
                break
        
        results[room_key] = found
        
        if found:
            extra_rooms_found.append(room_config['label'])
            if room_config['counts_as_bedroom']:
                extra_bedroom_count += 1
    
    # Add summary fields
    results['extra_rooms_count'] = extra_bedroom_count
    results['extra_rooms_details'] = json.dumps(extra_rooms_found) if extra_rooms_found else None
    results['potential_bedrooms'] = bedrooms + extra_bedroom_count
    
    return results


def detect_creative_financing(description: str) -> Dict[str, Any]:
    """
    Detect if a listing mentions creative financing options.
    Used to identify for-sale listings that could be acquired creatively.
    
    Args:
        description: Property description text
        
    Returns:
        Dict with creative financing flag and matched keywords
    """
    if not description:
        return {'has_creative_financing': False, 'financing_keywords': None}
    
    text = description.lower()
    matched_keywords = []
    
    for pattern in CREATIVE_FINANCING_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            matched_keywords.append(match.group(0).strip())
    
    # Remove duplicates while preserving order
    matched_keywords = list(dict.fromkeys(matched_keywords))
    
    return {
        'has_creative_financing': len(matched_keywords) > 0,
        'financing_keywords': json.dumps(matched_keywords) if matched_keywords else None
    }


class ZillowScraperAPI:
    """
    Scrapes Zillow rental listings using ScraperAPI.
    
    ScraperAPI handles all the hard parts:
    - JavaScript rendering (Zillow loads data dynamically)
    - Rotating proxies (avoid IP bans)
    - CAPTCHA solving (bypass bot detection)
    - Automatic retries
    
    Performance optimizations:
    - Concurrent bedroom count scraping
    - Concurrent page fetching within limits
    - Reduced delays between requests
    """
    
    # Concurrency settings
    MAX_CONCURRENT_REQUESTS = 5  # Max simultaneous requests to ScraperAPI
    MAX_CONCURRENT_BEDROOMS = 3  # Scrape this many bedroom counts at once
    
    def __init__(
        self, 
        api_key: Optional[str] = None,
        on_listing_found: Optional[Callable[[Dict], None]] = None
    ):
        self.api_key = api_key or SCRAPER_API_KEY
        if not self.api_key:
            raise ValueError(
                "ScraperAPI key required. Set SCRAPER_API_KEY environment variable "
                "or pass api_key parameter. Sign up at https://www.scraperapi.com"
            )
        self.on_listing_found = on_listing_found
        self.client: Optional[httpx.AsyncClient] = None
        self.semaphore: Optional[asyncio.Semaphore] = None
    
    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=60.0)
        self.semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_REQUESTS)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
    
    def _build_zillow_url(self, city: str, state: str, bedrooms: int, page: int = 1, listing_type: str = 'rental', zip_code: str = None) -> str:
        """Build Zillow search URL for a city or zip code.
        
        Args:
            city: City name
            state: State abbreviation
            bedrooms: Number of bedrooms to filter
            page: Page number
            listing_type: 'rental' or 'for_sale'
            zip_code: Optional zip code to narrow search
        """
        # If zip code is provided, use zip-based URL
        if zip_code:
            if listing_type == 'for_sale':
                base = f"https://www.zillow.com/{zip_code}/"
            else:
                base = f"https://www.zillow.com/{zip_code}/rentals/"
            if bedrooms:
                base += f"{bedrooms}-bedrooms/"
        else:
            # Format: city-state (e.g., "chicago-il", "miami-fl")
            city_slug = city.lower().replace(' ', '-')
            state_slug = state.lower()
            
            if listing_type == 'for_sale':
                # For sale listings
                base = f"https://www.zillow.com/{city_slug}-{state_slug}/"
                if bedrooms:
                    base += f"{bedrooms}-bedrooms/"
            else:
                # Rental listings
                base = f"https://www.zillow.com/{city_slug}-{state_slug}/rentals/"
                if bedrooms:
                    base += f"{bedrooms}-bedrooms/"
        
        if page > 1:
            base += f"{page}_p/"
        return base
    
    async def _fetch_page(self, url: str, max_retries: int = 3) -> Optional[str]:
        """Fetch a page using ScraperAPI with concurrency control."""
        params = {
            "api_key": self.api_key,
            "url": url,
            "render": "true",
            "country_code": "us",
        }
        
        async with self.semaphore:  # Limit concurrent requests
            for attempt in range(max_retries):
                try:
                    logger.info(f"  Fetching: {url[:80]}...")
                    
                    response = await self.client.get(
                        SCRAPER_API_URL, 
                        params=params,
                        timeout=60.0
                    )
                    
                    if response.status_code == 200:
                        return response.text
                    elif response.status_code == 403:
                        logger.warning(f"  Access denied (403)")
                        return None
                    elif response.status_code == 429:
                        logger.warning(f"  Rate limited (429). Waiting...")
                        await asyncio.sleep(3 * (attempt + 1))
                    elif response.status_code == 500:
                        logger.warning(f"  Server error (500). Retrying...")
                        await asyncio.sleep(1 * (attempt + 1))
                    else:
                        logger.warning(f"  Unexpected status: {response.status_code}")
                        
                except httpx.TimeoutException:
                    logger.warning(f"  Timeout on attempt {attempt + 1}")
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.error(f"  Error fetching page: {e}")
                    await asyncio.sleep(1)
        
        return None
    
    def _extract_listings_from_html(self, html: str, city: str, state: str, listing_type: str = 'rental') -> List[Dict[str, Any]]:
        """Extract listing data from Zillow HTML."""
        listings = []
        soup = BeautifulSoup(html, 'lxml')
        
        # METHOD 1: Parse JSON from script tags
        script_tags = soup.find_all('script', type='application/json')
        
        for script in script_tags:
            if not script.string:
                continue
            try:
                data = json.loads(script.string)
                if isinstance(data, dict):
                    found = self._parse_json_data(data, city, state, listing_type)
                    listings.extend(found)
            except (json.JSONDecodeError, TypeError):
                continue
        
        # METHOD 2: Parse __NEXT_DATA__
        next_data = soup.find('script', id='__NEXT_DATA__')
        if next_data and next_data.string:
            try:
                data = json.loads(next_data.string)
                props = data.get('props', {}).get('pageProps', {})
                found = self._parse_json_data(props, city, state, listing_type)
                listings.extend(found)
            except (json.JSONDecodeError, TypeError):
                pass
        
        # METHOD 3: Parse HTML cards (fallback)
        if not listings:
            listings = self._parse_html_cards(soup, city, state, listing_type)
        
        # Deduplicate by zillow_id
        seen = set()
        unique = []
        for listing in listings:
            lid = listing.get('zillow_id')
            if lid and lid not in seen:
                seen.add(lid)
                unique.append(listing)
        
        return unique
    
    def _parse_json_data(self, data: Dict, city: str, state: str, listing_type: str = 'rental', depth: int = 0) -> List[Dict[str, Any]]:
        """Recursively search for listing data in JSON."""
        if depth > 15:
            return []
        
        listings = []
        
        if self._is_listing_object(data):
            listing = self._extract_listing(data, city, state, listing_type)
            if listing:
                listings.append(listing)
                return listings
        
        search_keys = [
            'searchResults', 'listResults', 'results', 'mapResults',
            'cat1', 'searchPageState', 'homes', 'properties', 'listings'
        ]
        
        for key in search_keys:
            if key in data:
                value = data[key]
                if isinstance(value, list):
                    for item in value:
                        if isinstance(item, dict):
                            listings.extend(self._parse_json_data(item, city, state, listing_type, depth + 1))
                elif isinstance(value, dict):
                    listings.extend(self._parse_json_data(value, city, state, listing_type, depth + 1))
        
        for key, value in data.items():
            if key in search_keys:
                continue
            if isinstance(value, dict):
                listings.extend(self._parse_json_data(value, city, state, listing_type, depth + 1))
            elif isinstance(value, list) and len(value) < 100:
                for item in value:
                    if isinstance(item, dict):
                        listings.extend(self._parse_json_data(item, city, state, listing_type, depth + 1))
        
        return listings
    
    def _is_listing_object(self, data: Dict) -> bool:
        """Check if dict looks like a property listing."""
        has_id = any(k in data for k in ['zpid', 'id', 'propertyId'])
        has_address = 'address' in data or 'streetAddress' in data
        has_price = any(k in data for k in ['price', 'unformattedPrice', 'rent'])
        return has_id and (has_address or has_price)
    
    def _extract_listing(self, data: Dict, search_city: str, search_state: str, listing_type: str = 'rental') -> Optional[Dict[str, Any]]:
        """Extract listing details from a JSON object."""
        try:
            zpid = data.get('zpid') or data.get('id') or data.get('propertyId')
            if not zpid:
                return None
            
            # Get address
            addr = data.get('address', {})
            if isinstance(addr, str):
                address = addr
                city, state, zip_code = search_city, search_state, None
            elif isinstance(addr, dict):
                address = addr.get('streetAddress', '') or addr.get('line1', '')
                city = addr.get('city', '') or search_city
                state = addr.get('state', '') or search_state
                zip_code = addr.get('zipcode', '') or addr.get('postalCode', '')
            else:
                address = data.get('streetAddress', '') or data.get('formattedAddress', '')
                city = data.get('city', '') or search_city
                state = data.get('state', '') or search_state
                zip_code = data.get('zipcode', '') or data.get('postalCode', '')
            
            if not address:
                return None
            
            # Get prices (rent price and/or sale price)
            price = None
            sale_price = None
            
            # First, check for rent price
            for field in ['rent', 'rentPrice', 'rentZestimate']:
                if field in data and data[field]:
                    val = data[field]
                    if isinstance(val, (int, float)) and val > 0:
                        price = float(val)
                        break
            
            # Check for sale/list price
            for field in ['price', 'unformattedPrice', 'listPrice']:
                if field in data and data[field]:
                    val = data[field]
                    if isinstance(val, (int, float)) and val > 0:
                        # Prices over 10000 are likely sale prices, not rent
                        if val > 10000:
                            sale_price = float(val)
                        else:
                            if price is None:
                                price = float(val)
                        break
                    elif isinstance(val, str):
                        nums = re.findall(r'[\d,]+', val.replace(',', ''))
                        if nums:
                            try:
                                parsed = float(nums[0].replace(',', ''))
                                if parsed > 10000:
                                    sale_price = parsed
                                elif price is None:
                                    price = parsed
                                break
                            except ValueError:
                                continue
            
            # For for_sale listings, sale_price becomes the main price indicator
            if listing_type == 'for_sale':
                if sale_price is None:
                    # Try to get price again for sale listings
                    for field in ['price', 'unformattedPrice', 'listPrice']:
                        if field in data and data[field]:
                            val = data[field]
                            if isinstance(val, (int, float)) and val > 0:
                                sale_price = float(val)
                                break
                if sale_price is None or sale_price < 10000:
                    return None  # Skip for-sale listings without valid sale price
            else:
                # For rentals, we need a rent price
                if not price or price < 100:
                    return None
            
            # Get beds/baths
            beds = data.get('beds') or data.get('bedrooms') or 0
            baths = data.get('baths') or data.get('bathrooms') or 0
            
            if isinstance(beds, str):
                m = re.search(r'\d+', beds)
                beds = int(m.group()) if m else 0
            if isinstance(baths, str):
                m = re.search(r'[\d.]+', baths)
                baths = float(m.group()) if m else 0
            
            # Get description
            desc = data.get('description') or data.get('homeDescription') or ''
            if len(desc) > 5000:
                desc = desc[:5000] + '...'
            
            # Get amenities from listing data
            amenities_list = []
            amenity_fields = ['amenities', 'features', 'homeFeatures', 'propertyFeatures', 'highlights']
            for field in amenity_fields:
                if field in data:
                    val = data[field]
                    if isinstance(val, list):
                        amenities_list.extend([str(a) for a in val])
                    elif isinstance(val, str):
                        amenities_list.append(val)
            
            # Detect amenities
            detected = detect_amenities(desc, amenities_list)
            
            # Detect extra rooms that could be used as bedrooms
            bedroom_count = int(beds) if beds else 0
            extra_rooms = detect_extra_rooms(desc, amenities_list, bedroom_count)
            
            # Detect creative financing for for-sale listings
            financing = detect_creative_financing(desc)
            
            listing = {
                'zillow_id': str(zpid),
                'address': address.strip(),
                'city': city.strip() if city else search_city,
                'state': state.strip() if state else search_state,
                'zip_code': zip_code.strip() if zip_code else None,
                'bedrooms': bedroom_count,
                'bathrooms': float(baths) if baths else None,
                'price': price,  # Monthly rent (may be None for for-sale)
                'sale_price': sale_price,  # Sale price for for-sale listings
                'listing_type': listing_type,
                'description': desc,
                'property_type': data.get('propertyType') or data.get('homeType', ''),
                'sqft': data.get('livingArea') or data.get('sqft'),
                'url': f"https://www.zillow.com/homedetails/{zpid}_zpid/",
                'amenities_raw': json.dumps(amenities_list) if amenities_list else None,
                'has_creative_financing': financing['has_creative_financing'],
                'financing_keywords': financing['financing_keywords'],
            }
            
            # Add detected amenities and extra rooms
            listing.update(detected)
            listing.update(extra_rooms)
            
            return listing
        except Exception as e:
            logger.error(f"Error extracting listing: {e}")
            return None
    
    def _parse_html_cards(self, soup: BeautifulSoup, city: str, state: str, listing_type: str = 'rental') -> List[Dict[str, Any]]:
        """Parse listing cards from HTML (fallback method)."""
        listings = []
        
        selectors = [
            'article[data-test="property-card"]',
            'li[class*="ListItem"]',
            '[class*="property-card"]',
        ]
        
        cards = []
        for sel in selectors:
            cards = soup.select(sel)
            if cards:
                break
        
        for card in cards:
            try:
                link = card.find('a', href=True)
                url = link['href'] if link else None
                zpid = None
                if url:
                    m = re.search(r'/(\d+)_zpid', url)
                    if m:
                        zpid = m.group(1)
                    if not url.startswith('http'):
                        url = f"https://www.zillow.com{url}"
                
                addr_el = card.select_one('[data-test="property-card-addr"]') or card.select_one('address')
                address = addr_el.get_text(strip=True) if addr_el else None
                
                price_el = card.select_one('[data-test="property-card-price"]') or card.select_one('[class*="price"]')
                price = None
                sale_price = None
                if price_el:
                    txt = price_el.get_text(strip=True)
                    nums = re.findall(r'[\d,]+', txt)
                    if nums:
                        parsed_price = float(nums[0].replace(',', ''))
                        if listing_type == 'for_sale' or parsed_price > 10000:
                            sale_price = parsed_price
                        else:
                            price = parsed_price
                
                card_text = card.get_text()
                beds_m = re.search(r'(\d+)\s*(?:bd|bed)', card_text, re.I)
                baths_m = re.search(r'([\d.]+)\s*(?:ba|bath)', card_text, re.I)
                beds = int(beds_m.group(1)) if beds_m else 0
                baths = float(baths_m.group(1)) if baths_m else None
                
                # For for-sale, require sale_price; for rentals, require price
                valid = (listing_type == 'for_sale' and sale_price) or (listing_type == 'rental' and price)
                
                if address and valid:
                    # Basic amenity detection from card text
                    detected = detect_amenities(card_text, [])
                    extra_rooms = detect_extra_rooms(card_text, [], beds)
                    financing = detect_creative_financing(card_text)
                    
                    listing = {
                        'zillow_id': zpid or f"html_{hash(address) % 10000000}",
                        'address': address,
                        'city': city,
                        'state': state,
                        'zip_code': None,
                        'bedrooms': beds,
                        'bathrooms': baths,
                        'price': price,
                        'sale_price': sale_price,
                        'listing_type': listing_type,
                        'description': None,
                        'property_type': None,
                        'sqft': None,
                        'url': url,
                        'amenities_raw': None,
                        'has_creative_financing': financing['has_creative_financing'],
                        'financing_keywords': financing['financing_keywords'],
                    }
                    listing.update(detected)
                    listing.update(extra_rooms)
                    listings.append(listing)
            except Exception as e:
                logger.error(f"Error parsing card: {e}")
                continue
        
        return listings
    
    def _check_no_results(self, html: str) -> bool:
        """Check if search returned no results."""
        indicators = ['no matching results', '0 results', 'no homes match']
        html_lower = html.lower()
        return any(ind in html_lower for ind in indicators)
    
    def _get_page_count(self, soup: BeautifulSoup) -> int:
        """Get total number of pages from pagination."""
        for sel in ['[class*="pagination"] a', '[class*="PaginationNumberButton"]']:
            elems = soup.select(sel)
            if elems:
                pages = [int(e.get_text(strip=True)) for e in elems if e.get_text(strip=True).isdigit()]
                if pages:
                    return min(max(pages), 20)
        return 1
    
    async def _scrape_bedroom_count(
        self,
        city: str,
        state: str,
        bedrooms: int,
        max_pages: int,
        listing_type: str,
        seen_ids: set,
        filter_creative_financing: bool = False,
        zip_code: str = None
    ) -> List[Dict[str, Any]]:
        """Scrape listings for a single bedroom count."""
        listings_found = []
        type_label = "SALE" if listing_type == 'for_sale' else "RENT"
        location_label = f"{city}, {state}" + (f" ({zip_code})" if zip_code else "")
        
        logger.info(f"  [{type_label}] {bedrooms}BR in {location_label}...")
        
        page = 1
        empty_pages = 0
        
        while page <= max_pages:
            url = self._build_zillow_url(city, state, bedrooms, page, listing_type, zip_code)
            html = await self._fetch_page(url)
            
            if not html:
                break
            
            if self._check_no_results(html):
                break
            
            listings = self._extract_listings_from_html(html, city, state, listing_type)
            
            if not listings:
                empty_pages += 1
                if empty_pages >= 2:
                    break
                page += 1
                continue
            
            empty_pages = 0
            new_count = 0
            
            for listing in listings:
                lid = listing.get('zillow_id')
                if lid and lid not in seen_ids:
                    if not listing.get('bedrooms'):
                        listing['bedrooms'] = bedrooms
                    
                    if listing['bedrooms'] == bedrooms or listing['bedrooms'] == 0:
                        if listing['bedrooms'] == 0:
                            listing['bedrooms'] = bedrooms
                        
                        # For for-sale listings, only keep if has creative financing
                        if filter_creative_financing and not listing.get('has_creative_financing'):
                            continue
                        
                        seen_ids.add(lid)
                        listings_found.append(listing)
                        new_count += 1
                        
                        if self.on_listing_found:
                            try:
                                self.on_listing_found(listing)
                            except Exception as e:
                                logger.error(f"Callback error: {e}")
            
            if new_count == 0:
                empty_pages += 1
                if empty_pages >= 2:
                    break
            
            soup = BeautifulSoup(html, 'lxml')
            total_pages = self._get_page_count(soup)
            if page >= total_pages:
                break
            
            page += 1
        
        logger.info(f"  [{type_label}] {bedrooms}BR: {len(listings_found)} listings")
        return listings_found

    async def _scrape_listing_type(
        self,
        city: str,
        state: str,
        min_bedrooms: int,
        max_bedrooms: int,
        max_pages_per_bedroom: int,
        listing_type: str,
        seen_ids: set,
        filter_creative_financing: bool = False,
        zip_code: str = None
    ) -> List[Dict[str, Any]]:
        """
        Scrape listings of a specific type (rental or for_sale).
        Uses concurrent scraping for different bedroom counts.
        """
        all_listings = []
        type_label = "FOR SALE" if listing_type == 'for_sale' else "RENTALS"
        location_label = f"{city}, {state}" + (f" ({zip_code})" if zip_code else "")
        
        logger.info(f"Scraping {location_label} [{type_label}] - {min_bedrooms}-{max_bedrooms} BR (concurrent)...")
        
        bedroom_range = list(range(min_bedrooms, max_bedrooms + 1))
        
        # Scrape bedroom counts in batches for concurrency
        for i in range(0, len(bedroom_range), self.MAX_CONCURRENT_BEDROOMS):
            batch = bedroom_range[i:i + self.MAX_CONCURRENT_BEDROOMS]
            
            # Create tasks for each bedroom count in this batch
            tasks = [
                self._scrape_bedroom_count(
                    city, state, bedrooms, max_pages_per_bedroom,
                    listing_type, seen_ids, filter_creative_financing, zip_code
                )
                for bedrooms in batch
            ]
            
            # Run concurrently
            results = await asyncio.gather(*tasks)
            
            # Collect results
            for listings in results:
                all_listings.extend(listings)
        
        return all_listings
    
    async def scrape_city(
        self,
        city: str,
        state: str,
        min_bedrooms: int = 3,
        max_bedrooms: int = 8,
        max_pages_per_bedroom: int = 10,
        include_for_sale_creative: bool = True,
        zip_code: str = None,
        include_surrounding: bool = False,
        surrounding_miles: int = None,
        surrounding_only: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Scrape rental listings and optionally for-sale listings with creative financing.
        
        Args:
            city: City name (e.g., "Chicago", "Miami")
            state: State abbreviation (e.g., "IL", "FL")
            min_bedrooms: Minimum bedroom count (default 3)
            max_bedrooms: Maximum bedroom count (default 8)
            max_pages_per_bedroom: Max pages per bedroom count
            include_for_sale_creative: Also scrape for-sale with creative financing terms
            zip_code: Optional zip code to narrow search
            include_surrounding: Include surrounding cities within radius
            surrounding_miles: Radius in miles for surrounding cities
            surrounding_only: ONLY search surrounding cities, exclude main city
            
        Returns:
            List of listing dictionaries
        """
        all_listings = []
        seen_ids = set()
        
        # Determine which cities to scrape
        cities_to_scrape = []
        
        if include_surrounding and surrounding_miles:
            # Get nearby cities using geocoding
            from .geocoding import get_nearby_cities
            try:
                nearby = await get_nearby_cities(
                    city, state, surrounding_miles, 
                    exclude_center=surrounding_only
                )
                cities_to_scrape = nearby
                logger.info(f"Found {len(cities_to_scrape)} cities within {surrounding_miles} miles of {city}, {state}")
                for c in cities_to_scrape:
                    dist = c.get('distance', 0)
                    logger.info(f"  - {c['city']}, {c['state']} ({dist} miles)")
            except Exception as e:
                logger.error(f"Error getting nearby cities: {e}")
                if not surrounding_only:
                    cities_to_scrape = [{"city": city, "state": state}]
        else:
            cities_to_scrape = [{"city": city, "state": state}]
        
        if not cities_to_scrape:
            logger.warning("No cities to scrape")
            return []
        
        async def scrape_single_city(city_info: Dict) -> List[Dict[str, Any]]:
            """Scrape a single city (rentals + optional for-sale)."""
            city_listings = []
            scrape_city = city_info["city"]
            scrape_state = city_info["state"]
            distance = city_info.get("distance", 0)
            
            location_label = f"{scrape_city}, {scrape_state}"
            if distance > 0:
                location_label += f" ({distance} mi)"
            
            logger.info(f"\n>>> Scraping: {location_label}")
            
            # Only use zip_code for the main city
            use_zip = zip_code if distance == 0 else None
            
            # 1. Scrape RENTAL listings
            rentals = await self._scrape_listing_type(
                scrape_city, scrape_state, min_bedrooms, max_bedrooms, max_pages_per_bedroom,
                listing_type='rental',
                seen_ids=seen_ids,
                filter_creative_financing=False,
                zip_code=use_zip
            )
            city_listings.extend(rentals)
            
            # 2. Scrape FOR SALE listings (only keep creative financing)
            if include_for_sale_creative:
                for_sale = await self._scrape_listing_type(
                    scrape_city, scrape_state, min_bedrooms, max_bedrooms, max_pages_per_bedroom,
                    listing_type='for_sale',
                    seen_ids=seen_ids,
                    filter_creative_financing=True,
                    zip_code=use_zip
                )
                city_listings.extend(for_sale)
            
            logger.info(f"<<< {location_label}: {len(city_listings)} total listings")
            return city_listings
        
        # Scrape cities - can do 2 cities at a time
        MAX_CONCURRENT_CITIES = 2
        
        for i in range(0, len(cities_to_scrape), MAX_CONCURRENT_CITIES):
            batch = cities_to_scrape[i:i + MAX_CONCURRENT_CITIES]
            
            if len(batch) == 1:
                # Single city, just run it
                listings = await scrape_single_city(batch[0])
                all_listings.extend(listings)
            else:
                # Multiple cities, run concurrently
                tasks = [scrape_single_city(city_info) for city_info in batch]
                results = await asyncio.gather(*tasks)
                for listings in results:
                    all_listings.extend(listings)
        
        logger.info(f"\n{'='*50}")
        logger.info(f"TOTAL: {len(all_listings)} listings from {len(cities_to_scrape)} cities")
        logger.info(f"{'='*50}")
        return all_listings


async def scrape_zillow(
    city: str,
    state: str,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    api_key: Optional[str] = None,
    on_listing_found: Optional[Callable[[Dict], None]] = None,
    zip_code: Optional[str] = None,
    include_surrounding: bool = False,
    surrounding_miles: Optional[int] = None,
    surrounding_only: bool = False
) -> List[Dict[str, Any]]:
    """
    Main entry point for scraping Zillow.
    
    Args:
        city: City name
        state: State abbreviation
        min_bedrooms: Min bedroom count
        max_bedrooms: Max bedroom count
        api_key: ScraperAPI key (optional)
        on_listing_found: Optional callback
        zip_code: Optional zip code to narrow search
        include_surrounding: Include surrounding cities within radius
        surrounding_miles: Radius in miles for surrounding cities
        surrounding_only: ONLY search surrounding cities, exclude main city
        
    Returns:
        List of listing dictionaries
    """
    async with ZillowScraperAPI(api_key=api_key, on_listing_found=on_listing_found) as scraper:
        return await scraper.scrape_city(
            city, state, min_bedrooms, max_bedrooms, 
            zip_code=zip_code,
            include_surrounding=include_surrounding,
            surrounding_miles=surrounding_miles,
            surrounding_only=surrounding_only
        )


# CLI for testing
if __name__ == "__main__":
    import sys
    
    async def main():
        city = sys.argv[1] if len(sys.argv) > 1 else "Chicago"
        state = sys.argv[2] if len(sys.argv) > 2 else "IL"
        
        print(f"\n{'='*60}")
        print(f"Scraping Zillow rentals for {city}, {state}")
        print(f"{'='*60}\n")
        
        def on_found(listing):
            amenities = []
            if listing.get('has_pool'): amenities.append('Pool')
            if listing.get('has_waterfront'): amenities.append('Waterfront')
            if listing.get('has_basement'): amenities.append('Basement')
            am_str = f" [{', '.join(amenities)}]" if amenities else ""
            print(f"  + {listing['bedrooms']}BR ${listing['price']:,.0f}/mo{am_str} - {listing['address'][:40]}")
        
        try:
            listings = await scrape_zillow(city, state, on_listing_found=on_found)
        except ValueError as e:
            print(f"ERROR: {e}")
            return
        
        print(f"\n{'='*60}")
        print(f"RESULTS: {len(listings)} listings in {city}, {state}")
        print(f"{'='*60}")
        
        # Summary
        pools = sum(1 for l in listings if l.get('has_pool'))
        waterfronts = sum(1 for l in listings if l.get('has_waterfront'))
        basements = sum(1 for l in listings if l.get('has_basement'))
        
        print(f"\nAmenity counts:")
        print(f"  Pool: {pools}")
        print(f"  Waterfront/View: {waterfronts}")
        print(f"  Basement: {basements}")
    
    asyncio.run(main())
