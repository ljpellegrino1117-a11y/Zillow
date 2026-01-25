'use client';

/**
 * NEW UI DESIGN MOCKUP
 * Google-like simplified interface
 * 
 * This is a preview of the proposed design - not yet active
 */

import { useState } from 'react';
import { 
  Search, 
  MapPin, 
  BarChart3, 
  DollarSign, 
  Zap, 
  ChevronDown, 
  Settings,
  ExternalLink,
  X,
  Check
} from 'lucide-react';

// Mock data for preview
const MOCK_CITIES = [
  { name: 'Austin, TX', entries: 5, hasData: true },
  { name: 'Denver, CO', entries: 5, hasData: true },
  { name: 'Phoenix, AZ', entries: 5, hasData: true },
  { name: 'Nashville, TN', entries: 5, hasData: true },
  { name: 'Seattle, WA', entries: 3, hasData: true },
  { name: 'Atlanta, GA', entries: 3, hasData: true },
  { name: 'Kansas City, MO', entries: 5, hasData: true },
  { name: 'New York City, NY', entries: 5, hasData: true },
  { name: 'San Antonio, TX', entries: 3, hasData: true },
];

type DropdownType = 'locations' | 'comps' | 'profit' | null;

export default function NewDesignMockup() {
  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<'all' | 'select' | 'radius'>('all');
  const [minBedrooms, setMinBedrooms] = useState(3);
  const [maxBedrooms, setMaxBedrooms] = useState(8);
  const [minProfit, setMinProfit] = useState(0);
  const [results, setResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const toggleDropdown = (type: DropdownType) => {
    setActiveDropdown(activeDropdown === type ? null : type);
  };

  const handleRapidSearch = () => {
    setIsSearching(true);
    // Simulate search
    setTimeout(() => {
      setResults([
        { rank: 1, score: 87, address: '123 Main St', city: 'Austin, TX', beds: 4, rent: 2400, profit: 29500 },
        { rank: 2, score: 82, address: '456 Oak Ave', city: 'Denver, CO', beds: 5, rent: 2800, profit: 27200 },
        { rank: 3, score: 79, address: '789 Pine Rd', city: 'Phoenix, AZ', beds: 4, rent: 2100, profit: 25800 },
      ]);
      setIsSearching(false);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Settings Icon - Top Right */}
      <div className="absolute top-4 right-4">
        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content - Centered */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 -mt-20">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            <span className="text-blue-600">Zillow</span> Arbitrage
          </h1>
          <p className="text-gray-500 mt-2">Find profitable rental arbitrage deals</p>
        </div>

        {/* Search Bar */}
        <div className="w-full max-w-2xl mb-6">
          <div className="relative">
            <div className="flex items-center bg-white border border-gray-300 rounded-full px-5 py-3 shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-gray-400 transition-all">
              <Search className="w-5 h-5 text-gray-400 mr-3" />
              <input
                type="text"
                placeholder="Search for rental arbitrage opportunities..."
                className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-3 mb-6">
          {/* Locations */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('locations')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'locations' 
                  ? 'bg-blue-50 border-blue-300 text-blue-700' 
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span className="text-sm font-medium">Locations</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'locations' ? 'rotate-180' : ''}`} />
            </button>

            {/* Locations Dropdown */}
            {activeDropdown === 'locations' && (
              <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Locations</h3>
                  <button onClick={() => setActiveDropdown(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Search Mode */}
                <div className="space-y-2 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={searchMode === 'all'} onChange={() => setSearchMode('all')} className="text-blue-600" />
                    <span className="text-sm">All markets ({MOCK_CITIES.length})</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={searchMode === 'select'} onChange={() => setSearchMode('select')} className="text-blue-600" />
                    <span className="text-sm">Select cities</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={searchMode === 'radius'} onChange={() => setSearchMode('radius')} className="text-blue-600" />
                    <span className="text-sm">City + radius</span>
                  </label>
                </div>

                {/* City Selection */}
                {searchMode === 'select' && (
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 mb-4">
                    {MOCK_CITIES.map(city => (
                      <label key={city.name} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedCities.includes(city.name)}
                            onChange={() => {
                              setSelectedCities(prev =>
                                prev.includes(city.name)
                                  ? prev.filter(c => c !== city.name)
                                  : [...prev, city.name]
                              );
                            }}
                            className="rounded text-blue-600"
                          />
                          <span className="text-sm">{city.name}</span>
                        </div>
                        <span className="text-xs text-green-600">{city.entries} entries</span>
                      </label>
                    ))}
                  </div>
                )}

                {/* Radius Input */}
                {searchMode === 'radius' && (
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Austin, TX"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                      <option>25 mi</option>
                      <option>50 mi</option>
                      <option>100 mi</option>
                    </select>
                  </div>
                )}

                <button className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  Apply
                </button>
              </div>
            )}
          </div>

          {/* STR Comps */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('comps')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'comps' 
                  ? 'bg-blue-50 border-blue-300 text-blue-700' 
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm font-medium">STR Comps</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'comps' ? 'rotate-180' : ''}`} />
            </button>

            {/* Comps Dropdown */}
            {activeDropdown === 'comps' && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">STR Comps</h3>
                  <button onClick={() => setActiveDropdown(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Bedrooms */}
                <div className="mb-4">
                  <label className="text-sm text-gray-600 mb-1 block">Bedrooms</label>
                  <div className="flex items-center gap-2">
                    <select 
                      value={minBedrooms}
                      onChange={(e) => setMinBedrooms(Number(e.target.value))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} BR</option>)}
                    </select>
                    <span className="text-gray-400">to</span>
                    <select 
                      value={maxBedrooms}
                      onChange={(e) => setMaxBedrooms(Number(e.target.value))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} BR</option>)}
                    </select>
                  </div>
                </div>

                {/* Amenities */}
                <div className="mb-4">
                  <label className="text-sm text-gray-600 mb-2 block">Amenities</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Pool', 'Waterfront', 'Garage', 'Yard'].map(amenity => (
                      <label key={amenity} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rounded text-blue-600" />
                        <span className="text-sm">{amenity}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  Apply
                </button>
              </div>
            )}
          </div>

          {/* Profit */}
          <div className="relative">
            <button
              onClick={() => toggleDropdown('profit')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeDropdown === 'profit' 
                  ? 'bg-blue-50 border-blue-300 text-blue-700' 
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Profit</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activeDropdown === 'profit' ? 'rotate-180' : ''}`} />
            </button>

            {/* Profit Dropdown */}
            {activeDropdown === 'profit' && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Profit Constraints</h3>
                  <button onClick={() => setActiveDropdown(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Min Profit */}
                <div className="mb-4">
                  <label className="text-sm text-gray-600 mb-2 block">Minimum Annual Profit</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 0, label: 'Any' },
                      { value: 10000, label: '$10k+' },
                      { value: 20000, label: '$20k+' },
                      { value: 50000, label: '$50k+' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setMinProfit(opt.value)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          minProfit === opt.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ROI Score */}
                <div className="mb-4">
                  <label className="text-sm text-gray-600 mb-2 block">Minimum ROI Score</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 0, label: 'Any' },
                      { value: 50, label: '50+' },
                      { value: 60, label: '60+' },
                      { value: 75, label: '75+' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Rapid Search Button */}
        <button
          onClick={handleRapidSearch}
          disabled={isSearching}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full font-semibold shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Zap className={`w-5 h-5 ${isSearching ? 'animate-pulse' : ''}`} />
          {isSearching ? 'Searching...' : 'Rapid Search'}
        </button>

        {/* Results Preview */}
        {results && (
          <div className="w-full max-w-3xl mt-10">
            <div className="text-center mb-6">
              <p className="text-gray-600">
                Found <span className="font-semibold text-gray-900">{results.length}</span> opportunities
              </p>
            </div>

            <div className="space-y-4">
              {results.map(result => (
                <div key={result.rank} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                        #{result.rank}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{result.address}</h3>
                        <p className="text-sm text-gray-500">{result.city} • {result.beds} BR • ${result.rent.toLocaleString()}/mo</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Annual Profit</p>
                        <p className="font-bold text-green-600">${result.profit.toLocaleString()}</p>
                      </div>
                      <div className={`px-3 py-1 rounded-full font-bold ${
                        result.score >= 80 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {result.score}/100
                      </div>
                      <button className="p-2 text-gray-400 hover:text-blue-600">
                        <ExternalLink className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer Status */}
      <footer className="text-center py-4 text-sm text-gray-400">
        {MOCK_CITIES.length} markets • 3,804 listings • Ready to search
      </footer>
    </div>
  );
}
