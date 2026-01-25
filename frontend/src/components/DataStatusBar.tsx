'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp,
  Loader2,
  MapPin,
  Home
} from 'lucide-react';
import { useData, useDataSummary } from '@/context/DataContext';
import { 
  startBatchScrapeAllCities,
  getBatchScrapeStatus,
  BatchScrapeStatus
} from '@/lib/api';

interface DataStatusBarProps {
  onSyncClick?: () => void;
  refreshTrigger?: number;
}

export default function DataStatusBar({ onSyncClick, refreshTrigger }: DataStatusBarProps) {
  const { cityStatuses, listingsStats, databaseStatus, isLoading, refreshAll, refreshListings } = useData();
  const { citiesWithData, totalCities, totalListings, dbType } = useDataSummary();
  
  const [batchScrapeStatus, setBatchScrapeStatus] = useState<BatchScrapeStatus | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Check for existing scrape on mount
  useEffect(() => {
    const checkScrapeStatus = async () => {
      try {
        const status = await getBatchScrapeStatus();
        setBatchScrapeStatus(status);
        if (status.status === 'running' || status.status === 'starting') {
          setIsScraping(true);
        }
      } catch (e) {
        // Ignore
      }
    };
    checkScrapeStatus();
  }, []);

  // Poll for scrape status
  useEffect(() => {
    if (!isScraping) return;
    
    let timeoutId: NodeJS.Timeout;
    let pollCount = 0;
    
    const poll = async () => {
      try {
        const status = await getBatchScrapeStatus();
        setBatchScrapeStatus(status);
        
        if (status.status === 'completed' || status.status === 'idle') {
          setIsScraping(false);
          refreshListings();
          return;
        }
        
        pollCount++;
        const delay = pollCount > 10 ? 8000 : pollCount > 5 ? 5000 : 2000;
        timeoutId = setTimeout(poll, delay);
      } catch (e) {
        timeoutId = setTimeout(poll, 10000);
      }
    };
    
    timeoutId = setTimeout(poll, 2000);
    return () => clearTimeout(timeoutId);
  }, [isScraping, refreshListings]);

  const handleScrapeAll = async () => {
    try {
      setIsScraping(true);
      const response = await startBatchScrapeAllCities(3, 8);
      if (response.status === 'no_cities' || response.status === 'error') {
        setIsScraping(false);
      }
    } catch (e) {
      setIsScraping(false);
    }
  };

  const marketsNeedingData = cityStatuses.filter(c => !c.has_airbtics_data);
  const totalEntries = cityStatuses.reduce((sum, c) => sum + c.entries_count, 0);

  // Status styling
  const getStatusStyle = () => {
    if (totalCities === 0) return 'bg-gray-100 border-gray-300';
    if (citiesWithData === 0) return 'bg-red-50 border-red-300';
    if (citiesWithData < totalCities) return 'bg-yellow-50 border-yellow-300';
    return 'bg-green-50 border-green-300';
  };

  const getStatusIcon = () => {
    if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-gray-400" />;
    if (totalCities === 0) return <Database className="w-5 h-5 text-gray-500" />;
    if (citiesWithData === 0) return <AlertCircle className="w-5 h-5 text-red-500" />;
    if (citiesWithData < totalCities) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  };

  const getStatusText = () => {
    if (isLoading) return 'Loading data...';
    if (totalCities === 0) return 'No Markets Configured';
    if (citiesWithData === 0) return 'No Revenue Data Available';
    if (citiesWithData < totalCities) return `${citiesWithData}/${totalCities} Markets Ready`;
    return `All ${totalCities} Markets Ready`;
  };

  return (
    <div className={`${getStatusStyle()} border rounded-lg mb-4 transition-all`}>
      {/* Compact Status Bar */}
      <div className="px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">{getStatusText()}</span>
              {totalListings > 0 && (
                <span className="text-gray-500 text-sm">• {totalListings.toLocaleString()} listings</span>
              )}
              {totalEntries > 0 && (
                <span className="text-gray-500 text-sm">• {totalEntries} revenue entries</span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* DB Type Badge */}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              dbType === 'PostgreSQL' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}>
              {dbType}
            </span>
            
            {/* Scrape Button */}
            {citiesWithData > 0 && (
              <button
                onClick={handleScrapeAll}
                disabled={isScraping}
                className={`px-3 py-1.5 text-white text-sm rounded flex items-center gap-1.5 transition-colors ${
                  isScraping ? 'bg-orange-500' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {batchScrapeStatus?.completed_cities !== undefined 
                      ? `${batchScrapeStatus.completed_cities}/${batchScrapeStatus.total_cities}`
                      : 'Starting...'
                    }
                  </>
                ) : (
                  <>
                    <Home className="w-3.5 h-3.5" />
                    Fetch Listings
                  </>
                )}
              </button>
            )}
            
            {/* Expand/Collapse */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-white/50 rounded"
            >
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              )}
            </button>
          </div>
        </div>
        
        {/* Scrape Progress Bar */}
        {isScraping && batchScrapeStatus && batchScrapeStatus.total_cities > 0 && (
          <div className="mt-2">
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${(batchScrapeStatus.completed_cities / batchScrapeStatus.total_cities) * 100}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {batchScrapeStatus.current_city && `Fetching ${batchScrapeStatus.current_city}...`}
            </div>
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white/50">
          <div className="grid grid-cols-2 gap-4">
            {/* Markets with Data */}
            <div>
              <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                Ready ({citiesWithData})
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {cityStatuses.filter(c => c.has_airbtics_data).map(city => (
                  <span key={city.city_id} className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {city.city}, {city.state}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Markets Missing Data */}
            {marketsNeedingData.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-red-700 mb-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Need Data ({marketsNeedingData.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {marketsNeedingData.map(city => (
                    <span key={city.city_id} className="px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {city.city}, {city.state}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Listings Summary */}
          {listingsStats && listingsStats.active_listings > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">Active: <strong>{listingsStats.active_listings}</strong></span>
                <span className="text-blue-600">Realtor: <strong>{listingsStats.listings_by_source?.realtor || 0}</strong></span>
                <span className="text-purple-600">Zillow: <strong>{listingsStats.listings_by_source?.zillow || 0}</strong></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
