'use client';

import { useState, useEffect } from 'react';
import { Save, DollarSign, Loader2, Trash2, Plus, Check, X, Minus } from 'lucide-react';
import { getCities, getAirDNAData, saveAirDNAData, deleteAirDNAData, City, AirDNAData, AirDNAAmenities } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface Props {
  onDataSaved?: () => void;
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];

// Tri-state: true = WITH, false = WITHOUT, undefined = ANY
type AmenityState = true | false | undefined;

// Property amenities for AirDNA revenue matching
// NOTE: Extra rooms (office, den, loft) are NOT here - they determine potential bedrooms on listings
const AMENITY_OPTIONS = [
  { key: 'has_pool', label: 'Pool', icon: '🏊' },
  { key: 'has_hot_tub', label: 'Hot Tub', icon: '🛁' },
  { key: 'has_waterfront', label: 'Waterfront/View', icon: '🌊' },
  { key: 'has_basement', label: 'Basement', icon: '⬇️' },
  { key: 'has_garage', label: 'Garage', icon: '🚗' },
  { key: 'has_yard', label: 'Yard', icon: '🌳' },
  { key: 'has_pet_friendly', label: 'Pet Friendly', icon: '🐕' },
  { key: 'has_mother_in_law', label: 'In-Law Suite', icon: '🏘️' },
];

export default function AirDNAInput({ onDataSaved, refreshTrigger }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [zipCode, setZipCode] = useState<string>('');
  const [existingData, setExistingData] = useState<AirDNAData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // New entry form
  const [bedroomsMin, setBedroomsMin] = useState<number>(3);
  const [bedroomsMax, setBedroomsMax] = useState<number>(3);
  const [revenue, setRevenue] = useState<string>('');
  const [revenueType, setRevenueType] = useState<'annual' | 'monthly'>('annual');
  // Tri-state amenities: true = WITH, false = WITHOUT, undefined = ANY (not set)
  const [selectedAmenities, setSelectedAmenities] = useState<Record<string, AmenityState>>({});
  const [showAmenities, setShowAmenities] = useState(false);

  // Fetch cities on mount and when refreshTrigger changes
  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await getCities();
        setCities(data);
        if (data.length > 0 && !selectedCity) {
          setSelectedCity(data[0].city);
          setSelectedState(data[0].state);
        }
      } catch (error) {
        console.error('Failed to fetch cities:', error);
      }
    };
    fetchCities();
  }, [refreshTrigger]);

  // Fetch AirDNA data when city changes
  useEffect(() => {
    const fetchAirDNAData = async () => {
      if (!selectedCity || !selectedState) return;
      
      setLoading(true);
      try {
        const data = await getAirDNAData(selectedCity, selectedState);
        setExistingData(data);
      } catch (error) {
        console.error('Failed to fetch AirDNA data:', error);
        setExistingData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAirDNAData();
  }, [selectedCity, selectedState]);

  const handleCitySelect = (value: string) => {
    const [city, state] = value.split('|');
    setSelectedCity(city);
    setSelectedState(state);
    setZipCode('');
  };

  // Cycle through: undefined (ANY) -> true (WITH) -> false (WITHOUT) -> undefined (ANY)
  const handleAmenityToggle = (key: string) => {
    setSelectedAmenities(prev => {
      const current = prev[key];
      let next: AmenityState;
      if (current === undefined) next = true;      // ANY -> WITH
      else if (current === true) next = false;      // WITH -> WITHOUT
      else next = undefined;                        // WITHOUT -> ANY
      
      const newState = { ...prev };
      if (next === undefined) {
        delete newState[key];
      } else {
        newState[key] = next;
      }
      return newState;
    });
  };

  const clearAmenities = () => {
    setSelectedAmenities({});
  };

  // Count amenities that have a specific state (WITH or WITHOUT)
  const selectedAmenityCount = Object.keys(selectedAmenities).length;

  const handleSave = async () => {
    if (!selectedCity || !selectedState) return;
    if (!revenue || parseInt(revenue) <= 0) {
      alert('Please enter a revenue value');
      return;
    }

    setSaving(true);
    try {
      // Build amenities object with tri-state values
      // true = WITH (required), false = WITHOUT (excluded)
      const amenities: Record<string, boolean> = {};
      AMENITY_OPTIONS.forEach(opt => {
        const state = selectedAmenities[opt.key];
        if (state !== undefined) {
          amenities[opt.key] = state; // true for WITH, false for WITHOUT
        }
      });

      // Convert monthly to annual if needed (backend always stores annual)
      const annualRevenue = revenueType === 'monthly' 
        ? parseInt(revenue) * 12 
        : parseInt(revenue);

      await saveAirDNAData({
        city: selectedCity,
        state: selectedState,
        zipCode: zipCode || undefined,
        bedroomsMin,
        bedroomsMax,
        averageAnnualRevenue: annualRevenue,
        amenities: Object.keys(amenities).length > 0 ? amenities : undefined
      });
      
      // Refresh data
      const newData = await getAirDNAData(selectedCity, selectedState);
      setExistingData(newData);
      
      // Reset form
      setRevenue('');
      setSelectedAmenities({});
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to save AirDNA data:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this AirDNA entry?')) return;
    
    try {
      await deleteAirDNAData(id);
      const newData = await getAirDNAData(selectedCity, selectedState);
      setExistingData(newData);
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all AirDNA entries for this city?')) return;
    
    try {
      for (const entry of existingData) {
        await deleteAirDNAData(entry.id);
      }
      setExistingData([]);
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to clear AirDNA data:', error);
    }
  };

  const getAmenityBadges = (data: AirDNAData) => {
    const badges: { label: string; icon: string; state: 'with' | 'without' }[] = [];
    
    // Check each amenity - now they can be true (WITH) or false (WITHOUT)
    const amenityMap: Record<string, { label: string; icon: string }> = {
      has_pool: { label: 'Pool', icon: '🏊' },
      has_hot_tub: { label: 'Hot Tub', icon: '🛁' },
      has_waterfront: { label: 'Waterfront', icon: '🌊' },
      has_basement: { label: 'Basement', icon: '⬇️' },
      has_garage: { label: 'Garage', icon: '🚗' },
      has_yard: { label: 'Yard', icon: '🌳' },
      has_pet_friendly: { label: 'Pet Friendly', icon: '🐕' },
      has_mother_in_law: { label: 'In-Law', icon: '🏘️' },
    };

    for (const [key, info] of Object.entries(amenityMap)) {
      const value = (data as any)[key];
      if (value === true) {
        badges.push({ ...info, state: 'with' });
      } else if (value === false) {
        badges.push({ ...info, state: 'without' });
      }
    }
    
    return badges;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-green-600" />
          AirDNA Revenue Data
        </h2>
        {existingData.length > 0 && (
          <button
            onClick={handleClearAll}
            className="btn text-xs py-1 px-2 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
            Clear All
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Add revenue data from AirDNA. Specify bedroom range and optionally filter by amenities for more accurate comparisons.
      </p>

      {/* City selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="input-label">City *</label>
          <select
            value={selectedCity && selectedState ? `${selectedCity}|${selectedState}` : ''}
            onChange={(e) => handleCitySelect(e.target.value)}
            className="input"
          >
            <option value="">Select a city...</option>
            {cities.map(c => (
              <option key={c.id} value={`${c.city}|${c.state}`}>
                {c.city}, {c.state}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">
            Zip Code <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            placeholder="e.g., 60601"
            className="input"
            maxLength={5}
            disabled={!selectedCity}
          />
        </div>
      </div>

      {selectedCity && selectedState && (
        <>
          {/* Add new entry form */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Revenue Entry
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
              {/* Bedroom Range */}
              <div>
                <label className="input-label">Bedrooms Min</label>
                <select
                  value={bedroomsMin}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setBedroomsMin(val);
                    if (bedroomsMax < val) setBedroomsMax(val);
                  }}
                  className="input"
                >
                  {BEDROOM_OPTIONS.map(br => (
                    <option key={br} value={br}>{br} BR</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="input-label">Bedrooms Max</label>
                <select
                  value={bedroomsMax}
                  onChange={(e) => setBedroomsMax(parseInt(e.target.value))}
                  className="input"
                >
                  {BEDROOM_OPTIONS.filter(br => br >= bedroomsMin).map(br => (
                    <option key={br} value={br}>{br} BR</option>
                  ))}
                </select>
              </div>

              {/* Revenue */}
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="input-label mb-0">Revenue *</label>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setRevenueType('monthly')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        revenueType === 'monthly'
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevenueType('annual')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        revenueType === 'annual'
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Annual
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="text"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder={revenueType === 'monthly' ? 'e.g., 5500' : 'e.g., 65000'}
                    className="input pl-7"
                  />
                </div>
                {revenue && parseInt(revenue) > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    {revenueType === 'monthly' ? (
                      <>
                        {formatCurrency(parseInt(revenue))}/mo = <strong>{formatCurrency(parseInt(revenue) * 12)}/yr</strong>
                      </>
                    ) : (
                      <>
                        {formatCurrency(parseInt(revenue))}/yr = {formatCurrency(parseInt(revenue) / 12)}/mo
                      </>
                    )}
                  </p>
                )}
              </div>

              {/* Amenities toggle */}
              <div className="flex items-end">
                <button
                  onClick={() => setShowAmenities(!showAmenities)}
                  className={`btn w-full ${showAmenities || selectedAmenityCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Amenities
                  {selectedAmenityCount > 0 && (
                    <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded text-xs">
                      {selectedAmenityCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Amenity selection - tri-state: WITH / WITHOUT / ANY */}
            {showAmenities && (
              <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium text-gray-600">
                      Click to cycle: <span className="text-gray-400">Any</span> → 
                      <span className="text-green-600 mx-1">WITH</span> → 
                      <span className="text-red-600">WITHOUT</span> → 
                      <span className="text-gray-400">Any</span>
                    </p>
                  </div>
                  {selectedAmenityCount > 0 && (
                    <button onClick={clearAmenities} className="text-xs text-gray-500 hover:text-gray-700">
                      Clear all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map(opt => {
                    const state = selectedAmenities[opt.key];
                    const isWithRequired = state === true;
                    const isWithoutRequired = state === false;
                    
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleAmenityToggle(opt.key)}
                        className={`
                          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                          transition-colors border
                          ${isWithRequired 
                            ? 'bg-green-100 border-green-400 text-green-800' 
                            : isWithoutRequired
                            ? 'bg-red-100 border-red-400 text-red-800'
                            : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
                          }
                        `}
                        title={isWithRequired ? 'WITH (must have)' : isWithoutRequired ? 'WITHOUT (must NOT have)' : 'Any (no filter)'}
                      >
                        {isWithRequired && <Check className="h-3 w-3" />}
                        {isWithoutRequired && <X className="h-3 w-3" />}
                        {!isWithRequired && !isWithoutRequired && <Minus className="h-3 w-3" />}
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-xs">
                  <span className="flex items-center gap-1 text-green-700">
                    <Check className="h-3 w-3" /> = WITH (must have)
                  </span>
                  <span className="flex items-center gap-1 text-red-700">
                    <X className="h-3 w-3" /> = WITHOUT (must NOT have)
                  </span>
                  <span className="flex items-center gap-1 text-gray-500">
                    <Minus className="h-3 w-3" /> = Any (no filter)
                  </span>
                </div>
              </div>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || !revenue || parseInt(revenue) <= 0}
              className="btn-primary"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Entry
                </>
              )}
            </button>
          </div>

          {/* Existing entries */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : existingData.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Existing Entries ({existingData.length})
              </h3>
              <div className="space-y-2">
                {existingData.map(entry => {
                  const badges = getAmenityBadges(entry);
                  return (
                    <div 
                      key={entry.id} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="font-medium text-gray-900">
                            {entry.bedrooms_min === entry.bedrooms_max 
                              ? `${entry.bedrooms_min} BR` 
                              : `${entry.bedrooms_min}-${entry.bedrooms_max} BR`
                            }
                          </span>
                          {entry.zip_code && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              {entry.zip_code}
                            </span>
                          )}
                        </div>
                        <div className="text-green-600 font-semibold">
                          {formatCurrency(entry.average_annual_revenue)}/yr
                          <span className="text-gray-500 font-normal text-sm ml-1">
                            ({formatCurrency(entry.average_annual_revenue / 12)}/mo)
                          </span>
                        </div>
                        {badges.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {badges.map((badge, i) => (
                              <span 
                                key={i} 
                                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                                  badge.state === 'with' 
                                    ? 'bg-green-50 text-green-700' 
                                    : 'bg-red-50 text-red-700'
                                }`}
                                title={`${badge.state === 'with' ? 'WITH' : 'WITHOUT'} ${badge.label}`}
                              >
                                {badge.state === 'with' ? '✓' : '✗'}
                                {badge.icon}
                              </span>
                            ))}
                          </div>
                        )}
                        {badges.length === 0 && (
                          <span className="text-xs text-gray-400">No amenity filter</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 text-sm">
              No AirDNA data entries yet. Add one above to get started.
            </div>
          )}
        </>
      )}

      {cities.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No cities available. Add a city first to enter AirDNA data.
        </div>
      )}
    </div>
  );
}
