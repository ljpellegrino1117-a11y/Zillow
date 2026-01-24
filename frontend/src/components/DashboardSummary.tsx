'use client';

import { useState, useEffect } from 'react';
import { MapPin, DollarSign, TrendingUp, Database, RefreshCw, Loader2, CheckCircle, AlertCircle, Server, Clock, AlertOctagon } from 'lucide-react';
import { getCities, getAirbticsCityStatuses, getDatabaseStatus, City, AirbticsCityStatus, DatabaseStatus } from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

interface SummaryStats {
  totalCities: number;
  citiesWithData: number;
  totalAirDNAEntries: number;
  totalListings: number;
  avgRevenueByBedroom: Record<number, number>;
  topMarkets: { city: string; state: string; entries: number }[];
  citiesNeedingRefresh: string[];
  citiesWithoutData: string[];
  dataQualityScore: number;  // 0-100
}

export default function DashboardSummary({ refreshTrigger }: Props) {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [cities, airbticsCities, databaseStatus] = await Promise.all([
          getCities(),
          getAirbticsCityStatuses(),
          getDatabaseStatus()
        ]);

        setDbStatus(databaseStatus);

        const citiesWithData = airbticsCities.filter(c => c.entries_count > 0);
        const totalEntries = airbticsCities.reduce((sum, c) => sum + c.entries_count, 0);

        // Calculate top markets by data availability
        const topMarkets = citiesWithData
          .sort((a, b) => b.entries_count - a.entries_count)
          .slice(0, 5)
          .map(c => ({
            city: c.city,
            state: c.state,
            entries: c.entries_count
          }));

        // Find cities needing refresh (>6 months old or no data)
        const citiesNeedingRefresh = airbticsCities
          .filter(c => c.needs_refresh)
          .map(c => `${c.city}, ${c.state}`);
        
        // Find cities without any data
        const citiesWithoutData = airbticsCities
          .filter(c => c.entries_count === 0)
          .map(c => `${c.city}, ${c.state}`);
        
        // Calculate data quality score (0-100)
        let qualityScore = 0;
        if (cities.length > 0) {
          // Coverage: up to 40 points
          qualityScore += (citiesWithData.length / cities.length) * 40;
          
          // Data freshness: up to 30 points (penalize for stale data)
          const freshCities = airbticsCities.filter(c => !c.needs_refresh && c.entries_count > 0).length;
          qualityScore += cities.length > 0 ? (freshCities / cities.length) * 30 : 0;
          
          // Data depth: up to 30 points (average entries per city)
          const avgEntriesPerCity = citiesWithData.length > 0 
            ? totalEntries / citiesWithData.length 
            : 0;
          // 5+ entries per city = full points
          qualityScore += Math.min(avgEntriesPerCity / 5, 1) * 30;
        }

        setStats({
          totalCities: cities.length,
          citiesWithData: citiesWithData.length,
          totalAirDNAEntries: totalEntries,
          totalListings: databaseStatus?.tables?.listings || 0,
          avgRevenueByBedroom: {},
          topMarkets,
          citiesNeedingRefresh,
          citiesWithoutData,
          dataQualityScore: Math.round(qualityScore)
        });
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [refreshTrigger]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <TrendingUp className="h-4 w-4" />
        Show Dashboard Summary
      </button>
    );
  }

  if (loading) {
    return (
      <div className="mb-6 bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-6 border border-primary-100">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="mb-6 bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-6 border border-primary-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary-600" />
          Dashboard Overview
        </h2>
        <div className="flex items-center gap-4">
          {/* Database Status Badge */}
          {dbStatus && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              dbStatus.is_production 
                ? 'bg-green-100 text-green-700 border border-green-200' 
                : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
            }`}>
              <Server className="h-4 w-4" />
              <span>{dbStatus.database_type}</span>
              {dbStatus.is_production ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
            </div>
          )}
          <button
            onClick={() => setCollapsed(true)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Hide
          </button>
        </div>
      </div>

      {/* Database Connection Info */}
      {dbStatus && (
        <div className={`mb-4 p-3 rounded-lg border ${
          dbStatus.is_production 
            ? 'bg-green-50 border-green-200' 
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {dbStatus.is_production ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              )}
              <div>
                <span className={`font-medium ${dbStatus.is_production ? 'text-green-800' : 'text-yellow-800'}`}>
                  {dbStatus.is_production ? 'Production Database Connected' : 'Local Development Database'}
                </span>
                <span className="text-sm ml-2 text-gray-500">
                  ({dbStatus.database_host})
                </span>
              </div>
            </div>
            <div className="text-sm">
              {dbStatus.is_production ? (
                <span className="text-green-700">Data is persisted and protected</span>
              ) : (
                <span className="text-yellow-700">Data will be lost on deployment</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Database Type Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-2 rounded-lg ${dbStatus?.is_production ? 'bg-green-100' : 'bg-yellow-100'}`}>
              <Server className={`h-4 w-4 ${dbStatus?.is_production ? 'text-green-600' : 'text-yellow-600'}`} />
            </div>
            <span className="text-sm text-gray-600">Database</span>
          </div>
          <div className={`text-lg font-bold ${dbStatus?.is_production ? 'text-green-600' : 'text-yellow-600'}`}>
            {dbStatus?.database_type || 'Unknown'}
          </div>
          <div className="text-xs text-gray-500">
            {dbStatus?.is_production ? 'Production' : 'Development'}
          </div>
        </div>

        {/* Cities Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-blue-100 p-2 rounded-lg">
              <MapPin className="h-4 w-4 text-blue-600" />
            </div>
            <span className="text-sm text-gray-600">Markets</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalCities}</div>
          <div className="text-xs text-gray-500">{stats.citiesWithData} with data</div>
        </div>

        {/* AirDNA Entries Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-green-100 p-2 rounded-lg">
              <DollarSign className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-sm text-gray-600">Revenue Data</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalAirDNAEntries}</div>
          <div className="text-xs text-gray-500">Airbtics entries</div>
        </div>

        {/* Data Coverage Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-purple-100 p-2 rounded-lg">
              <Database className="h-4 w-4 text-purple-600" />
            </div>
            <span className="text-sm text-gray-600">Coverage</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {stats.totalCities > 0 ? Math.round((stats.citiesWithData / stats.totalCities) * 100) : 0}%
          </div>
          <div className="text-xs text-gray-500">markets covered</div>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-orange-100 p-2 rounded-lg">
              <RefreshCw className="h-4 w-4 text-orange-600" />
            </div>
            <span className="text-sm text-gray-600">Status</span>
          </div>
          <div className={`text-lg font-bold ${stats.totalAirDNAEntries > 0 ? 'text-green-600' : 'text-yellow-600'}`}>
            {stats.totalAirDNAEntries > 0 ? 'Ready' : 'Needs Sync'}
          </div>
          <div className="text-xs text-gray-500">
            {stats.totalAirDNAEntries > 0 ? 'Airbtics synced' : 'Run sync'}
          </div>
        </div>
      </div>

      {/* Data Quality Indicators */}
      <div className="mt-4 pt-4 border-t border-primary-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Data Quality Score */}
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Data Quality Score</span>
              <span className={`text-lg font-bold ${
                stats.dataQualityScore >= 80 ? 'text-green-600' :
                stats.dataQualityScore >= 60 ? 'text-blue-600' :
                stats.dataQualityScore >= 40 ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {stats.dataQualityScore}/100
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all ${
                  stats.dataQualityScore >= 80 ? 'bg-green-500' :
                  stats.dataQualityScore >= 60 ? 'bg-blue-500' :
                  stats.dataQualityScore >= 40 ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: `${stats.dataQualityScore}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Based on coverage, freshness, and data depth
            </div>
          </div>
          
          {/* Warnings */}
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
              <AlertOctagon className="h-4 w-4 text-orange-500" />
              Data Warnings
            </div>
            {stats.citiesWithoutData.length === 0 && stats.citiesNeedingRefresh.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle className="h-4 w-4" />
                All data is current
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                {stats.citiesWithoutData.length > 0 && (
                  <div className="flex items-start gap-2 text-red-600">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      {stats.citiesWithoutData.length} market{stats.citiesWithoutData.length > 1 ? 's' : ''} without data: {stats.citiesWithoutData.slice(0, 3).join(', ')}{stats.citiesWithoutData.length > 3 ? '...' : ''}
                    </span>
                  </div>
                )}
                {stats.citiesNeedingRefresh.length > 0 && stats.citiesNeedingRefresh.length !== stats.citiesWithoutData.length && (
                  <div className="flex items-start gap-2 text-yellow-600">
                    <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      {stats.citiesNeedingRefresh.length} market{stats.citiesNeedingRefresh.length > 1 ? 's' : ''} need refresh
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Markets */}
      {stats.topMarkets.length > 0 && (
        <div className="mt-4 pt-4 border-t border-primary-100">
          <div className="text-sm font-medium text-gray-700 mb-2">Top Markets (by data points)</div>
          <div className="flex flex-wrap gap-2">
            {stats.topMarkets.map((market, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-white text-gray-700 text-xs px-3 py-1.5 rounded-full border border-gray-200"
              >
                <span className="font-medium">{market.city}</span>
                <span className="text-gray-400">{market.state}</span>
                <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs ml-1">
                  {market.entries}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
