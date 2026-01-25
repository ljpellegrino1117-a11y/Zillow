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
  MapPin
} from 'lucide-react';
import { 
  getAirbticsCityStatuses, 
  getDatabaseStatus,
  AirbticsCityStatus,
  DatabaseStatus
} from '@/lib/api';

interface DataStatusBarProps {
  onSyncClick?: () => void;
  refreshTrigger?: number;
}

export default function DataStatusBar({ onSyncClick, refreshTrigger }: DataStatusBarProps) {
  const [cityStatuses, setCityStatuses] = useState<AirbticsCityStatus[]>([]);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [cities, db] = await Promise.all([
        getAirbticsCityStatuses(),
        getDatabaseStatus()
      ]);
      setCityStatuses(cities);
      setDbStatus(db);
    } catch (err) {
      setError('Failed to load data status');
      console.error(err);
    } finally {
      setLoading(false);
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
