'use client';

import { useState, useEffect } from 'react';
import { 
  Search, 
  DollarSign, 
  TrendingUp, 
  Phone, 
  Mail, 
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  Home,
  Sparkles,
  Building,
  RefreshCw
} from 'lucide-react';
import { 
  findOpportunities, 
  getRealtorApiStatus,
  getCities,
  OpportunityListing, 
  OpportunitySearchResponse,
  RealtorApiStatus,
  City
} from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

export default function OpportunityFinder({ refreshTrigger }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [minBedrooms, setMinBedrooms] = useState(3);
  const [maxBedrooms, setMaxBedrooms] = useState(8);
  const [minProfit, setMinProfit] = useState(0);
  
  const [results, setResults] = useState<OpportunitySearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<RealtorApiStatus | null>(null);
  
  const [expandedOpportunity, setExpandedOpportunity] = useState<number | null>(null);

  // Load cities on mount
  useEffect(() => {
    const loadCities = async () => {
      try {
        const citiesData = await getCities();
        setCities(citiesData);
        // Auto-select first 3 cities
        if (citiesData.length > 0) {
          setSelectedCities(
            citiesData.slice(0, 3).map(c => `${c.city}, ${c.state}`)
          );
        }
      } catch (err) {
        console.error('Failed to load cities:', err);
      }
    };
    
    const checkApiStatus = async () => {
      try {
        const status = await getRealtorApiStatus();
        setApiStatus(status);
      } catch (err) {
        console.error('Failed to check API status:', err);
      }
    };
    
    loadCities();
    checkApiStatus();
  }, [refreshTrigger]);

  const handleSearch = async () => {
    if (selectedCities.length === 0) {
      setError('Please select at least one city');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await findOpportunities({
        cities: selectedCities,
        min_bedrooms: minBedrooms,
        max_bedrooms: maxBedrooms,
        min_profit: minProfit,
        max_results: 20
      });
      setResults(response);
    } catch (err: any) {
      console.error('Search failed:', err);
      setError(err.response?.data?.detail || 'Failed to search for opportunities');
    } finally {
      setLoading(false);
    }
  };

  const toggleCity = (cityStr: string) => {
    setSelectedCities(prev => 
      prev.includes(cityStr) 
        ? prev.filter(c => c !== cityStr)
        : [...prev, cityStr]
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-green-600 bg-green-100';
    if (score >= 60) return 'text-blue-600 bg-blue-100';
    if (score >= 45) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getProfitColor = (profit: number) => {
    if (profit >= 30000) return 'text-green-600';
    if (profit >= 15000) return 'text-blue-600';
    if (profit >= 0) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="card bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-xl">
            <Search className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              Opportunity Finder
              <Sparkles className="h-5 w-5 text-yellow-500" />
            </h2>
            <p className="text-sm text-gray-600">
              Find the best arbitrage deals with AI-powered analysis
            </p>
          </div>
        </div>
        
        {/* API Status Badge */}
        {apiStatus && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
            apiStatus.configured && apiStatus.status === 'ok'
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiStatus.configured && apiStatus.status === 'ok' ? (
              <>
                <CheckCircle className="h-4 w-4" />
                Realtor API Active
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" />
                Using cached data
              </>
            )}
          </div>
        )}
      </div>

      {/* Search Controls */}
      <div className="bg-white rounded-xl p-5 mb-6 border border-blue-100">
        {/* City Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Markets to Search
          </label>
          <div className="flex flex-wrap gap-2">
            {cities.map(city => {
              const cityStr = `${city.city}, ${city.state}`;
              const isSelected = selectedCities.includes(cityStr);
              return (
                <button
                  key={city.id}
                  onClick={() => toggleCity(cityStr)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {city.city}, {city.state}
                </button>
              );
            })}
            {cities.length === 0 && (
              <p className="text-gray-500 text-sm">No cities configured. Add cities first.</p>
            )}
          </div>
        </div>

        {/* Filters Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Bedrooms
            </label>
            <select
              value={minBedrooms}
              onChange={(e) => setMinBedrooms(Number(e.target.value))}
              className="input w-full"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>{n} BR</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Bedrooms
            </label>
            <select
              value={maxBedrooms}
              onChange={(e) => setMaxBedrooms(Number(e.target.value))}
              className="input w-full"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>{n} BR</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Annual Profit
            </label>
            <select
              value={minProfit}
              onChange={(e) => setMinProfit(Number(e.target.value))}
              className="input w-full"
            >
              <option value={0}>Any</option>
              <option value={10000}>$10,000+</option>
              <option value={20000}>$20,000+</option>
              <option value={30000}>$30,000+</option>
              <option value={50000}>$50,000+</option>
            </select>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={loading || selectedCities.length === 0}
              className="btn btn-primary w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Find Opportunities
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-red-700">
            <XCircle className="h-5 w-5" />
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Results Summary */}
          <div className="bg-white rounded-xl p-4 border border-blue-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">
                Found {results.total_found} Opportunities
              </h3>
              <span className="text-sm text-gray-500">
                Analyzed {results.listings_analyzed} listings across {results.markets_searched} markets
              </span>
            </div>
            
            {/* Warnings */}
            {results.warnings.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {results.warnings.map((warning, i) => (
                  <span key={i} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                    {warning}
                  </span>
                ))}
              </div>
            )}
            
            {/* AI Analysis */}
            {results.ai_analysis && (
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-4 border border-indigo-100">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  <span className="font-medium text-indigo-900">AI Analysis</span>
                </div>
                <p className="text-gray-700 text-sm">{results.ai_analysis}</p>
              </div>
            )}
          </div>

          {/* Opportunities List */}
          {results.opportunities.map((opp, index) => (
            <div 
              key={opp.listing_id || index}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-300 transition-all"
            >
              {/* Main Row */}
              <div 
                className="p-4 cursor-pointer"
                onClick={() => setExpandedOpportunity(
                  expandedOpportunity === index ? null : index
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Rank Badge */}
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                      #{index + 1}
                    </div>
                    
                    {/* Address & Details */}
                    <div>
                      <h4 className="font-semibold text-gray-900">{opp.address}</h4>
                      <div className="flex items-center gap-3 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {opp.city}, {opp.state}
                        </span>
                        <span className="flex items-center gap-1">
                          <Home className="h-3.5 w-3.5" />
                          {opp.bedrooms} BR {opp.bathrooms ? `/ ${opp.bathrooms} BA` : ''}
                        </span>
                        {opp.sqft && (
                          <span>{opp.sqft.toLocaleString()} sqft</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Metrics */}
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Rent</div>
                      <div className="font-semibold">{formatCurrency(opp.monthly_rent)}/mo</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">STR Revenue</div>
                      <div className="font-semibold text-blue-600">
                        {formatCurrency(opp.estimated_annual_revenue)}/yr
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Est. Profit</div>
                      <div className={`font-bold ${getProfitColor(opp.estimated_profit)}`}>
                        {formatCurrency(opp.estimated_profit)}/yr
                      </div>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full font-bold ${getScoreColor(opp.roi_score)}`}>
                      {opp.roi_score}/100
                    </div>
                    {expandedOpportunity === index ? (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </div>
              </div>
              
              {/* Expanded Details */}
              {expandedOpportunity === index && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {/* Financial Details */}
                    <div>
                      <h5 className="font-medium text-gray-900 mb-2">Financials</h5>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Annual Rent:</span>
                          <span>{formatCurrency(opp.annual_rent)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Est. Expenses:</span>
                          <span>{formatCurrency(opp.estimated_expenses)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Break-even Occ:</span>
                          <span>{(opp.break_even_occupancy * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Strengths */}
                    <div>
                      <h5 className="font-medium text-gray-900 mb-2 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        Strengths
                      </h5>
                      <ul className="space-y-1 text-sm">
                        {opp.strengths.map((s, i) => (
                          <li key={i} className="text-green-700">{s}</li>
                        ))}
                        {opp.strengths.length === 0 && (
                          <li className="text-gray-500">None identified</li>
                        )}
                      </ul>
                    </div>
                    
                    {/* Weaknesses */}
                    <div>
                      <h5 className="font-medium text-gray-900 mb-2 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        Risks
                      </h5>
                      <ul className="space-y-1 text-sm">
                        {opp.weaknesses.map((w, i) => (
                          <li key={i} className="text-yellow-700">{w}</li>
                        ))}
                        {opp.weaknesses.length === 0 && (
                          <li className="text-gray-500">None identified</li>
                        )}
                      </ul>
                    </div>
                    
                    {/* Contact Info */}
                    <div>
                      <h5 className="font-medium text-gray-900 mb-2">Contact</h5>
                      <div className="space-y-2 text-sm">
                        {opp.agent_name && (
                          <div className="font-medium">{opp.agent_name}</div>
                        )}
                        {opp.agent_company && (
                          <div className="text-gray-600 flex items-center gap-1">
                            <Building className="h-3.5 w-3.5" />
                            {opp.agent_company}
                          </div>
                        )}
                        {opp.agent_phone && (
                          <a 
                            href={`tel:${opp.agent_phone}`}
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {opp.agent_phone}
                          </a>
                        )}
                        {opp.agent_email && (
                          <a 
                            href={`mailto:${opp.agent_email}`}
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Email Agent
                          </a>
                        )}
                        {opp.url && (
                          <a 
                            href={opp.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View Listing
                          </a>
                        )}
                        {!opp.agent_name && !opp.agent_phone && !opp.url && (
                          <span className="text-gray-500">No contact info available</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Amenities */}
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex flex-wrap gap-2">
                      {opp.has_pool && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Pool</span>
                      )}
                      {opp.has_waterfront && (
                        <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-1 rounded">Waterfront</span>
                      )}
                      {opp.has_garage && (
                        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">Garage</span>
                      )}
                      {opp.has_yard && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Yard</span>
                      )}
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                        Source: {opp.listing_source}
                      </span>
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                        Revenue: {opp.revenue_source} ({opp.revenue_confidence} confidence)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {results.opportunities.length === 0 && (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
              <Search className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Opportunities Found</h3>
              <p className="text-gray-600">
                Try adjusting your filters or adding more cities to search.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Empty State */}
      {!results && !loading && (
        <div className="bg-white/50 rounded-xl p-8 text-center border border-dashed border-blue-200">
          <TrendingUp className="h-12 w-12 text-blue-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Ready to Find Deals
          </h3>
          <p className="text-gray-600 mb-4">
            Select cities and click "Find Opportunities" to discover the best rental arbitrage deals.
          </p>
          <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Home className="h-4 w-4" />
              Real listings
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Profit calculations
            </span>
            <span className="flex items-center gap-1">
              <Phone className="h-4 w-4" />
              Agent contact
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
