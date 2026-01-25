'use client';

import { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Database, 
  CheckCircle2, 
  AlertCircle,
  Plus,
  RefreshCw,
  Settings,
  MapPin
} from 'lucide-react';
import { useData, useDataSummary } from '@/context/DataContext';

interface DataAvailabilityProps {
  onAddMarket?: () => void;
  onFetchListings?: () => void;
  onManageData?: () => void;
}

export default function DataAvailability({ 
  onAddMarket, 
  onFetchListings, 
  onManageData 
}: DataAvailabilityProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { cityStatuses, listingsStats, databaseStatus, isLoading } = useData();
  const { citiesWithData, totalCities, totalListings, dbType } = useDataSummary();

  const citiesWithoutData = cityStatuses.filter(c => !c.has_airbtics_data);
  const totalRevenueEntries = cityStatuses.reduce((sum, c) => sum + c.entries_count, 0);

  // Get listings count per city (approximation based on data)
  const getListingsForCity = (cityName: string) => {
    // This would ideally come from an API, but for now we show a placeholder
    return listingsStats?.active_listings 
      ? Math.round(listingsStats.active_listings / Math.max(totalCities, 1))
      : 0;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40">
      {/* Collapsed Bar */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Database className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">
            Data Availability
          </span>
          {isLoading ? (
            <span className="text-sm text-gray-400">Loading...</span>
          ) : (
            <span className="text-sm text-gray-500">
              ({citiesWithData} market{citiesWithData !== 1 ? 's' : ''} ready
              {citiesWithoutData.length > 0 && `, ${citiesWithoutData.length} need data`})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            dbType === 'PostgreSQL' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {dbType}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-4 max-h-80 overflow-y-auto bg-gray-50">
          <div className="max-w-4xl mx-auto">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-4">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-gray-900">{totalCities}</div>
                <div className="text-xs text-gray-500">Total Markets</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-green-600">{citiesWithData}</div>
                <div className="text-xs text-gray-500">With Revenue Data</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-blue-600">{totalListings.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Active Listings</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-purple-600">{totalRevenueEntries}</div>
                <div className="text-xs text-gray-500">Revenue Entries</div>
              </div>
            </div>

            {/* Markets List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
              {/* Markets with Data */}
              {cityStatuses.filter(c => c.has_airbtics_data).map(city => (
                <div 
                  key={city.city_id}
                  className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-200"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-gray-900">
                      {city.city}, {city.state}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{city.entries_count} entries</span>
                  </div>
                </div>
              ))}

              {/* Markets without Data */}
              {citiesWithoutData.map(city => (
                <div 
                  key={city.city_id}
                  className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-red-200"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-medium text-gray-900">
                      {city.city}, {city.state}
                    </span>
                  </div>
                  <span className="text-xs text-red-600 font-medium">Needs data</span>
                </div>
              ))}
            </div>

            {/* Database Info */}
            <div className="flex items-center justify-between text-xs text-gray-500 mb-4 px-1">
              <span>Database: {dbType}</span>
              <span>Last updated: {new Date().toLocaleDateString()}</span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {onAddMarket && (
                <button
                  onClick={onAddMarket}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Market
                </button>
              )}
              {onFetchListings && (
                <button
                  onClick={onFetchListings}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Fetch Listings
                </button>
              )}
              {onManageData && (
                <button
                  onClick={onManageData}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Manage Data
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
