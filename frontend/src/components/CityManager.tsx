'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, MapPin, Clock, Loader2, Map, DollarSign, AlertCircle } from 'lucide-react';
import { 
  City, 
  getCities, 
  createCity, 
  deleteCity, 
  startScrape, 
  getScrapeStatus,
  ScrapeStatus 
} from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';

interface Props {
  onCityChange?: () => void;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export default function CityManager({ onCityChange }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [newZipCode, setNewZipCode] = useState('');
  const [includeSurrounding, setIncludeSurrounding] = useState(false);
  const [surroundingMiles, setSurroundingMiles] = useState<number | string>(25);
  const [surroundingOnly, setSurroundingOnly] = useState(false);
  // Price range filters
  const [rentMin, setRentMin] = useState<string>('');
  const [rentMax, setRentMax] = useState<string>('');
  const [purchasePriceMin, setPurchasePriceMin] = useState<string>('');
  const [purchasePriceMax, setPurchasePriceMax] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrapeStatuses, setScrapeStatuses] = useState<Record<string, ScrapeStatus>>({});

  const fetchCities = useCallback(async () => {
    try {
      const data = await getCities();
      setCities(data);
    } catch (error) {
      console.error('Failed to fetch cities:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCities();
  }, [fetchCities]);

  // Poll for scrape status
  useEffect(() => {
    const runningCities = Object.entries(scrapeStatuses)
      .filter(([, status]) => status.status === 'running')
      .map(([key]) => key);

    if (runningCities.length === 0) return;

    const interval = setInterval(async () => {
      for (const key of runningCities) {
        const parts = key.split('_');
        const city = parts[0];
        const state = parts[1];
        const zipCode = parts.length > 2 ? parts[2] : undefined;
        try {
          const status = await getScrapeStatus(city, state, zipCode);
          setScrapeStatuses(prev => ({ ...prev, [key]: status }));
          
          if (status.status !== 'running') {
            fetchCities();
            onCityChange?.();
          }
        } catch (error) {
          console.error(`Failed to get status for ${key}:`, error);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [scrapeStatuses, fetchCities, onCityChange]);

  const handleAddCity = async () => {
    if (!newCity.trim() || !newState.trim()) return;
    setError(null);

    try {
      await createCity({
        city: newCity.trim(),
        state: newState.trim(),
        zipCode: newZipCode.trim() || undefined,
        includeSurrounding,
        surroundingMiles: includeSurrounding ? (Number(surroundingMiles) || 25) : undefined,
        surroundingOnly: includeSurrounding ? surroundingOnly : false,
        rentMin: rentMin ? parseInt(rentMin) : undefined,
        rentMax: rentMax ? parseInt(rentMax) : undefined,
        purchasePriceMin: purchasePriceMin ? parseInt(purchasePriceMin) : undefined,
        purchasePriceMax: purchasePriceMax ? parseInt(purchasePriceMax) : undefined
      });
      setNewCity('');
      setNewState('');
      setNewZipCode('');
      setIncludeSurrounding(false);
      setSurroundingMiles(25);
      setSurroundingOnly(false);
      setRentMin('');
      setRentMax('');
      setPurchasePriceMin('');
      setPurchasePriceMax('');
      await fetchCities();
      onCityChange?.();
    } catch (err: any) {
      console.error('Failed to add city:', err);
      setError(err?.response?.data?.detail || err?.message || 'Failed to add search. Please try again.');
    }
  };

  const handleDeleteCity = async (city: string, state: string, zipCode?: string | null) => {
    const zipInfo = zipCode ? ` (${zipCode})` : '';
    if (!confirm(`Delete ${city}, ${state}${zipInfo} and all associated data?`)) return;

    try {
      await deleteCity(city, state, zipCode || undefined);
      await fetchCities();
      onCityChange?.();
    } catch (error) {
      console.error('Failed to delete city:', error);
    }
  };

  const handleStartScrape = async (c: City) => {
    const key = `${c.city}_${c.state}` + (c.zip_code ? `_${c.zip_code}` : '');
    try {
      const status = await startScrape({
        city: c.city,
        state: c.state,
        zipCode: c.zip_code || undefined,
        includeSurrounding: c.include_surrounding,
        surroundingMiles: c.surrounding_miles || undefined,
        surroundingOnly: c.surrounding_only
      });
      setScrapeStatuses(prev => ({ ...prev, [key]: status }));
    } catch (error) {
      console.error('Failed to start scrape:', error);
    }
  };

  const getScrapeStatusBadge = (c: City) => {
    const key = `${c.city}_${c.state}` + (c.zip_code ? `_${c.zip_code}` : '');
    const status = scrapeStatuses[key];
    if (!status) return null;

    switch (status.status) {
      case 'running':
        return (
          <span className="badge badge-warning flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Scraping...
          </span>
        );
      case 'completed':
        return (
          <span className="badge badge-success">
            {status.listings_found} listings
          </span>
        );
      case 'failed':
        return (
          <span className="badge badge-error" title={status.message}>
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  const getLocationDescription = (c: City) => {
    let desc = '';
    if (c.surrounding_only && c.surrounding_miles) {
      desc = `Surrounding only (${c.surrounding_miles} mi)`;
    } else if (c.include_surrounding && c.surrounding_miles) {
      desc = `+ ${c.surrounding_miles} mi radius`;
    }
    return desc;
  };

  const getPriceFilters = (c: City) => {
    const filters = [];
    if (c.rent_min || c.rent_max) {
      const min = c.rent_min ? formatCurrency(c.rent_min) : '';
      const max = c.rent_max ? formatCurrency(c.rent_max) : '';
      if (min && max) filters.push(`Rent: ${min}-${max}`);
      else if (min) filters.push(`Rent: ${min}+`);
      else if (max) filters.push(`Rent: up to ${max}`);
    }
    if (c.purchase_price_min || c.purchase_price_max) {
      const min = c.purchase_price_min ? formatCurrency(c.purchase_price_min) : '';
      const max = c.purchase_price_max ? formatCurrency(c.purchase_price_max) : '';
      if (min && max) filters.push(`Buy: ${min}-${max}`);
      else if (min) filters.push(`Buy: ${min}+`);
      else if (max) filters.push(`Buy: up to ${max}`);
    }
    return filters;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary-600" />
        Rental Cities Search
      </h2>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
            &times;
          </button>
        </div>
      )}

      {/* Add new city form */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="input-label">City*</label>
            <input
              type="text"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="e.g., Chicago"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">State*</label>
            <select
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              className="input"
            >
              <option value="">Select state...</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="input-label">Zip Code <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={newZipCode}
              onChange={(e) => setNewZipCode(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
              placeholder="e.g., 60601"
              className="input"
              maxLength={5}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddCity}
              disabled={!newCity.trim() || !newState.trim()}
              className="btn-primary w-full"
            >
              <Plus className="h-4 w-4" />
              Add Search
            </button>
          </div>
        </div>

        {/* Price Range Filters */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium text-gray-700">Price Filters</span>
            <span className="text-xs text-gray-400">(leave blank for no limit)</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="input-label text-xs">Rent Min (monthly)</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  value={rentMin}
                  onChange={(e) => setRentMin(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="No limit"
                  className="input pl-6 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="input-label text-xs">Rent Max (monthly)</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  value={rentMax}
                  onChange={(e) => setRentMax(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="No limit"
                  className="input pl-6 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="input-label text-xs">Purchase Min (for sale)</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  value={purchasePriceMin}
                  onChange={(e) => setPurchasePriceMin(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="No limit"
                  className="input pl-6 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="input-label text-xs">Purchase Max (for sale)</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  value={purchasePriceMax}
                  onChange={(e) => setPurchasePriceMax(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="No limit"
                  className="input pl-6 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Surrounding cities options */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Map className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-gray-700">Surrounding Cities</span>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSurrounding}
                onChange={(e) => {
                  setIncludeSurrounding(e.target.checked);
                  if (!e.target.checked) {
                    setSurroundingOnly(false);
                  }
                }}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Include surrounding cities within</span>
            </label>
            
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={surroundingMiles}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setSurroundingMiles('');
                  } else {
                    const num = parseInt(val);
                    if (!isNaN(num)) {
                      setSurroundingMiles(Math.max(1, Math.min(100, num)));
                    }
                  }
                }}
                onBlur={() => {
                  // Reset to default if empty when leaving field
                  if (surroundingMiles === '' || surroundingMiles === 0) {
                    setSurroundingMiles(25);
                  }
                }}
                disabled={!includeSurrounding}
                className="input w-20 text-center"
                min={1}
                max={100}
              />
              <span className="text-sm text-gray-700">miles</span>
            </div>

            <div className="border-l border-gray-300 pl-4 ml-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={surroundingOnly}
                  onChange={(e) => setSurroundingOnly(e.target.checked)}
                  disabled={!includeSurrounding}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span className={`text-sm ${!includeSurrounding ? 'text-gray-400' : 'text-orange-700 font-medium'}`}>
                  ONLY surrounding (exclude main city)
                </span>
              </label>
            </div>
          </div>
          
          {includeSurrounding && (
            <p className="text-xs text-gray-500 mt-2">
              {surroundingOnly 
                ? `Will search cities within ${surroundingMiles || 25} miles, but NOT include ${newCity || 'the main city'} itself.`
                : `Will search ${newCity || 'the main city'} AND surrounding cities within ${surroundingMiles || 25} miles.`
              }
            </p>
          )}
        </div>
        
        <p className="text-xs text-gray-500">
          Add a city to search. Optionally specify a zip code to narrow results or include surrounding cities.
        </p>
      </div>

      {/* Cities list */}
      {cities.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No searches added yet. Add a city above to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Zip / Radius
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Price Filters
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Last Scraped
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cities.map((c) => {
                const key = `${c.city}_${c.state}` + (c.zip_code ? `_${c.zip_code}` : '');
                const isRunning = scrapeStatuses[key]?.status === 'running';
                const locationDesc = getLocationDescription(c);
                const priceFilters = getPriceFilters(c);
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div>{c.city}, {c.state}</div>
                      {locationDesc && (
                        <div className="text-xs text-blue-600 flex items-center gap-1">
                          <Map className="h-3 w-3" />
                          {locationDesc}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.zip_code ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-sm font-medium">
                          {c.zip_code}
                        </span>
                      ) : c.include_surrounding && c.surrounding_miles ? (
                        <span className={`px-2 py-0.5 rounded text-sm font-medium ${c.surrounding_only ? 'bg-orange-50 text-orange-700' : 'bg-green-50 text-green-700'}`}>
                          {c.surrounding_only ? 'Surrounding only' : 'City + area'}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">All areas</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {priceFilters.length > 0 ? (
                        <div className="space-y-1">
                          {priceFilters.map((f, i) => (
                            <div key={i} className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded inline-block mr-1">
                              {f}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">No limits</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.last_scraped ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(c.last_scraped)}
                        </span>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getScrapeStatusBadge(c)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleStartScrape(c)}
                          disabled={isRunning}
                          className="btn-secondary text-xs py-1 px-2"
                          title="Scrape Zillow"
                        >
                          <RefreshCw className={`h-3 w-3 ${isRunning ? 'animate-spin' : ''}`} />
                          Scrape
                        </button>
                        <button
                          onClick={() => handleDeleteCity(c.city, c.state, c.zip_code)}
                          className="btn text-xs py-1 px-2 text-red-600 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
