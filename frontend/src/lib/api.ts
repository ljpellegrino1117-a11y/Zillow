import axios from 'axios';

const API_BASE = '/api';

// High-performance client-side cache with configurable TTL
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
const DEFAULT_CACHE_TTL = 30000; // 30 seconds for most data
const STATIC_CACHE_TTL = 120000; // 2 minutes for static data like cities
const ANALYSIS_CACHE_TTL = 90000; // 90 seconds for analysis data
const AIRBTICS_STATUS_TTL = 5000; // 5 seconds for sync status (needs to be fresh when polling)

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttl: number = DEFAULT_CACHE_TTL): void {
  // Limit cache size to prevent memory bloat
  if (cache.size > 200) {
    // Remove oldest 50 entries
    const keys = Array.from(cache.keys()).slice(0, 50);
    keys.forEach(k => cache.delete(k));
  }
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

export function invalidateCache(pattern?: string): void {
  if (!pattern) {
    cache.clear();
  } else {
    // Convert to array for TypeScript compatibility
    const keys = Array.from(cache.keys());
    for (const key of keys) {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    }
  }
}

// Helper to create cache keys
function makeCacheKey(...args: (string | number | boolean | null | undefined)[]): string {
  return args.map(a => a === null || a === undefined ? '_' : String(a)).join(':');
}

// Property type options for filtering
export type PropertyType = 'house' | 'townhome' | 'multi_family' | 'condo' | 'lot' | 'apartment' | 'manufactured';

export interface City {
  id: number;
  city: string;
  state: string;
  zip_code: string | null;
  include_surrounding: boolean;
  surrounding_miles: number | null;
  surrounding_only: boolean;
  rent_min: number | null;
  rent_max: number | null;
  purchase_price_min: number | null;
  purchase_price_max: number | null;
  exclude_hoa: boolean;
  property_types: PropertyType[] | null;
  created_at: string;
  last_scraped: string | null;
}

export interface ZillowListing {
  id: number;
  zillow_id: string;
  city_id: number;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  bedrooms: number;
  bathrooms: number | null;
  price: number;
  description: string | null;
  property_type: string | null;
  sqft: number | null;
  url: string | null;
  amenities_raw: string | null;
  has_pool: boolean;
  has_hot_tub: boolean;
  has_waterfront: boolean;  // Includes waterfront AND waterview
  has_basement: boolean;
  has_unfinished_basement: boolean;
  has_finished_basement: boolean;
  has_garage: boolean;
  has_parking: boolean;
  has_laundry: boolean;
  has_ac: boolean;
  has_fireplace: boolean;
  has_yard: boolean;
  has_patio: boolean;
  has_balcony: boolean;
  has_gym: boolean;
  has_pet_friendly: boolean;
  // Extra rooms that could be bedrooms
  extra_rooms_count: number;
  extra_rooms_details: string | null;
  potential_bedrooms: number | null;
  has_office: boolean;
  has_den: boolean;
  has_bonus_room: boolean;
  has_loft: boolean;
  has_flex_space: boolean;
  has_sunroom: boolean;
  has_media_room: boolean;
  has_game_room: boolean;
  has_guest_room: boolean;
  has_nursery: boolean;
  has_studio: boolean;
  has_attic: boolean;
  has_mother_in_law: boolean;
  // Listing type and creative financing
  listing_type: 'rental' | 'for_sale';
  sale_price: number | null;
  has_creative_financing: boolean;
  financing_keywords: string | null;
  // Agent info
  agent_name: string | null;
  agent_phone: string | null;
  agent_email: string | null;
  agent_company: string | null;
  listing_source: 'zillow' | 'realtor' | 'both' | 'manual';
  photos: string | null;
  // Listing lifecycle tracking
  status: 'active' | 'rented' | 'expired';
  first_seen: string | null;
  last_seen: string | null;
  scraped_at: string;
  marked_rented_at: string | null;
}

export interface ListingsLifecycleStats {
  total_listings: number;
  active_listings: number;
  rented_listings: number;
  expired_listings: number;
  listings_by_source: Record<string, number>;
  oldest_listing_date: string | null;
  newest_listing_date: string | null;
  retention_days: number;
}

export interface AirDNAAmenities {
  // Tri-state: true = WITH (required), false = WITHOUT (excluded), undefined = ANY
  has_pool?: boolean;
  has_hot_tub?: boolean;
  has_waterfront?: boolean;  // Includes waterfront AND waterview
  has_basement?: boolean;
  has_garage?: boolean;
  has_yard?: boolean;
  has_pet_friendly?: boolean;
  has_mother_in_law?: boolean;  // In-law suite (property feature, not bedroom)
}

export interface AirDNAData {
  id: number;
  city_id: number;
  zip_code: string | null;
  bedrooms_min: number;
  bedrooms_max: number;
  average_annual_revenue: number;
  // Revenue percentiles (annual values)
  revenue_p25: number | null;
  revenue_p50: number | null;
  revenue_p75: number | null;
  revenue_p90: number | null;
  // Data source
  source: 'manual' | 'airbtics' | 'screenshot';
  airbtics_market_id: string | null;
  last_api_fetch: string | null;
  amenity_filter: string | null;
  // Tri-state amenities: true = WITH, false = WITHOUT, null = ANY
  has_pool: boolean | null;
  has_hot_tub: boolean | null;
  has_waterfront: boolean | null;  // Includes waterfront AND waterview
  has_basement: boolean | null;
  has_garage: boolean | null;
  has_yard: boolean | null;
  has_pet_friendly: boolean | null;
  has_mother_in_law: boolean | null;
  created_at: string | null;
  updated_at: string;
}

export interface DiscrepancyResult {
  city: string;
  state: string;
  bedrooms: number;
  airdna_annual_revenue: number;
  airdna_monthly_revenue: number;
  avg_rental_price: number;
  bottom_10_avg_rental_price: number;
  listing_count: number;
  annual_profit_vs_avg: number;
  annual_profit_vs_bottom: number;
  roi_vs_avg: number;
  roi_vs_bottom: number;
  // Enhanced profitability metrics
  estimated_occupancy_rate: number;
  adjusted_annual_revenue: number;
  estimated_annual_expenses: number;
  net_annual_profit: number;
  net_monthly_cashflow: number;
  break_even_occupancy: number;
  expense_ratio: number;
  // Data quality
  data_confidence: 'low' | 'medium' | 'high';
  airdna_data_count: number;
  // AI Analysis
  opportunity_score: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

export interface ScrapeStatus {
  city: string;
  state: string;
  zip_code: string | null;
  status: string;
  listings_found: number;
  message: string;
}

export interface ListingStats {
  bedrooms: number;
  count: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

export interface AmenityFilters {
  has_pool?: boolean;
  has_waterfront?: boolean;  // Includes waterfront AND waterview
  has_basement?: boolean;
  has_unfinished_basement?: boolean;
  has_finished_basement?: boolean;
  has_garage?: boolean;
  has_parking?: boolean;
  has_laundry?: boolean;
  has_ac?: boolean;
  has_fireplace?: boolean;
  has_yard?: boolean;
  has_patio?: boolean;
  has_balcony?: boolean;
  has_gym?: boolean;
  has_pet_friendly?: boolean;
}

export interface AmenityCounts extends AmenityFilters {
  total: number;
}

// City API (cached)
export const getCities = async (): Promise<City[]> => {
  const cacheKey = 'cities';
  const cached = getCached<City[]>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/cities`);
  setCache(cacheKey, response.data, STATIC_CACHE_TTL);
  return response.data;
};

export interface CreateCityParams {
  city: string;
  state: string;
  zipCode?: string;
  includeSurrounding?: boolean;
  surroundingMiles?: number;
  surroundingOnly?: boolean;
  rentMin?: number;
  rentMax?: number;
  purchasePriceMin?: number;
  purchasePriceMax?: number;
  excludeHoa?: boolean;
  propertyTypes?: PropertyType[];
}

export const createCity = async (params: CreateCityParams): Promise<City> => {
  const response = await axios.post(`${API_BASE}/cities`, { 
    city: params.city, 
    state: params.state,
    zip_code: params.zipCode || null,
    include_surrounding: params.includeSurrounding || false,
    surrounding_miles: params.surroundingMiles || null,
    surrounding_only: params.surroundingOnly || false,
    rent_min: params.rentMin || null,
    rent_max: params.rentMax || null,
    purchase_price_min: params.purchasePriceMin || null,
    purchase_price_max: params.purchasePriceMax || null,
    exclude_hoa: params.excludeHoa || false,
    property_types: params.propertyTypes?.length ? params.propertyTypes : null
  });
  invalidateCache('cities');
  return response.data;
};

export const deleteCity = async (city: string, state: string, zipCode?: string): Promise<void> => {
  const params = zipCode ? `?zip_code=${encodeURIComponent(zipCode)}` : '';
  await axios.delete(`${API_BASE}/cities/${encodeURIComponent(city)}/${encodeURIComponent(state)}${params}`);
  invalidateCache(); // Clear all cache when city deleted
};

// Scraping API
export interface StartScrapeParams {
  city: string;
  state: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  zipCode?: string;
  includeSurrounding?: boolean;
  surroundingMiles?: number;
  surroundingOnly?: boolean;
}

export const startScrape = async (params: StartScrapeParams): Promise<ScrapeStatus> => {
  const response = await axios.post(`${API_BASE}/scrape`, {
    city: params.city,
    state: params.state,
    zip_code: params.zipCode || null,
    min_bedrooms: params.minBedrooms || 3,
    max_bedrooms: params.maxBedrooms || 8,
    include_surrounding: params.includeSurrounding || false,
    surrounding_miles: params.surroundingMiles || null,
    surrounding_only: params.surroundingOnly || false,
  });
  return response.data;
};

export const getScrapeStatus = async (city: string, state: string, zipCode?: string): Promise<ScrapeStatus> => {
  const params = zipCode ? `?zip_code=${encodeURIComponent(zipCode)}` : '';
  const response = await axios.get(`${API_BASE}/scrape/${encodeURIComponent(city)}/${encodeURIComponent(state)}/status${params}`);
  return response.data;
};

// Listings API
export const getListings = async (
  city?: string,
  state?: string,
  bedrooms?: number,
  minBedrooms?: number,
  maxBedrooms?: number,
  minPrice?: number,
  maxPrice?: number,
  amenityFilters?: AmenityFilters,
  limit = 100,
  offset = 0,
  listingType?: string,
  hasCreativeFinancing?: boolean
): Promise<ZillowListing[]> => {
  // Build params string for cache key and API call
  const params = new URLSearchParams();
  if (city) params.append('city', city);
  if (state) params.append('state', state);
  if (bedrooms !== undefined) params.append('bedrooms', bedrooms.toString());
  if (minBedrooms !== undefined) params.append('min_bedrooms', minBedrooms.toString());
  if (maxBedrooms !== undefined) params.append('max_bedrooms', maxBedrooms.toString());
  if (minPrice !== undefined) params.append('min_price', minPrice.toString());
  if (maxPrice !== undefined) params.append('max_price', maxPrice.toString());
  
  // Listing type and creative financing filters
  if (listingType) params.append('listing_type', listingType);
  if (hasCreativeFinancing) params.append('has_creative_financing', 'true');
  
  // Add amenity filters
  if (amenityFilters) {
    Object.entries(amenityFilters).forEach(([key, value]) => {
      if (value === true) {
        params.append(key, 'true');
      }
    });
  }
  
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());
  
  // Check cache first
  const cacheKey = `listings:${params.toString()}`;
  const cached = getCached<ZillowListing[]>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/listings?${params.toString()}`);
  setCache(cacheKey, response.data);
  return response.data;
};

export const getListingStats = async (city?: string, state?: string): Promise<ListingStats[]> => {
  const params = new URLSearchParams();
  if (city) params.append('city', city);
  if (state) params.append('state', state);
  const response = await axios.get(`${API_BASE}/listings/stats?${params.toString()}`);
  return response.data;
};

export const getAmenityCounts = async (city?: string, state?: string, bedrooms?: number): Promise<AmenityCounts> => {
  const params = new URLSearchParams();
  if (city) params.append('city', city);
  if (state) params.append('state', state);
  if (bedrooms !== undefined) params.append('bedrooms', bedrooms.toString());
  
  // Check cache
  const cacheKey = `amenity_counts:${params.toString()}`;
  const cached = getCached<AmenityCounts>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/listings/amenity-counts?${params.toString()}`);
  setCache(cacheKey, response.data);
  return response.data;
};

export const getListingsLifecycleStats = async (): Promise<ListingsLifecycleStats> => {
  const cacheKey = 'listings_lifecycle_stats';
  const cached = getCached<ListingsLifecycleStats>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/listings/lifecycle-stats`);
  setCache(cacheKey, response.data, DEFAULT_CACHE_TTL);
  return response.data;
};

// AirDNA API
export interface SaveAirDNAParams {
  city: string;
  state: string;
  zipCode?: string;
  bedroomsMin: number;
  bedroomsMax: number;
  averageAnnualRevenue: number;
  amenities?: AirDNAAmenities;
}

export const saveAirDNAData = async (params: SaveAirDNAParams): Promise<AirDNAData> => {
  const response = await axios.post(`${API_BASE}/airdna`, { 
    city: params.city, 
    state: params.state, 
    zip_code: params.zipCode || null,
    bedrooms_min: params.bedroomsMin,
    bedrooms_max: params.bedroomsMax,
    average_annual_revenue: params.averageAnnualRevenue,
    amenities: params.amenities || null
  });
  // Invalidate AirDNA cache for this city
  invalidateCache(`airdna:${params.city}:${params.state}`);
  invalidateCache('discrepancy');
  return response.data;
};

export const deleteAirDNAData = async (id: number): Promise<void> => {
  await axios.delete(`${API_BASE}/airdna/${id}`);
  // Invalidate all AirDNA cache (we don't know which city this was)
  invalidateCache('airdna:');
  invalidateCache('discrepancy');
};

export const getAirDNAData = async (city: string, state: string, zipCode?: string): Promise<AirDNAData[]> => {
  const cacheKey = `airdna:${city}:${state}:${zipCode || ''}`;
  const cached = getCached<AirDNAData[]>(cacheKey);
  if (cached) return cached;
  
  const params = zipCode ? `?zip_code=${encodeURIComponent(zipCode)}` : '';
  const response = await axios.get(`${API_BASE}/airdna/${encodeURIComponent(city)}/${encodeURIComponent(state)}${params}`);
  setCache(cacheKey, response.data, DEFAULT_CACHE_TTL);
  return response.data;
};

export const getAirDNAZipCodes = async (city: string, state: string): Promise<(string | null)[]> => {
  const response = await axios.get(`${API_BASE}/airdna/${encodeURIComponent(city)}/${encodeURIComponent(state)}/zip-codes`);
  return response.data;
};

// Analysis API
export const getDiscrepancyAnalysis = async (
  city?: string,
  state?: string,
  bedrooms?: number,
  minBedrooms = 3,
  maxBedrooms = 8,
  amenityFilters?: AmenityFilters
): Promise<DiscrepancyResult[]> => {
  const params = new URLSearchParams();
  if (city) params.append('city', city);
  if (state) params.append('state', state);
  if (bedrooms !== undefined) params.append('bedrooms', bedrooms.toString());
  params.append('min_bedrooms', minBedrooms.toString());
  params.append('max_bedrooms', maxBedrooms.toString());
  
  if (amenityFilters) {
    Object.entries(amenityFilters).forEach(([key, value]) => {
      if (value === true) {
        params.append(key, 'true');
      }
    });
  }
  
  // Check cache first (analysis is expensive)
  const cacheKey = `discrepancy:${params.toString()}`;
  const cached = getCached<DiscrepancyResult[]>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/analysis/discrepancy?${params.toString()}`);
  setCache(cacheKey, response.data, ANALYSIS_CACHE_TTL);
  return response.data;
};

// AI Screenshot Analysis
export interface AIAnalysisResponse {
  conversation_id: string;
  message: string;
  analysis_id?: number;
  extracted_data?: {
    raw_response: string;
    needs_clarification: boolean;
    city?: string;
    state?: string;
    bedrooms?: number;
    annual_revenue?: number;
    monthly_revenue?: number;
    analysis_id?: number;
  };
}

export interface SavedAIAnalysis {
  id: number;
  image_type: string;
  user_context?: string;
  ai_response: string;
  extracted_city?: string;
  extracted_state?: string;
  extracted_bedrooms?: number;
  extracted_annual_revenue?: number;
  extracted_monthly_revenue?: number;
  created_at: string;
}

export interface AIAnalysisDetail extends SavedAIAnalysis {
  image_data: string;
}

export const analyzeScreenshot = async (
  image: File,
  context: string = '',
  conversationId?: string
): Promise<AIAnalysisResponse> => {
  const formData = new FormData();
  formData.append('image', image);
  formData.append('context', context);
  if (conversationId) {
    formData.append('conversation_id', conversationId);
  }
  
  const response = await axios.post(`${API_BASE}/ai/analyze-screenshot`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const continueAIConversation = async (
  conversationId: string,
  message: string
): Promise<AIAnalysisResponse> => {
  const formData = new FormData();
  formData.append('conversation_id', conversationId);
  formData.append('message', message);
  
  const response = await axios.post(`${API_BASE}/ai/continue-conversation`, formData);
  return response.data;
};

export const getSavedAIAnalyses = async (limit: number = 50): Promise<SavedAIAnalysis[]> => {
  const response = await axios.get(`${API_BASE}/ai/saved-analyses?limit=${limit}`);
  return response.data;
};

export const getAIAnalysisDetail = async (analysisId: number): Promise<AIAnalysisDetail> => {
  const response = await axios.get(`${API_BASE}/ai/analysis/${analysisId}`);
  return response.data;
};

// ==================== Airbtics API ====================

export interface AirbticsSyncStatus {
  status: 'idle' | 'syncing' | 'completed' | 'error';
  total_cities: number;
  synced_cities: number;
  failed_cities: number;
  current_city: string | null;
  last_sync: string | null;
  message: string;
  errors: string[];
}

export interface AirbticsCityStatus {
  city_id: number;
  city: string;
  state: string;
  zip_code: string | null;
  has_airbtics_data: boolean;
  market_id: string | null;
  last_fetch: string | null;
  entries_count: number;
  needs_refresh: boolean;
}

export const syncAirbticsData = async (
  cityIds?: number[],
  forceRefresh: boolean = false
): Promise<{ message: string }> => {
  const response = await axios.post(`${API_BASE}/airbtics/sync`, {
    city_ids: cityIds || null,
    force_refresh: forceRefresh
  });
  invalidateCache('airdna');
  invalidateCache('discrepancy');
  return response.data;
};

export const syncAirbticsCity = async (
  cityId: number,
  forceRefresh: boolean = false
): Promise<any> => {
  const response = await axios.post(
    `${API_BASE}/airbtics/sync/${cityId}?force_refresh=${forceRefresh}`
  );
  invalidateCache('airdna');
  invalidateCache('discrepancy');
  return response.data;
};

export const getAirbticsSyncStatus = async (): Promise<AirbticsSyncStatus> => {
  const cacheKey = 'airbtics_status';
  const cached = getCached<AirbticsSyncStatus>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/airbtics/status`);
  setCache(cacheKey, response.data, AIRBTICS_STATUS_TTL);
  return response.data;
};

export const getAirbticsCityStatuses = async (): Promise<AirbticsCityStatus[]> => {
  const cacheKey = 'airbtics_cities';
  const cached = getCached<AirbticsCityStatus[]>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/airbtics/cities`);
  setCache(cacheKey, response.data, AIRBTICS_STATUS_TTL);
  return response.data;
};

// ==================== AI Investment Suggestions ====================

export interface MarketOpportunity {
  city: string;
  state: string;
  avg_annual_revenue: number;
  data_points: number;
  bedroom_counts: number[];
  data_sources: string[];
  has_pool_data: boolean;
  has_waterfront_data: boolean;
}

export interface InvestmentSuggestions {
  suggestions: string;
  top_opportunities: MarketOpportunity[];
  event_opportunities: MarketOpportunity[];
  generated_at: string;
  markets_analyzed: number;
  total_data_points: number;
}

export const getInvestmentSuggestions = async (): Promise<InvestmentSuggestions> => {
  const response = await axios.post(`${API_BASE}/ai/investment-suggestions`);
  return response.data;
};

// ==================== Database Status ====================

export interface DatabaseStatus {
  database_type: 'PostgreSQL' | 'SQLite';
  database_host: string;
  is_production: boolean;
  tables: {
    cities: number;
    airdna_entries: number;
    listings: number;
    airbtics_markets: number;
  };
  data_health: {
    cities_configured: number;
    cities_with_revenue_data: number;
    total_revenue_entries: number;
    data_coverage_percent: number;
  };
  status: 'healthy' | 'needs_data';
}

export interface DataExport {
  export_timestamp: string;
  cities: any[];
  airdna_data: any[];
  airbtics_markets: any[];
  summary: {
    cities_count: number;
    airdna_count: number;
    markets_count: number;
  };
}

export const getDatabaseStatus = async (): Promise<DatabaseStatus> => {
  const cacheKey = 'database_status';
  const cached = getCached<DatabaseStatus>(cacheKey);
  if (cached) return cached;
  
  const response = await axios.get(`${API_BASE}/database/status`);
  setCache(cacheKey, response.data, DEFAULT_CACHE_TTL);
  return response.data;
};

export const exportDatabase = async (): Promise<DataExport> => {
  const response = await axios.get(`${API_BASE}/database/export`);
  return response.data;
};

export const importDatabase = async (data: DataExport): Promise<any> => {
  const response = await axios.post(`${API_BASE}/database/import`, data);
  invalidateCache();
  return response.data;
};

// ==================== Opportunity Finder ====================

export interface OpportunityListing {
  listing_id: number;
  address: string;
  city: string;
  state: string;
  zip_code?: string;
  bedrooms: number;
  bathrooms?: number;
  sqft?: number;
  monthly_rent: number;
  url?: string;
  photos?: string[];
  agent_name?: string;
  agent_phone?: string;
  agent_email?: string;
  agent_company?: string;
  listing_source: string;
  has_pool: boolean;
  has_waterfront: boolean;
  has_garage: boolean;
  has_yard: boolean;
  estimated_annual_revenue: number;
  revenue_source: string;
  revenue_confidence: string;
  annual_rent: number;
  estimated_expenses: number;
  estimated_profit: number;
  roi_score: number;
  break_even_occupancy: number;
  strengths: string[];
  weaknesses: string[];
}

export interface OpportunitySearchRequest {
  // Search mode: "nationwide", "cities", "city_radius", "zip_code"
  search_mode?: string;
  
  // For "cities" mode - select specific cities
  cities?: string[];
  
  // For "city_radius" mode - search city + surrounding area
  city?: string;  // Single city e.g., "Austin, TX"
  radius_miles?: number;
  include_center_city?: boolean;
  
  // For "zip_code" mode - search by zip codes
  zip_codes?: string[];
  
  // Common filters
  min_bedrooms?: number;
  max_bedrooms?: number;
  min_profit?: number;
  amenities?: string[];
  max_results?: number;
}

export interface OpportunitySearchResponse {
  opportunities: OpportunityListing[];
  total_found: number;
  markets_searched: number;
  ai_analysis?: string;
  search_criteria: {
    cities: string[];
    min_bedrooms: number;
    max_bedrooms: number;
    min_profit: number;
  };
  generated_at: string;
  listings_analyzed: number;
  revenue_data_sources: Record<string, number>;
  warnings: string[];
}

export interface RealtorApiStatus {
  status: string;
  message: string;
  configured: boolean;
  sample_count?: number;
}

export const findOpportunities = async (
  request: OpportunitySearchRequest
): Promise<OpportunitySearchResponse> => {
  const response = await axios.post(`${API_BASE}/opportunities/find`, request);
  return response.data;
};

export const getRealtorApiStatus = async (): Promise<RealtorApiStatus> => {
  const response = await axios.get(`${API_BASE}/opportunities/api-status`);
  return response.data;
};
