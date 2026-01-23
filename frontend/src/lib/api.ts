import axios from 'axios';

const API_BASE = '/api';

export interface City {
  id: number;
  city: string;
  state: string;
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
  has_waterview: boolean;
  has_waterfront: boolean;
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
  scraped_at: string;
}

export interface AirDNAData {
  id: number;
  city_id: number;
  zip_code: string | null;
  bedrooms: number;
  average_annual_revenue: number;
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
}

export interface ScrapeStatus {
  city: string;
  state: string;
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
  has_waterview?: boolean;
  has_waterfront?: boolean;
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

// City API
export const getCities = async (): Promise<City[]> => {
  const response = await axios.get(`${API_BASE}/cities`);
  return response.data;
};

export const createCity = async (city: string, state: string): Promise<City> => {
  const response = await axios.post(`${API_BASE}/cities`, { city, state });
  return response.data;
};

export const deleteCity = async (city: string, state: string): Promise<void> => {
  await axios.delete(`${API_BASE}/cities/${encodeURIComponent(city)}/${encodeURIComponent(state)}`);
};

// Scraping API
export const startScrape = async (city: string, state: string, minBedrooms = 3, maxBedrooms = 8): Promise<ScrapeStatus> => {
  const response = await axios.post(`${API_BASE}/scrape`, {
    city,
    state,
    min_bedrooms: minBedrooms,
    max_bedrooms: maxBedrooms,
  });
  return response.data;
};

export const getScrapeStatus = async (city: string, state: string): Promise<ScrapeStatus> => {
  const response = await axios.get(`${API_BASE}/scrape/${encodeURIComponent(city)}/${encodeURIComponent(state)}/status`);
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
  
  const response = await axios.get(`${API_BASE}/listings?${params.toString()}`);
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
  const response = await axios.get(`${API_BASE}/listings/amenity-counts?${params.toString()}`);
  return response.data;
};

// AirDNA API
export const saveAirDNAData = async (
  city: string,
  state: string,
  data: Array<{ bedrooms: number; average_annual_revenue: number }>,
  zipCode?: string
): Promise<AirDNAData[]> => {
  const response = await axios.post(`${API_BASE}/airdna`, { 
    city, 
    state, 
    zip_code: zipCode || null,
    data 
  });
  return response.data;
};

export const getAirDNAData = async (city: string, state: string, zipCode?: string): Promise<AirDNAData[]> => {
  const params = zipCode ? `?zip_code=${encodeURIComponent(zipCode)}` : '';
  const response = await axios.get(`${API_BASE}/airdna/${encodeURIComponent(city)}/${encodeURIComponent(state)}${params}`);
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
  
  const response = await axios.get(`${API_BASE}/analysis/discrepancy?${params.toString()}`);
  return response.data;
};
