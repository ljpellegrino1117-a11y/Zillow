'use client';

import React, { useState, useEffect } from 'react';
import { 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp,
  RefreshCw,
  Loader2,
  MapPin,
  Home,
  Clock,
  Building2
} from 'lucide-react';
import { 
  getAirbticsCityStatuses, 
  getDatabaseStatus,
  getListingsLifecycleStats,
  startBatchScrapeAllCities,
  getBatchScrapeStatus,
  AirbticsCityStatus,
  DatabaseStatus,
  ListingsLifecycleStats,
  BatchScrapeStatus
} from '@/lib/api';

interface DataStatusBarProps {
  onSyncClick?: () => void;
  refreshTrigger?: number;
}

export default function DataStatusBar({ onSyncClick, refreshTrigger }: DataStatusBarProps) {
  const [cityStatuses, setCityStatuses] = useState<AirbticsCityStatus[]>([]);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [listingsStats, setListingsStats] = useState<ListingsLifecycleStats | null>(null);
  const [batchScrapeStatus, setBatchScrapeStatus] = useState<BatchScrapeStatus | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  // Poll for batch scrape status when scraping - with exponential backoff
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let pollCount = 0;
    
    if (isScraping) {
      const poll = async () => {
        try {
          const status = await getBatchScrapeStatus();
          setBatchScrapeStatus(status);
          
          if (status.status === 'completed' || status.status === 'idle') {
            setIsScraping(false);
            // Refresh data after scrape completes
            loadData();
            return;
          }
          
          // Schedule next poll with slight backoff after 10 polls
          pollCount++;
          const nextDelay = pollCount > 10 ? 8000 : 5000;
          interval = setTimeout(poll, nextDelay);
        } catch (err) {
          console.error('Failed to get batch scrape status:', err);
          // Retry after longer delay on error
          interval = setTimeout(poll, 10000);
        }
      };
      
      // Start polling
      interval = setTimeout(poll, 2000); // Initial quick poll
    }
    
    return () => {
      if (interval) clearTimeout(interval);
    };
  }, [isScraping]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load each data source independently to prevent one failure from blocking others
      const results = await Promise.allSettled([
        getAirbticsCityStatuses(),
        getDatabaseStatus(),
        getListingsLifecycleStats(),
        getBatchScrapeStatus()
      ]);
      
      // Extract results, using defaults for failed calls
      const [citiesResult, dbResult, listingsResult, scrapeResult] = results;
      
      if (citiesResult.status === 'fulfilled') {
        setCityStatuses(citiesResult.value);
      } else {
        console.warn('Failed to load city statuses:', citiesResult.reason);
        setCityStatuses([]);
      }
      
      if (dbResult.status === 'fulfilled') {
        setDbStatus(dbResult.value);
      } else {
        console.warn('Failed to load database status:', dbResult.reason);
      }
      
      if (listingsResult.status === 'fulfilled') {
        setListingsStats(listingsResult.value);
      } else {
        console.warn('Failed to load listings stats:', listingsResult.reason);
        // Set empty stats instead of showing error
        setListingsStats({
          total_listings: 0,
          active_listings: 0,
          rented_listings: 0,
          expired_listings: 0,
          listings_by_source: {},
          oldest_listing_date: null,
          newest_listing_date: null,
          retention_days: 45
        });
      }
      
      if (scrapeResult.status === 'fulfilled') {
        setBatchScrapeStatus(scrapeResult.value);
        // Check if scrape is already running
        if (scrapeResult.value.status === 'running' || scrapeResult.value.status === 'starting') {
          setIsScraping(true);
        }
      } else {
        console.warn('Failed to load scrape status:', scrapeResult.reason);
      }
      
      // Only show error if critical data (city statuses) failed
      if (citiesResult.status === 'rejected' && dbResult.status === 'rejected') {
        setError('Failed to load data status');
      }
    } catch (err) {
      setError('Failed to load data status');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScrapeAllCities = async () => {
    try {
      setIsScraping(true);
      const response = await startBatchScrapeAllCities(3, 8);
      
      if (response.status === 'already_running') {
        // Already running, just poll for updates
        return;
      }
      
      if (response.status === 'no_cities') {
        setError(response.message);
        setIsScraping(false);
        return;
      }
      
      // Started successfully, polling will track progress
    } catch (err) {
      console.error('Failed to start batch scrape:', err);
      setError('Failed to start batch scrape');
      setIsScraping(false);
    }
  };

  const marketsWithData = cityStatuses.filter(c => c.has_airbtics_data).length;
  const totalMarkets = cityStatuses.length;
  const marketsNeedingData = cityStatuses.filter(c => !c.has_airbtics_data);
  const totalEntries = cityStatuses.reduce((sum, c) => sum + c.entries_count, 0);
  
  // Determine status color
  const getStatusColor = () => {
    if (totalMarkets === 0) return 'bg-gray-100 border-gray-300';
    if (marketsWithData === 0) return 'bg-red-50 border-red-300';
    if (marketsWithData < totalMarkets) return 'bg-yellow-50 border-yellow-300';
    return 'bg-green-50 border-green-300';
  };

  const getStatusIcon = () => {
    if (totalMarkets === 0) return <Database className="w-5 h-5 text-gray-500" />;
    if (marketsWithData === 0) return <AlertCircle className="w-5 h-5 text-red-500" />;
    if (marketsWithData < totalMarkets) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  };

  const getStatusText = () => {
    if (totalMarkets === 0) return 'No Markets Configured';
    if (marketsWithData === 0) return 'No Revenue Data Available';
    if (marketsWithData < totalMarkets) return `${marketsWithData}/${totalMarkets} Markets Ready`;
    return `All ${totalMarkets} Markets Ready`;
  };

  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="text-gray-500">Loading data status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <span className="text-red-700">{error}</span>
          <button 
            onClick={loadData}
            className="ml-auto text-red-600 hover:text-red-800 flex items-center gap-1"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${getStatusColor()} border rounded-lg mb-4 transition-all duration-200`}>
      {/* Main Status Bar */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <span className="font-semibold text-gray-900">{getStatusText()}</span>
              {totalEntries > 0 && (
                <span className="text-gray-500 ml-2 text-sm">
                  ({totalEntries} revenue entries)
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {dbStatus && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                dbStatus.database_type === 'PostgreSQL' 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {dbStatus.database_type}
              </span>
            )}
            
            {/* Fetch Long-Term Rental Listings Button */}
            {marketsWithData > 0 && (
              <button
                onClick={handleScrapeAllCities}
                disabled={isScraping}
                className={`px-3 py-1 text-white text-sm rounded transition-colors flex items-center gap-1 ${
                  isScraping 
                    ? 'bg-orange-500 cursor-not-allowed' 
                    : 'bg-green-600 hover:bg-green-700'
                }`}
                title="Fetch long-term rental listings (houses/condos for rent) from Realtor.com for all markets with revenue data"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {batchScrapeStatus?.current_city 
                      ? `Fetching ${batchScrapeStatus.completed_cities}/${batchScrapeStatus.total_cities}...`
                      : 'Starting...'}
                  </>
                ) : (
                  <>
                    <Home className="w-3 h-3" />
                    Fetch LTR Listings
                  </>
                )}
              </button>
            )}
            
            {marketsNeedingData.length > 0 && onSyncClick && (
              <button
                onClick={onSyncClick}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Sync Missing
              </button>
            )}
            
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-white/50 rounded transition-colors"
              title={expanded ? "Hide details" : "Show details"}
            >
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white/50">
          {cityStatuses.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No markets configured. Add cities below to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Markets with Data */}
              {marketsWithData > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    Markets with Revenue Data ({marketsWithData})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {cityStatuses
                      .filter(c => c.has_airbtics_data)
                      .map(city => (
                        <span 
                          key={city.city_id}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded"
                        >
                          <MapPin className="w-3 h-3" />
                          {city.city}, {city.state}
                          <span className="text-green-600">({city.entries_count})</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Markets without Data */}
              {marketsNeedingData.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-red-700 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    Markets Missing Data ({marketsNeedingData.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {marketsNeedingData.map(city => (
                      <span 
                        key={city.city_id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-xs rounded"
                      >
                        <MapPin className="w-3 h-3" />
                        {city.city}, {city.state}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch Scrape Status */}
              {batchScrapeStatus && (batchScrapeStatus.status === 'running' || batchScrapeStatus.status === 'completed') && (
                <div className="pt-3 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-orange-700 mb-2 flex items-center gap-1">
                    {batchScrapeStatus.status === 'running' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    )}
                    Batch Scrape: {batchScrapeStatus.message}
                  </h4>
                  {batchScrapeStatus.status === 'running' && batchScrapeStatus.current_city && (
                    <div className="text-sm text-gray-600 mb-2">
                      Currently scraping: <strong>{batchScrapeStatus.current_city}</strong>
                    </div>
                  )}
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-600">
                      Completed: <strong>{batchScrapeStatus.completed_cities}</strong>
                    </span>
                    <span className="text-red-600">
                      Failed: <strong>{batchScrapeStatus.failed_cities}</strong>
                    </span>
                    <span className="text-gray-600">
                      Total: <strong>{batchScrapeStatus.total_cities}</strong>
                    </span>
                  </div>
                  {batchScrapeStatus.results.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      <div className="flex flex-wrap gap-1">
                        {batchScrapeStatus.results.slice(-10).map((r, i) => (
                          <span 
                            key={i}
                            className={`text-xs px-2 py-0.5 rounded ${
                              r.status === 'completed' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-red-100 text-red-700'
                            }`}
                            title={r.message}
                          >
                            {r.city}, {r.state}: {r.listings_found || 0}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Listings Status Section */}
              {listingsStats && (
                <div className="pt-3 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                    <Home className="w-4 h-4" />
                    Rental Listings ({listingsStats.retention_days}-Day Retention)
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-green-50 rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-green-700">{listingsStats.active_listings}</div>
                      <div className="text-xs text-green-600">Active Listings</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-orange-700">{listingsStats.rented_listings}</div>
                      <div className="text-xs text-orange-600">Marked Rented</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-gray-700">{listingsStats.listings_by_source?.zillow || 0}</div>
                      <div className="text-xs text-gray-600">Zillow Only</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-blue-700">{listingsStats.listings_by_source?.realtor || 0}</div>
                      <div className="text-xs text-blue-600">Realtor Only</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-emerald-700">{listingsStats.listings_by_source?.both || 0}</div>
                      <div className="text-xs text-emerald-600">Both APIs</div>
                    </div>
                  </div>
                  {listingsStats.oldest_listing_date && (
                    <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Data range: {new Date(listingsStats.oldest_listing_date).toLocaleDateString()} - {listingsStats.newest_listing_date ? new Date(listingsStats.newest_listing_date).toLocaleDateString() : 'now'}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Stats */}
              <div className="flex items-center gap-4 pt-2 border-t border-gray-200 text-sm text-gray-600">
                <span>Total Entries: <strong>{totalEntries}</strong></span>
                <span>Coverage: <strong>{totalMarkets > 0 ? Math.round((marketsWithData / totalMarkets) * 100) : 0}%</strong></span>
                {dbStatus && (
                  <span>Database: <strong>{dbStatus.database_type}</strong></span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
