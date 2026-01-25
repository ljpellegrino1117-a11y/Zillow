'use client';

import { useState, useEffect } from 'react';
import { Server, Database, CheckCircle, AlertCircle, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { getCities, getAirbticsCityStatuses, getDatabaseStatus, AirbticsCityStatus, DatabaseStatus } from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

export default function DashboardSummary({ refreshTrigger }: Props) {
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [cityStatuses, setCityStatuses] = useState<AirbticsCityStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [airbticsCities, databaseStatus] = await Promise.all([
          getAirbticsCityStatuses(),
          getDatabaseStatus()
        ]);

        setDbStatus(databaseStatus);
        setCityStatuses(airbticsCities);
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-4 border border-gray-200 mb-4">
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  const marketsWithData = cityStatuses.filter(c => c.entries_count > 0).length;
  const totalEntries = cityStatuses.reduce((sum, c) => sum + c.entries_count, 0);
  const marketsNeedingRefresh = cityStatuses.filter(c => c.needs_refresh && c.entries_count > 0).length;
  const marketsWithoutData = cityStatuses.filter(c => c.entries_count === 0).length;
  const totalMarkets = cityStatuses.length;

  // Calculate data freshness
  const freshMarkets = cityStatuses.filter(c => !c.needs_refresh && c.entries_count > 0).length;
  const freshnessPercent = marketsWithData > 0 ? Math.round((freshMarkets / marketsWithData) * 100) : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4">
      {/* Compact Status Row */}
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Database Status */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Server className={`h-4 w-4 ${dbStatus?.is_production ? 'text-green-600' : 'text-yellow-600'}`} />
              <span className="text-sm font-medium text-gray-700">
                {dbStatus?.database_type || 'Database'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                dbStatus?.is_production 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {dbStatus?.is_production ? 'Production' : 'Development'}
              </span>
            </div>
            
            <div className="h-4 w-px bg-gray-300" />
            
            {/* Airbtics Data Summary */}
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-gray-700">
                <strong>{totalEntries}</strong> revenue entries across <strong>{marketsWithData}</strong> markets
              </span>
            </div>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-4">
            {/* Freshness */}
            <div className="flex items-center gap-1.5 text-sm">
              {freshnessPercent === 100 ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Clock className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-gray-600">
                {freshnessPercent}% fresh
              </span>
            </div>
            
            {/* Warnings */}
            {marketsWithoutData > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                {marketsWithoutData} missing data
              </div>
            )}
            
            {marketsNeedingRefresh > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-yellow-600">
                <RefreshCw className="h-4 w-4" />
                {marketsNeedingRefresh} stale
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Info Bar */}
      {totalMarkets > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
          <span>
            Data coverage: {totalMarkets > 0 ? Math.round((marketsWithData / totalMarkets) * 100) : 0}% of configured markets
          </span>
          {dbStatus?.is_production && (
            <span className="text-green-600">
              Data is persisted in PostgreSQL
            </span>
          )}
        </div>
      )}
    </div>
  );
}
