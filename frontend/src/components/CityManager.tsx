'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, MapPin, Clock, Loader2 } from 'lucide-react';
import { 
  City, 
  getCities, 
  createCity, 
  deleteCity, 
  startScrape, 
  getScrapeStatus,
  ScrapeStatus 
} from '@/lib/api';
import { formatDate } from '@/lib/utils';

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
  const [loading, setLoading] = useState(true);
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

    try {
      await createCity(newCity.trim(), newState.trim(), newZipCode.trim() || undefined);
      setNewCity('');
      setNewState('');
      setNewZipCode('');
      await fetchCities();
      onCityChange?.();
    } catch (error) {
      console.error('Failed to add city:', error);
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

  const handleStartScrape = async (city: string, state: string, zipCode?: string | null) => {
    const key = `${city}_${state}` + (zipCode ? `_${zipCode}` : '');
    try {
      const status = await startScrape(city, state, 3, 8, zipCode || undefined);
      setScrapeStatuses(prev => ({ ...prev, [key]: status }));
    } catch (error) {
      console.error('Failed to start scrape:', error);
    }
  };

  const getScrapeStatusBadge = (city: string, state: string, zipCode?: string | null) => {
    const key = `${city}_${state}` + (zipCode ? `_${zipCode}` : '');
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

      {/* Add new city form */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
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
        <p className="text-xs text-gray-500 mt-2">
          Add a city to search. Optionally specify a zip code to narrow results to that area.
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
                  Zip Code
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
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.city}, {c.state}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.zip_code ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-sm font-medium">
                          {c.zip_code}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">All areas</span>
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
                      {getScrapeStatusBadge(c.city, c.state, c.zip_code)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleStartScrape(c.city, c.state, c.zip_code)}
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
