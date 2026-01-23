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
    'has_waterview': [
        r'\bwater\s*view\b', r'\bwaterview\b', r'\bocean\s*view\b', r'\blake\s*view\b',
        r'\briver\s*view\b', r'\bbay\s*view\b', r'\bsea\s*view\b', r'\bbeach\s*view\b'
    ],
    'has_waterfront': [
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


class ZillowScraperAPI:
    """
    Scrapes Zillow rental listings using ScraperAPI.
    
    ScraperAPI handles all the hard parts:
    - JavaScript rendering (Zillow loads data dynamically)
    - Rotating proxies (avoid IP bans)
    - CAPTCHA solving (bypass bot detection)
    - Automatic retries
    """
    
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
    
    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=60.0)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
    
    def _build_zillow_url(self, city: str, state: str, bedrooms: int, page: int = 1) -> str:
        """Build Zillow rental search URL for a city."""
        # Format: city-state (e.g., "chicago-il", "miami-fl")
        city_slug = city.lower().replace(' ', '-')
        state_slug = state.lower()
        
        base = f"https://www.zillow.com/{city_slug}-{state_slug}/rentals/"
        if bedrooms:
            base += f"{bedrooms}-bedrooms/"
        if page > 1:
            base += f"{page}_p/"
        return base
    
    async def _fetch_page(self, url: str, max_retries: int = 3) -> Optional[str]:
        """Fetch a page using ScraperAPI."""
        params = {
            "api_key": self.api_key,
            "url": url,
            "render": "true",
            "country_code": "us",
        }
        
        for attempt in range(max_retries):
            try:
                logger.info(f"  Fetching (attempt {attempt + 1}): {url}")
                
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
                    await asyncio.sleep(5 * (attempt + 1))
                elif response.status_code == 500:
                    logger.warning(f"  Server error (500). Retrying...")
                    await asyncio.sleep(2 * (attempt + 1))
                else:
                    logger.warning(f"  Unexpected status: {response.status_code}")
                    
            except httpx.TimeoutException:
                logger.warning(f"  Timeout on attempt {attempt + 1}")
                await asyncio.sleep(2)
            except Exception as e:
                logger.error(f"  Error fetching page: {e}")
                await asyncio.sleep(2)
        
        return None
    
    def _extract_listings_from_html(self, html: str, city: str, state: str) -> List[Dict[str, Any]]:
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
                    found = self._parse_json_data(data, city, state)
                    listings.extend(found)
            except (json.JSONDecodeError, TypeError):
                continue
        
        # METHOD 2: Parse __NEXT_DATA__
        next_data = soup.find('script', id='__NEXT_DATA__')
        if next_data and next_data.string:
            try:
                data = json.loads(next_data.string)
                props = data.get('props', {}).get('pageProps', {})
                found = self._parse_json_data(props, city, state)
                listings.extend(found)
            except (json.JSONDecodeError, TypeError):
                pass
        
        # METHOD 3: Parse HTML cards (fallback)
        if not listings:
            listings = self._parse_html_cards(soup, city, state)
        
        # Deduplicate by zillow_id
        seen = set()
        unique = []
        for listing in listings:
            lid = listing.get('zillow_id')
            if lid and lid not in seen:
                seen.add(lid)
                unique.append(listing)
        
        return unique
    
    def _parse_json_data(self, data: Dict, city: str, state: str, depth: int = 0) -> List[Dict[str, Any]]:
        """Recursively search for listing data in JSON."""
        if depth > 15:
            return []
        
        listings = []
        
        if self._is_listing_object(data):
            listing = self._extract_listing(data, city, state)
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
                            listings.extend(self._parse_json_data(item, city, state, depth + 1))
                elif isinstance(value, dict):
                    listings.extend(self._parse_json_data(value, city, state, depth + 1))
        
        for key, value in data.items():
            if key in search_keys:
                continue
            if isinstance(value, dict):
                listings.extend(self._parse_json_data(value, city, state, depth + 1))
            elif isinstance(value, list) and len(value) < 100:
                for item in value:
                    if isinstance(item, dict):
                        listings.extend(self._parse_json_data(item, city, state, depth + 1))
        
        return listings
    
    def _is_listing_object(self, data: Dict) -> bool:
        """Check if dict looks like a property listing."""
        has_id = any(k in data for k in ['zpid', 'id', 'propertyId'])
        has_address = 'address' in data or 'streetAddress' in data
        has_price = any(k in data for k in ['price', 'unformattedPrice', 'rent'])
        return has_id and (has_address or has_price)
    
    def _extract_listing(self, data: Dict, search_city: str, search_state: str) -> Optional[Dict[str, Any]]:
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
            
            # Get price
            price = None
            for field in ['price', 'unformattedPrice', 'rent', 'rentPrice', 'listPrice']:
                if field in data and data[field]:
                    val = data[field]
                    if isinstance(val, (int, float)) and val > 0:
                        price = float(val)
                        break
                    elif isinstance(val, str):
                        nums = re.findall(r'[\d,]+', val.replace(',', ''))
                        if nums:
                            try:
                                price = float(nums[0].replace(',', ''))
                                break
                            except ValueError:
                                continue
            
            if not price and 'rentZestimate' in data:
                val = data['rentZestimate']
                if isinstance(val, (int, float)) and val > 0:
                    price = float(val)
            
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
            
            listing = {
                'zillow_id': str(zpid),
                'address': address.strip(),
                'city': city.strip() if city else search_city,
                'state': state.strip() if state else search_state,
                'zip_code': zip_code.strip() if zip_code else None,
                'bedrooms': int(beds) if beds else 0,
                'bathrooms': float(baths) if baths else None,
                'price': price,
                'description': desc,
                'property_type': data.get('propertyType') or data.get('homeType', ''),
                'sqft': data.get('livingArea') or data.get('sqft'),
                'url': f"https://www.zillow.com/homedetails/{zpid}_zpid/",
                'amenities_raw': json.dumps(amenities_list) if amenities_list else None,
            }
            
            # Add detected amenities
            listing.update(detected)
            
            return listing
        except Exception as e:
            logger.error(f"Error extracting listing: {e}")
            return None
    
    def _parse_html_cards(self, soup: BeautifulSoup, city: str, state: str) -> List[Dict[str, Any]]:
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
                if price_el:
                    txt = price_el.get_text(strip=True)
                    nums = re.findall(r'[\d,]+', txt)
                    if nums:
                        price = float(nums[0].replace(',', ''))
                
                card_text = card.get_text()
                beds_m = re.search(r'(\d+)\s*(?:bd|bed)', card_text, re.I)
                baths_m = re.search(r'([\d.]+)\s*(?:ba|bath)', card_text, re.I)
                beds = int(beds_m.group(1)) if beds_m else 0
                baths = float(baths_m.group(1)) if baths_m else None
                
                if address and price:
                    # Basic amenity detection from card text
                    detected = detect_amenities(card_text, [])
                    
                    listing = {
                        'zillow_id': zpid or f"html_{hash(address) % 10000000}",
                        'address': address,
                        'city': city,
                        'state': state,
                        'zip_code': None,
                        'bedrooms': beds,
                        'bathrooms': baths,
                        'price': price,
                        'description': None,
                        'property_type': None,
                        'sqft': None,
                        'url': url,
                        'amenities_raw': None,
                    }
                    listing.update(detected)
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
    
    async def scrape_city(
        self,
        city: str,
        state: str,
        min_bedrooms: int = 3,
        max_bedrooms: int = 8,
        max_pages_per_bedroom: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Scrape all rental listings for a city.
        
        Args:
            city: City name (e.g., "Chicago", "Miami")
            state: State abbreviation (e.g., "IL", "FL")
            min_bedrooms: Minimum bedroom count (default 3)
            max_bedrooms: Maximum bedroom count (default 8)
            max_pages_per_bedroom: Max pages per bedroom count
            
        Returns:
            List of listing dictionaries
        """
        all_listings = []
        seen_ids = set()
        
        for bedrooms in range(min_bedrooms, max_bedrooms + 1):
            logger.info(f"Scraping {city}, {state} - {bedrooms} bedrooms...")
            
            page = 1
            empty_pages = 0
            
            while page <= max_pages_per_bedroom:
                url = self._build_zillow_url(city, state, bedrooms, page)
                html = await self._fetch_page(url)
                
                if not html:
                    logger.warning(f"  Failed to fetch page {page}")
                    break
                
                if self._check_no_results(html):
                    logger.info(f"  No results for {bedrooms} BR")
                    break
                
                listings = self._extract_listings_from_html(html, city, state)
                
                if not listings:
                    empty_pages += 1
                    if empty_pages >= 2:
                        logger.info(f"  No listings for 2 pages, moving on")
                        break
                    page += 1
                    await asyncio.sleep(1)
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
                            
                            seen_ids.add(lid)
                            all_listings.append(listing)
                            new_count += 1
                            
                            if self.on_listing_found:
                                try:
                                    self.on_listing_found(listing)
                                except Exception as e:
                                    logger.error(f"Callback error: {e}")
                
                logger.info(f"  Page {page}: {new_count} new listings (total: {len(all_listings)})")
                
                if new_count == 0:
                    empty_pages += 1
                    if empty_pages >= 2:
                        break
                
                soup = BeautifulSoup(html, 'lxml')
                total_pages = self._get_page_count(soup)
                if page >= total_pages:
                    break
                
                page += 1
                await asyncio.sleep(1)
            
            await asyncio.sleep(2)
        
        logger.info(f"Total: {len(all_listings)} listings for {city}, {state}")
        return all_listings


async def scrape_zillow(
    city: str,
    state: str,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    api_key: Optional[str] = None,
    on_listing_found: Optional[Callable[[Dict], None]] = None
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
        
    Returns:
        List of listing dictionaries
    """
    async with ZillowScraperAPI(api_key=api_key, on_listing_found=on_listing_found) as scraper:
        return await scraper.scrape_city(city, state, min_bedrooms, max_bedrooms)


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
            if listing.get('has_waterview'): amenities.append('Waterview')
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
        waterviews = sum(1 for l in listings if l.get('has_waterview'))
        basements = sum(1 for l in listings if l.get('has_basement'))
        
        print(f"\nAmenity counts:")
        print(f"  Pool: {pools}")
        print(f"  Waterview: {waterviews}")
        print(f"  Basement: {basements}")
    
    asyncio.run(main())
