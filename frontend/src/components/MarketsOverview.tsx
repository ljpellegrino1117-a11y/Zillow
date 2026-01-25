'use client';

import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  Database
} from 'lucide-react';
import { 
  getAirbticsCityStatuses,
  syncAirbticsCity,
  AirbticsCityStatus
} from '@/lib/api';

interface Props {
  refreshTrigger?: number;
  onDataChange?: () => void;
}

export default function MarketsOverview({ refreshTrigger, onDataChange }: Props) {
  const [cityStatuses, setCityStatuses] = useState<AirbticsCityStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingCityId, setSyncingCityId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    try {
      setLoading(true);
      const statuses = await getAirbticsCityStatuses();
      setCityStatuses(statuses);
    } catch (err) {
      console.error('Failed to load market data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncCity = async (cityId: number) => {
    try {
      setSyncingCityId(cityId);
      await syncAirbticsCity(cityId, false);
      await loadData();
      onDataChange?.();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingCityId(null);
    }
  };

  const formatLastFetch = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const marketsWithData = cityStatuses.filter(c => c.entries_count > 0).length;
  const totalMarkets = cityStatuses.length;

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (totalMarkets === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <Database className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <h3 className="font-medium text-gray-900 mb-1">No Markets Configured</h3>
        <p className="text-sm text-gray-500">
          Add cities using the City Manager to start tracking markets.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" />
          <span className="font-medium text-gray-900">Markets Overview</span>
          <span className="text-sm text-gray-500">
            ({marketsWithData}/{totalMarkets} with data)
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Table */}
      {expanded && (
        <div className="border-t border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Data Status</th>
                  <th className="px-4 py-3">Entries</th>
                  <th className="px-4 py-3">Bedrooms</th>
                  <th className="px-4 py-3">Last Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cityStatuses.map((city) => (
                  <tr key={city.city_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <span className="font-medium text-gray-900">
                          {city.city}, {city.state}
                        </span>
                        {city.zip_code && (
                          <span className="text-xs text-gray-500">
                            ({city.zip_code})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {city.has_airbtics_data ? (
                        <span className="inline-flex items-center gap-1 text-green-700 bg-green-100 px-2 py-1 rounded text-xs font-medium">
                          <CheckCircle className="h-3 w-3" />
                          Has Data
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 bg-red-100 px-2 py-1 rounded text-xs font-medium">
                          <XCircle className="h-3 w-3" />
                          No Data
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${city.entries_count > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                        {city.entries_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {city.entries_count > 0 ? '1-6 BR' : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm">
                        {city.needs_refresh && city.entries_count > 0 ? (
                          <Clock className="h-3.5 w-3.5 text-yellow-500" />
                        ) : city.entries_count > 0 ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        ) : null}
                        <span className={city.needs_refresh ? 'text-yellow-600' : 'text-gray-600'}>
                          {formatLastFetch(city.last_fetch)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleSyncCity(city.city_id)}
                        disabled={syncingCityId === city.city_id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                          city.entries_count > 0 
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                      >
                        {syncingCityId === city.city_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {city.entries_count > 0 ? 'Refresh' : 'Sync'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Footer */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
            <span>
              {marketsWithData} of {totalMarkets} markets have Airbtics revenue data
            </span>
            <span>
              Total entries: {cityStatuses.reduce((sum, c) => sum + c.entries_count, 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
