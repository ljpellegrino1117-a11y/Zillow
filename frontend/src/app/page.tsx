'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Search, 
  MapPin, 
  BarChart3, 
  DollarSign, 
  Zap, 
  Settings,
  ChevronDown,
  Loader2,
  Home,
  Bug,
  Database
} from 'lucide-react';
import Link from 'next/link';
import { useData } from '@/context/DataContext';
import AIAdvisor from '@/components/AIAdvisor';
import DataAvailability from '@/components/DataAvailability';
import SearchResults from '@/components/SearchResults';
import { LocationsFilter, STRCompsFilter, ProfitFilter } from '@/components/filters';
import type { LocationFilters, STRCompsFilters, ProfitFilters } from '@/components/filters';
import { findOpportunities, OpportunitySearchResponse } from '@/lib/api';

// Default filter values
const defaultLocationFilters: LocationFilters = {
  mode: 'all',
  selectedCities: [],
  radiusCity: '',
  radiusMiles: 25,
  excludeTargetCity: false
};

const defaultSTRFilters: STRCompsFilters = {
  minBedrooms: 3,
  maxBedrooms: 8,
  amenities: {
    pool: false,
    waterfront: false,
    garage: false,
    yard: false,
    petFriendly: false,
    hotTub: false
  },
  basement: 'any',
  confidence: 'any'
};

// Default min_profit is very negative to include all opportunities (including losses)
const defaultProfitFilters: ProfitFilters = {
  minProfit: -999999,
  minRent: 0,
  maxRent: 50000,
  minROI: 0,
  maxBreakEven: 100
};

type DropdownType = 'locations' | 'comps' | 'profit' | null;

export default function Dashboard() {
  // Filter states
  const [locationFilters, setLocationFilters] = useState<LocationFilters>(defaultLocationFilters);
  const [strFilters, setSTRFilters] = useState<STRCompsFilters>(defaultSTRFilters);
  const [profitFilters, setProfitFilters] = useState<ProfitFilters>(defaultProfitFilters);
  
  // UI states
  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<OpportunitySearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNavMenu, setShowNavMenu] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Search bar state - for quick city/radius search
  const [searchQuery, setSearchQuery] = useState('');

  const { cityStatuses, refreshAll } = useData();
  const citiesWithData = cityStatuses.filter(c => c.has_airbtics_data);

  // Close nav menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setShowNavMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check if filters have been modified (or search query present)
  const hasLocationFilters = locationFilters.mode !== 'all' || 
    locationFilters.selectedCities.length > 0 ||
    locationFilters.radiusCity !== '' ||
    searchQuery.trim() !== '';
  
  const hasSTRFilters = strFilters.minBedrooms !== 3 || 
    strFilters.maxBedrooms !== 8 ||
    Object.values(strFilters.amenities).some(v => v) ||
    strFilters.basement !== 'any';
  
  // Note: minProfit defaults to -999999 to show all, so check against that
  const hasProfitFilters = profitFilters.minProfit > -999999 || 
    profitFilters.minROI > 0 ||
    profitFilters.maxBreakEven < 100;

  const toggleDropdown = (type: DropdownType) => {
    setActiveDropdown(activeDropdown === type ? null : type);
  };

  const handleSearch = useCallback(async (isRapid = false) => {
    setIsSearching(true);
    setError(null);
    setActiveDropdown(null);

    try {
      // Build search request
      const request: any = {
        min_bedrooms: strFilters.minBedrooms,
        max_bedrooms: strFilters.maxBedrooms,
        min_profit: profitFilters.minProfit,
        max_results: 50
      };

      // Check if user typed something in search bar - use that as city_radius search
      const trimmedQuery = searchQuery.trim();
      const hasSearchQuery = trimmedQuery !== '';

      // Handle location mode
      if (isRapid) {
        // Rapid search always searches all markets
        request.search_mode = 'nationwide';
      } else if (hasSearchQuery) {
        // Search bar takes priority - search by city name/radius
        request.search_mode = 'city_radius';
        request.city = trimmedQuery;
        request.radius_miles = locationFilters.radiusMiles || 25;
        request.include_center_city = true;
      } else if (locationFilters.mode === 'all') {
        request.search_mode = 'nationwide';
      } else if (locationFilters.mode === 'select') {
        request.search_mode = 'cities';
        request.cities = locationFilters.selectedCities;
      } else if (locationFilters.mode === 'radius') {
        request.search_mode = 'city_radius';
        request.city = locationFilters.radiusCity;
        request.radius_miles = locationFilters.radiusMiles;
        request.include_center_city = !locationFilters.excludeTargetCity;
      }

      // Add amenity filters
      const amenities: string[] = [];
      if (strFilters.amenities.pool) amenities.push('pool');
      if (strFilters.amenities.waterfront) amenities.push('waterfront');
      if (strFilters.amenities.garage) amenities.push('garage');
      if (strFilters.amenities.yard) amenities.push('yard');
      if (amenities.length > 0) {
        request.amenities = amenities;
      }

      // Add basement filter
      if (strFilters.basement !== 'any') {
        request.basement_filter = strFilters.basement; // 'include' or 'exclude'
      }

      const response = await findOpportunities(request);
      setResults(response);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Search failed. Please try again.');
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [locationFilters, strFilters, profitFilters, searchQuery]);

  const handleManageData = () => {
    window.location.href = '/manage';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Navigation Dropdown - Top Left */}
      <div className="absolute top-4 left-4 z-20" ref={navRef}>
        <button
          onClick={() => setShowNavMenu(!showNavMenu)}
          className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition-colors"
        >
          <Home className="w-5 h-5" />
          <span className="text-sm font-medium">Search</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showNavMenu ? 'rotate-180' : ''}`} />
        </button>

        {showNavMenu && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Views
            </div>
            <Link
              href="/"
              className="flex items-center gap-3 px-3 py-2 text-gray-900 bg-blue-50 border-l-2 border-blue-500"
            >
              <Home className="w-4 h-4 text-blue-600" />
              <div>
                <span className="text-sm font-medium">Search</span>
                <p className="text-xs text-gray-500">Find opportunities</p>
              </div>
            </Link>
            <Link
              href="/advanced"
              className="flex items-center gap-3 px-3 py-2 text-gray-700 hover:bg-gray-50 border-l-2 border-transparent"
            >
              <Bug className="w-4 h-4 text-amber-500" />
              <div>
                <span className="text-sm font-medium">Advanced / Debug</span>
                <p className="text-xs text-gray-500">Detailed controls & testing</p>
              </div>
            </Link>
            <Link
              href="/manage"
              className="flex items-center gap-3 px-3 py-2 text-gray-700 hover:bg-gray-50 border-l-2 border-transparent"
            >
              <Database className="w-4 h-4 text-green-500" />
              <div>
                <span className="text-sm font-medium">Data Management</span>
                <p className="text-xs text-gray-500">Markets & revenue data</p>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* Settings Icon - Top Right */}
      <div className="absolute top-4 right-4 z-10">
        <button 
          onClick={handleManageData}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-colors"
          title="Manage data"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center pt-16 px-4">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            <span className="text-blue-600">Zillow</span> Arbitrage
          </h1>
          <p className="text-gray-500 mt-2">Find profitable rental arbitrage deals</p>
        </div>

        {/* Search Bar */}
        <div className="w-full max-w-2xl mb-4">
          <div className="flex items-center bg-white border border-gray-300 rounded-full px-5 py-3 shadow-sm hover:shadow-md focus-within:shadow-md transition-shadow">
            <Search className="w-5 h-5 text-gray-400 mr-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(false);
                }
              }}
              placeholder="Enter city name (e.g., Kansas City, MO)..."
              className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400"
              onFocus={() => setActiveDropdown(null)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1 hover:bg-gray-100 rounded-full ml-2"
              >
                <span className="text-gray-400 text-sm">×</span>
              </button>
            )}
          </div>
          {searchQuery.trim() && (
            <p className="text-xs text-gray-500 mt-1 ml-4">
              Press Enter or click Search to find opportunities in "{searchQuery.trim()}"
            </p>
          )}
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 mb-4 relative">
          {/* Locations Filter */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('locations')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'locations'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : hasLocationFilters
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span className="text-sm font-medium">Locations</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'locations' ? 'rotate-180' : ''}`} />
            </button>
            <LocationsFilter
              isOpen={activeDropdown === 'locations'}
              onClose={() => setActiveDropdown(null)}
              filters={locationFilters}
              onApply={setLocationFilters}
            />
          </div>

          {/* STR Comps Filter */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('comps')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'comps'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : hasSTRFilters
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm font-medium">STR Comps</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'comps' ? 'rotate-180' : ''}`} />
            </button>
            <STRCompsFilter
              isOpen={activeDropdown === 'comps'}
              onClose={() => setActiveDropdown(null)}
              filters={strFilters}
              onApply={setSTRFilters}
            />
          </div>

          {/* Profit Filter */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('profit')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'profit'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : hasProfitFilters
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Profit</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'profit' ? 'rotate-180' : ''}`} />
            </button>
            <ProfitFilter
              isOpen={activeDropdown === 'profit'}
              onClose={() => setActiveDropdown(null)}
              filters={profitFilters}
              onApply={setProfitFilters}
            />
          </div>
        </div>

        {/* Search Buttons */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => handleSearch(true)}
            disabled={isSearching || citiesWithData.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full font-medium shadow-md hover:shadow-lg hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Search all markets at once, ignoring location filters. Best for finding top opportunities quickly."
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Rapid Search
          </button>
          <button
            onClick={() => handleSearch(false)}
            disabled={isSearching || citiesWithData.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-full font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Search using your selected filters (Locations, STR Comps, Profit). Best for targeted searches."
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search
          </button>
        </div>

        {/* AI Advisor */}
        <AIAdvisor searchResults={results} isSearching={isSearching} />

        {/* Error Display */}
        {error && (
          <div className="w-full max-w-2xl mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        <SearchResults results={results} isLoading={isSearching} />
      </main>

      {/* Data Availability Footer */}
      <DataAvailability
        onAddMarket={() => window.location.href = '/manage'}
        onFetchListings={() => {
          // Could trigger batch scrape here
          window.location.href = '/manage';
        }}
        onManageData={() => window.location.href = '/manage'}
      />
    </div>
  );
}
