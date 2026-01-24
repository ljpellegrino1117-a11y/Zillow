'use client';

import { useState, useEffect } from 'react';
import { MapPin, DollarSign, Home, TrendingUp, Database, RefreshCw, Loader2 } from 'lucide-react';
import { getCities, getAirbticsCityStatuses, City, AirbticsCityStatus } from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

interface SummaryStats {
  totalCities: number;
  citiesWithData: number;
  totalAirDNAEntries: number;
  totalListings: number;
  avgRevenueByBedroom: Record<number, number>;
  topMarkets: { city: string; state: string; avgRevenue: number }[];
}

export default function DashboardSummary({ refreshTrigger }: Props) {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [cities, airbticsCities] = await Promise.all([
          getCities(),
          getAirbticsCityStatuses()
        ]);

        const citiesWithData = airbticsCities.filter(c => c.entries_count > 0);
        const totalEntries = airbticsCities.reduce((sum, c) => sum + c.entries_count, 0);

        // Calculate top markets by data availability
        const topMarkets = citiesWithData
          .sort((a, b) => b.entries_count - a.entries_count)
          .slice(0, 5)
          .map(c => ({
            city: c.city,
            state: c.state,
            avgRevenue: 0 // Would need another API call to get actual revenue
          }));

        setStats({
          totalCities: cities.length,
          citiesWithData: citiesWithData.length,
          totalAirDNAEntries: totalEntries,
          totalListings: 0, // Would need listings count endpoint
          avgRevenueByBedroom: {},
          topMarkets
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
        <button
          onClick={() => setCollapsed(true)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Hide
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <div className="text-xs text-gray-500">AirDNA entries</div>
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
          <div className="text-lg font-bold text-green-600">Ready</div>
          <div className="text-xs text-gray-500">Airbtics synced</div>
        </div>
      </div>

      {/* Top Markets */}
      {stats.topMarkets.length > 0 && (
        <div className="mt-4 pt-4 border-t border-primary-100">
          <div className="text-sm font-medium text-gray-700 mb-2">Top Markets (by data)</div>
          <div className="flex flex-wrap gap-2">
            {stats.topMarkets.map((market, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-white text-gray-700 text-xs px-3 py-1.5 rounded-full border border-gray-200"
              >
                <span className="font-medium">{market.city}</span>
                <span className="text-gray-400">{market.state}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
