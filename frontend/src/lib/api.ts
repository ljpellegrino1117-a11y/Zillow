import axios from 'axios';

const API_BASE = '/api';

export interface ZipCode {
  id: number;
  zip_code: string;
  city: string | null;
  state: string | null;
  created_at: string;
  last_scraped: string | null;
}

export interface ZillowListing {
  id: number;
  zillow_id: string;
  zip_code_id: number;
  address: string;
  city: string | null;
  state: string | null;
  bedrooms: number;
  bathrooms: number | null;
  price: number;
  description: string | null;
  property_type: string | null;
  sqft: number | null;
  url: string | null;
  scraped_at: string;
}

export interface AirDNAData {
  id: number;
  zip_code_id: number;
  bedrooms: number;
  average_annual_revenue: number;
  updated_at: string;
}

export interface DiscrepancyResult {
  zip_code: string;
  city: string | null;
  state: string | null;
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
  zip_code: string;
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

// Zip Code API
export const getZipCodes = async (): Promise<ZipCode[]> => {
  const response = await axios.get(`${API_BASE}/zip-codes`);
  return response.data;
};

export const createZipCode = async (zipCode: string, city?: string, state?: string): Promise<ZipCode> => {
  const response = await axios.post(`${API_BASE}/zip-codes`, {
    zip_code: zipCode,
    city,
    state,
  });
  return response.data;
};

export const deleteZipCode = async (zipCode: string): Promise<void> => {
  await axios.delete(`${API_BASE}/zip-codes/${zipCode}`);
};

// Scraping API
export const startScrape = async (zipCode: string, minBedrooms = 3, maxBedrooms = 8): Promise<ScrapeStatus> => {
  const response = await axios.post(`${API_BASE}/scrape`, {
    zip_code: zipCode,
    min_bedrooms: minBedrooms,
    max_bedrooms: maxBedrooms,
  });
  return response.data;
};

export const getScrapeStatus = async (zipCode: string): Promise<ScrapeStatus> => {
  const response = await axios.get(`${API_BASE}/scrape/${zipCode}/status`);
  return response.data;
};

// Listings API
export const getListings = async (
  zipCode?: string,
  bedrooms?: number,
  minPrice?: number,
  maxPrice?: number,
  limit = 100,
  offset = 0
): Promise<ZillowListing[]> => {
  const params = new URLSearchParams();
  if (zipCode) params.append('zip_code', zipCode);
  if (bedrooms !== undefined) params.append('bedrooms', bedrooms.toString());
  if (minPrice !== undefined) params.append('min_price', minPrice.toString());
  if (maxPrice !== undefined) params.append('max_price', maxPrice.toString());
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());
  
  const response = await axios.get(`${API_BASE}/listings?${params.toString()}`);
  return response.data;
};

export const getListingStats = async (zipCode?: string): Promise<ListingStats[]> => {
  const params = zipCode ? `?zip_code=${zipCode}` : '';
  const response = await axios.get(`${API_BASE}/listings/stats${params}`);
  return response.data;
};

// AirDNA API
export const saveAirDNAData = async (
  zipCode: string,
  data: Array<{ bedrooms: number; average_annual_revenue: number }>
): Promise<AirDNAData[]> => {
  const response = await axios.post(`${API_BASE}/airdna`, {
    zip_code: zipCode,
    data,
  });
  return response.data;
};

export const getAirDNAData = async (zipCode: string): Promise<AirDNAData[]> => {
  const response = await axios.get(`${API_BASE}/airdna/${zipCode}`);
  return response.data;
};

// Analysis API
export const getDiscrepancyAnalysis = async (
  zipCode?: string,
  minBedrooms = 3,
  maxBedrooms = 8
): Promise<DiscrepancyResult[]> => {
  const params = new URLSearchParams();
  if (zipCode) params.append('zip_code', zipCode);
  params.append('min_bedrooms', minBedrooms.toString());
  params.append('max_bedrooms', maxBedrooms.toString());
  
  const response = await axios.get(`${API_BASE}/analysis/discrepancy?${params.toString()}`);
  return response.data;
};
