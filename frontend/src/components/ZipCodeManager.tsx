'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, MapPin, Clock, Loader2 } from 'lucide-react';
import { 
  ZipCode, 
  getZipCodes, 
  createZipCode, 
  deleteZipCode, 
  startScrape, 
  getScrapeStatus,
  ScrapeStatus 
} from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Props {
  onZipCodeChange?: () => void;
}

export default function ZipCodeManager({ onZipCodeChange }: Props) {
  const [zipCodes, setZipCodes] = useState<ZipCode[]>([]);
  const [newZipCode, setNewZipCode] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [loading, setLoading] = useState(true);
  const [scrapeStatuses, setScrapeStatuses] = useState<Record<string, ScrapeStatus>>({});

  const fetchZipCodes = useCallback(async () => {
    try {
      const data = await getZipCodes();
      setZipCodes(data);
    } catch (error) {
      console.error('Failed to fetch zip codes:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchZipCodes();
  }, [fetchZipCodes]);

  // Poll for scrape status updates
  useEffect(() => {
    const runningZips = Object.entries(scrapeStatuses)
      .filter(([, status]) => status.status === 'running')
      .map(([zip]) => zip);

    if (runningZips.length === 0) return;

    const interval = setInterval(async () => {
      for (const zip of runningZips) {
        try {
          const status = await getScrapeStatus(zip);
          setScrapeStatuses(prev => ({ ...prev, [zip]: status }));
          
          if (status.status !== 'running') {
            fetchZipCodes();
            onZipCodeChange?.();
          }
        } catch (error) {
          console.error(`Failed to get status for ${zip}:`, error);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [scrapeStatuses, fetchZipCodes, onZipCodeChange]);

  const handleAddZipCode = async () => {
    if (!newZipCode.trim()) return;

    try {
      await createZipCode(newZipCode.trim(), newCity.trim() || undefined, newState.trim() || undefined);
      setNewZipCode('');
      setNewCity('');
      setNewState('');
      await fetchZipCodes();
      onZipCodeChange?.();
    } catch (error) {
      console.error('Failed to add zip code:', error);
    }
  };

  const handleDeleteZipCode = async (zipCode: string) => {
    if (!confirm(`Delete ${zipCode} and all associated data?`)) return;

    try {
      await deleteZipCode(zipCode);
      await fetchZipCodes();
      onZipCodeChange?.();
    } catch (error) {
      console.error('Failed to delete zip code:', error);
    }
  };

  const handleStartScrape = async (zipCode: string) => {
    try {
      const status = await startScrape(zipCode);
      setScrapeStatuses(prev => ({ ...prev, [zipCode]: status }));
    } catch (error) {
      console.error('Failed to start scrape:', error);
    }
  };

  const getScrapeStatusBadge = (zipCode: string) => {
    const status = scrapeStatuses[zipCode];
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
        Zip Codes
      </h2>

      {/* Add new zip code form */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="input-label">Zip Code*</label>
            <input
              type="text"
              value={newZipCode}
              onChange={(e) => setNewZipCode(e.target.value)}
              placeholder="e.g., 60601"
              className="input"
              maxLength={10}
            />
          </div>
          <div>
            <label className="input-label">City</label>
            <input
              type="text"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="e.g., Chicago"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">State</label>
            <input
              type="text"
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              placeholder="e.g., IL"
              className="input"
              maxLength={2}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddZipCode}
              disabled={!newZipCode.trim()}
              className="btn-primary w-full"
            >
              <Plus className="h-4 w-4" />
              Add Zip Code
            </button>
          </div>
        </div>
      </div>

      {/* Zip codes list */}
      {zipCodes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No zip codes added yet. Add a zip code above to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Zip Code
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Location
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
              {zipCodes.map((zip) => (
                <tr key={zip.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {zip.zip_code}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {zip.city && zip.state ? `${zip.city}, ${zip.state}` : zip.city || zip.state || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {zip.last_scraped ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(zip.last_scraped)}
                      </span>
                    ) : (
                      <span className="text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {getScrapeStatusBadge(zip.zip_code)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleStartScrape(zip.zip_code)}
                        disabled={scrapeStatuses[zip.zip_code]?.status === 'running'}
                        className="btn-secondary text-xs py-1 px-2"
                        title="Scrape Zillow"
                      >
                        <RefreshCw className={`h-3 w-3 ${scrapeStatuses[zip.zip_code]?.status === 'running' ? 'animate-spin' : ''}`} />
                        Scrape
                      </button>
                      <button
                        onClick={() => handleDeleteZipCode(zip.zip_code)}
                        className="btn text-xs py-1 px-2 text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
