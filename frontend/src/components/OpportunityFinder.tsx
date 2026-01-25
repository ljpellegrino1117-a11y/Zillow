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
  RefreshCw,
  Download,
  FileText,
  FileSpreadsheet
} from 'lucide-react';
import { 
  findOpportunities, 
  getRealtorApiStatus,
  getCities,
  getAirbticsCityStatuses,
  OpportunityListing, 
  OpportunitySearchResponse,
  RealtorApiStatus,
  City,
  AirbticsCityStatus
} from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

// Search modes
type SearchMode = 'nationwide' | 'cities' | 'city_radius' | 'zip_code';

export default function OpportunityFinder({ refreshTrigger }: Props) {
  // Search mode state
  const [searchMode, setSearchMode] = useState<SearchMode>('cities');
  
  // Cities mode state
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityDataStatus, setCityDataStatus] = useState<Record<string, AirbticsCityStatus>>({});
  
  // City radius mode state
  const [radiusCity, setRadiusCity] = useState('');
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [includeCenterCity, setIncludeCenterCity] = useState(true);
  
  // Zip code mode state
  const [zipCodes, setZipCodes] = useState('');
  
  // Common filters
  const [minBedrooms, setMinBedrooms] = useState(3);
  const [maxBedrooms, setMaxBedrooms] = useState(8);
  const [minProfit, setMinProfit] = useState(0);
  
  const [results, setResults] = useState<OpportunitySearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<RealtorApiStatus | null>(null);
  
  const [expandedOpportunity, setExpandedOpportunity] = useState<number | null>(null);

  // Load cities and data status on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [citiesData, cityStatuses, apiStatusData] = await Promise.all([
          getCities(),
          getAirbticsCityStatuses(),
          getRealtorApiStatus().catch(() => null)
        ]);
        
        setCities(citiesData);
        
        // Build lookup map for city data status
        const statusMap: Record<string, AirbticsCityStatus> = {};
        cityStatuses.forEach(status => {
          const key = `${status.city}, ${status.state}`;
          statusMap[key] = status;
        });
        setCityDataStatus(statusMap);
        
        if (apiStatusData) {
          setApiStatus(apiStatusData);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    
    loadData();
  }, [refreshTrigger]);
  
  // Helper to get city data info
  const getCityDataInfo = (cityStr: string) => {
    const status = cityDataStatus[cityStr];
    if (!status) return { hasData: false, entries: 0 };
    return {
      hasData: status.has_airbtics_data,
      entries: status.entries_count,
      needsRefresh: status.needs_refresh
    };
  };
  
  // Count cities with/without data
  const selectedWithData = selectedCities.filter(c => getCityDataInfo(c).hasData).length;
  const selectedWithoutData = selectedCities.length - selectedWithData;
  
  // Count total markets with data (for nationwide search info)
  const totalMarketsWithData = Object.values(cityDataStatus).filter(s => s.has_airbtics_data).length;

  const handleSearch = async () => {
    // Validate based on search mode
    if (searchMode === 'cities' && selectedCities.length === 0) {
      setError('Please select at least one city');
      return;
    }
    if (searchMode === 'city_radius' && !radiusCity.trim()) {
      setError('Please enter a city for radius search');
      return;
    }
    if (searchMode === 'zip_code' && !zipCodes.trim()) {
      setError('Please enter at least one zip code');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Build request based on search mode
      const request: any = {
        search_mode: searchMode,
        min_bedrooms: minBedrooms,
        max_bedrooms: maxBedrooms,
        min_profit: minProfit,
        max_results: 20
      };
      
      if (searchMode === 'cities') {
        request.cities = selectedCities;
      } else if (searchMode === 'city_radius') {
        request.city = radiusCity;
        request.radius_miles = radiusMiles;
        request.include_center_city = includeCenterCity;
      } else if (searchMode === 'zip_code') {
        request.zip_codes = zipCodes.split(',').map(z => z.trim()).filter(z => z);
      }
      // nationwide mode doesn't need extra params
      
      const response = await findOpportunities(request);
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

  // Export to CSV with listing URLs prominently included
  const exportToCSV = () => {
    if (!results || results.opportunities.length === 0) return;
    
    const headers = [
      'Rank',
      'ROI Score',
      'Address',
      'City',
      'State',
      'Zip Code',
      'Bedrooms',
      'Bathrooms',
      'Sqft',
      'Monthly Rent',
      'Annual Rent',
      'Est. Annual Revenue',
      'Est. Expenses',
      'Est. Annual Profit',
      'Break-Even Occupancy',
      'Agent Name',
      'Agent Phone',
      'Agent Email',
      'Agent Company',
      'Listing URL',  // Important: URL included
      'Has Pool',
      'Has Waterfront',
      'Has Garage',
      'Has Yard',
      'Strengths',
      'Weaknesses',
      'Data Source'
    ];
    
    const rows = results.opportunities.map((opp, index) => [
      index + 1,
      opp.roi_score,
      opp.address,
      opp.city,
      opp.state,
      opp.zip_code || '',
      opp.bedrooms,
      opp.bathrooms || '',
      opp.sqft || '',
      opp.monthly_rent,
      opp.annual_rent,
      opp.estimated_annual_revenue,
      opp.estimated_expenses,
      opp.estimated_profit,
      `${(opp.break_even_occupancy * 100).toFixed(1)}%`,
      opp.agent_name || '',
      opp.agent_phone || '',
      opp.agent_email || '',
      opp.agent_company || '',
      opp.url || '',  // The listing URL
      opp.has_pool ? 'Yes' : 'No',
      opp.has_waterfront ? 'Yes' : 'No',
      opp.has_garage ? 'Yes' : 'No',
      opp.has_yard ? 'Yes' : 'No',
      opp.strengths.join('; '),
      opp.weaknesses.join('; '),
      opp.revenue_source
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arbitrage-opportunities-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export to PDF with listing URLs as clickable links
  const exportToPDF = () => {
    if (!results || results.opportunities.length === 0) return;
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Arbitrage Opportunities Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
          h1 { color: #1e40af; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
          h2 { color: #1e40af; margin-top: 30px; }
          .summary { background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
          .summary-item { text-align: center; }
          .summary-value { font-size: 24px; font-weight: bold; color: #1e40af; }
          .summary-label { font-size: 12px; color: #6b7280; }
          .opportunity { border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 15px; page-break-inside: avoid; }
          .opportunity-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .rank { background: #1e40af; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
          .score { padding: 4px 12px; border-radius: 20px; font-weight: bold; }
          .score-high { background: #dcfce7; color: #16a34a; }
          .score-good { background: #dbeafe; color: #2563eb; }
          .score-medium { background: #fef3c7; color: #d97706; }
          .score-low { background: #fee2e2; color: #dc2626; }
          .address { font-size: 18px; font-weight: 600; margin: 5px 0; }
          .location { color: #6b7280; font-size: 14px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; background: #f9fafb; padding: 10px; border-radius: 6px; }
          .metric { text-align: center; }
          .metric-value { font-size: 16px; font-weight: 600; }
          .metric-label { font-size: 11px; color: #6b7280; }
          .profit-positive { color: #16a34a; }
          .profit-negative { color: #dc2626; }
          .contact-section { background: #f0f9ff; padding: 10px; border-radius: 6px; margin: 10px 0; }
          .contact-title { font-weight: 600; color: #1e40af; margin-bottom: 5px; }
          .contact-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; font-size: 13px; }
          .listing-link { display: block; margin-top: 10px; }
          .listing-link a { color: #2563eb; font-weight: 500; }
          .strengths-weaknesses { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; }
          .strengths { color: #16a34a; }
          .weaknesses { color: #d97706; }
          .list-title { font-weight: 600; margin-bottom: 5px; }
          .amenities { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
          .amenity { background: #e5e7eb; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
          .ai-analysis { background: #faf5ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 15px; margin: 20px 0; }
          .ai-title { color: #7c3aed; font-weight: 600; margin-bottom: 10px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          @media print { 
            body { padding: 10px; }
            .opportunity { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>Arbitrage Opportunities Report</h1>
        <p>Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        
        <div class="summary">
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-value">${results.total_found}</div>
              <div class="summary-label">Opportunities Found</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${results.markets_searched}</div>
              <div class="summary-label">Markets Searched</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${results.listings_analyzed}</div>
              <div class="summary-label">Listings Analyzed</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${results.search_criteria.min_bedrooms}-${results.search_criteria.max_bedrooms} BR</div>
              <div class="summary-label">Bedroom Range</div>
            </div>
          </div>
        </div>

        ${results.ai_analysis ? `
        <div class="ai-analysis">
          <div class="ai-title">AI Analysis</div>
          <p>${results.ai_analysis}</p>
        </div>
        ` : ''}

        <h2>Top Opportunities</h2>
        
        ${results.opportunities.map((opp, index) => `
          <div class="opportunity">
            <div class="opportunity-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="rank">${index + 1}</div>
                <div>
                  <div class="address">${opp.address}</div>
                  <div class="location">${opp.city}, ${opp.state} ${opp.zip_code || ''} | ${opp.bedrooms} BR ${opp.bathrooms ? `/ ${opp.bathrooms} BA` : ''} ${opp.sqft ? `| ${opp.sqft.toLocaleString()} sqft` : ''}</div>
                </div>
              </div>
              <div class="score ${opp.roi_score >= 75 ? 'score-high' : opp.roi_score >= 60 ? 'score-good' : opp.roi_score >= 45 ? 'score-medium' : 'score-low'}">
                ${opp.roi_score}/100
              </div>
            </div>
            
            <div class="metrics">
              <div class="metric">
                <div class="metric-value">$${opp.monthly_rent.toLocaleString()}/mo</div>
                <div class="metric-label">Monthly Rent</div>
              </div>
              <div class="metric">
                <div class="metric-value">$${opp.estimated_annual_revenue.toLocaleString()}/yr</div>
                <div class="metric-label">Est. STR Revenue</div>
              </div>
              <div class="metric">
                <div class="metric-value">$${opp.estimated_expenses.toLocaleString()}/yr</div>
                <div class="metric-label">Est. Expenses</div>
              </div>
              <div class="metric">
                <div class="metric-value ${opp.estimated_profit >= 0 ? 'profit-positive' : 'profit-negative'}">$${opp.estimated_profit.toLocaleString()}/yr</div>
                <div class="metric-label">Est. Profit</div>
              </div>
            </div>
            
            <div class="contact-section">
              <div class="contact-title">Contact Information</div>
              <div class="contact-grid">
                ${opp.agent_name ? `<div><strong>Agent:</strong> ${opp.agent_name}</div>` : ''}
                ${opp.agent_company ? `<div><strong>Company:</strong> ${opp.agent_company}</div>` : ''}
                ${opp.agent_phone ? `<div><strong>Phone:</strong> ${opp.agent_phone}</div>` : ''}
                ${opp.agent_email ? `<div><strong>Email:</strong> ${opp.agent_email}</div>` : ''}
              </div>
              ${opp.url ? `
              <div class="listing-link">
                <strong>Listing URL:</strong> <a href="${opp.url}" target="_blank">${opp.url}</a>
              </div>
              ` : ''}
            </div>
            
            <div class="strengths-weaknesses">
              <div class="strengths">
                <div class="list-title">Strengths</div>
                ${opp.strengths.length > 0 ? opp.strengths.map(s => `<div>+ ${s}</div>`).join('') : '<div>None identified</div>'}
              </div>
              <div class="weaknesses">
                <div class="list-title">Risks</div>
                ${opp.weaknesses.length > 0 ? opp.weaknesses.map(w => `<div>- ${w}</div>`).join('') : '<div>None identified</div>'}
              </div>
            </div>
            
            <div class="amenities">
              ${opp.has_pool ? '<span class="amenity">Pool</span>' : ''}
              ${opp.has_waterfront ? '<span class="amenity">Waterfront</span>' : ''}
              ${opp.has_garage ? '<span class="amenity">Garage</span>' : ''}
              ${opp.has_yard ? '<span class="amenity">Yard</span>' : ''}
              <span class="amenity">Source: ${opp.listing_source}</span>
              <span class="amenity">Break-even: ${(opp.break_even_occupancy * 100).toFixed(0)}% occupancy</span>
            </div>
          </div>
        `).join('')}
        
        <div class="footer">
          <p><strong>Score Guide:</strong> 75+ = Strong opportunity, 60-74 = Good opportunity, 45-59 = Moderate, &lt;45 = Higher risk</p>
          <p><strong>Note:</strong> Profit estimates include operating costs (cleaning, supplies, platform fees, utilities, insurance, maintenance). Actual results may vary based on local market conditions and management efficiency.</p>
          <p>Report generated by Zillow Arbitrage Tool</p>
        </div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
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
              Instant Opportunity Finder
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
        {/* Search Mode Selector */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search Mode
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSearchMode('nationwide')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                searchMode === 'nationwide'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Search all markets that have revenue data"
            >
              <MapPin className="h-4 w-4" />
              All Markets
            </button>
            <button
              onClick={() => setSearchMode('cities')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                searchMode === 'cities'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Select from your configured cities"
            >
              <Building className="h-4 w-4" />
              My Saved Cities
            </button>
            <button
              onClick={() => setSearchMode('city_radius')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                searchMode === 'city_radius'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Search any city + surrounding area"
            >
              <Home className="h-4 w-4" />
              Search by City
            </button>
            <button
              onClick={() => setSearchMode('zip_code')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                searchMode === 'zip_code'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Search by specific zip codes"
            >
              <MapPin className="h-4 w-4" />
              Search by Zip
            </button>
          </div>
        </div>

        {/* Mode-specific inputs */}
        {searchMode === 'nationwide' && (
          <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-700">
                <Sparkles className="h-5 w-5" />
                <span className="font-medium">Nationwide Search</span>
              </div>
              <span className={`px-2 py-1 rounded text-sm font-medium ${
                totalMarketsWithData > 0 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-red-100 text-red-700'
              }`}>
                {totalMarketsWithData} markets with data
              </span>
            </div>
            <p className="text-sm text-blue-600 mt-1">
              {totalMarketsWithData > 0 
                ? `Will search ${totalMarketsWithData} markets that have Airbtics revenue data.`
                : 'No markets have revenue data yet. Add data in Data Management below.'}
            </p>
          </div>
        )}

        {searchMode === 'cities' && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Select from Your Saved Markets
              </label>
              {selectedCities.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Selected:</span>
                  <span className="text-green-600 font-medium">{selectedWithData} with data</span>
                  {selectedWithoutData > 0 && (
                    <span className="text-red-600 font-medium">{selectedWithoutData} missing data</span>
                  )}
                </div>
              )}
            </div>
            
            {/* City Selection Grid */}
            <div className="border border-gray-200 rounded-lg p-3 max-h-60 overflow-y-auto bg-white">
              {cities.length > 0 ? (
                <div className="space-y-1">
                  {cities.map(city => {
                    const cityStr = `${city.city}, ${city.state}`;
                    const isSelected = selectedCities.includes(cityStr);
                    const dataInfo = getCityDataInfo(cityStr);
                    
                    return (
                      <label
                        key={city.id}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-blue-50 border border-blue-200' 
                            : 'hover:bg-gray-50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCity(cityStr)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className={`font-medium ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                            {city.city}, {city.state}
                          </span>
                        </div>
                        
                        {/* Data Status Indicator */}
                        {dataInfo.hasData ? (
                          <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                            <CheckCircle className="h-3 w-3" />
                            {dataInfo.entries} entries
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                            <XCircle className="h-3 w-3" />
                            No data
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6">
                  <AlertTriangle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-medium">No saved markets</p>
                  <p className="text-gray-500 text-sm mt-1">
                    Add cities in Data Management below, or use "Search by City" to search any city.
                  </p>
                </div>
              )}
            </div>
            
            {/* Warning for missing data */}
            {selectedWithoutData > 0 && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                <div className="flex items-center gap-2 text-yellow-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span>
                    {selectedWithoutData} selected {selectedWithoutData === 1 ? 'market has' : 'markets have'} no revenue data.
                    Results will be limited to markets with data.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {searchMode === 'city_radius' && (
          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target City (e.g., Austin, TX)
              </label>
              <input
                type="text"
                value={radiusCity}
                onChange={(e) => setRadiusCity(e.target.value)}
                placeholder="Enter city, state (e.g., Austin, TX)"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Radius (miles)
              </label>
              <input
                type="number"
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
                min={0}
                max={100}
                className="input w-full"
              />
              <p className="text-xs text-gray-500 mt-1">Set to 0 for target city only</p>
            </div>
            <div className="md:col-span-3">
              <label className="flex items-center gap-2 cursor-pointer group relative">
                <input
                  type="checkbox"
                  checked={!includeCenterCity}
                  onChange={(e) => setIncludeCenterCity(!e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Do not include target city in results</span>
                <div className="relative">
                  <AlertTriangle className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    Use this if target city does not allow short-term rentals
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}

        {searchMode === 'zip_code' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zip Codes (comma-separated)
            </label>
            <input
              type="text"
              value={zipCodes}
              onChange={(e) => setZipCodes(e.target.value)}
              placeholder="e.g., 78701, 78702, 78703"
              className="input w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Enter one or more zip codes separated by commas</p>
          </div>
        )}

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
              disabled={loading || (searchMode === 'cities' && selectedCities.length === 0) || (searchMode === 'city_radius' && !radiusCity.trim()) || (searchMode === 'zip_code' && !zipCodes.trim())}
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
              <div>
                <h3 className="font-semibold text-gray-900">
                  Found {results.total_found} Opportunities
                </h3>
                <span className="text-sm text-gray-500">
                  Analyzed {results.listings_analyzed} listings across {results.markets_searched} markets
                </span>
              </div>
              
              {/* Export Buttons - prominently displayed */}
              <div className="flex gap-2">
                <button
                  onClick={exportToCSV}
                  className="btn btn-secondary text-sm flex items-center gap-1.5"
                  title="Export to CSV with all data including listing URLs"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Export CSV
                </button>
                <button
                  onClick={exportToPDF}
                  className="btn btn-secondary text-sm flex items-center gap-1.5"
                  title="Export to PDF report with clickable listing links"
                >
                  <FileText className="h-4 w-4" />
                  Export PDF
                </button>
              </div>
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
      
      {/* Empty State - with data awareness */}
      {!results && !loading && (
        <div className="space-y-4">
          {/* Warning if no data at all */}
          {totalMarketsWithData === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="bg-yellow-100 p-3 rounded-lg">
                  <AlertTriangle className="h-6 w-6 text-yellow-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-yellow-800 mb-1">
                    No Revenue Data Available
                  </h3>
                  <p className="text-yellow-700 mb-4">
                    The Opportunity Finder needs Airbtics revenue data to calculate profits.
                    Add revenue data to start finding arbitrage opportunities.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <div className="bg-white rounded-lg p-3 border border-yellow-200">
                      <div className="font-medium text-gray-900 mb-1">Option 1: Sync Airbtics Data</div>
                      <p className="text-sm text-gray-600">
                        Automatically pull revenue data from Airbtics API (requires API credits)
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-yellow-200">
                      <div className="font-medium text-gray-900 mb-1">Option 2: Manual Entry</div>
                      <p className="text-sm text-gray-600">
                        Manually enter revenue data from AirDNA screenshots
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-yellow-600 mt-3">
                    Open "Data Management" below to add revenue data.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Ready state when data exists */}
          {totalMarketsWithData > 0 && (
            <div className="bg-white/50 rounded-xl p-8 text-center border border-dashed border-blue-200">
              <TrendingUp className="h-12 w-12 text-blue-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Ready to Find Deals
              </h3>
              <p className="text-gray-600 mb-4">
                You have revenue data for <strong>{totalMarketsWithData} markets</strong>.
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
      )}
    </div>
  );
}
