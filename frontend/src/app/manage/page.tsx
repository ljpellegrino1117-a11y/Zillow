'use client';

import { useState } from 'react';
import { ArrowLeft, Database, MapPin, DollarSign, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import CityManager from '@/components/CityManager';
import AirDNAInput from '@/components/AirDNAInput';
import MarketsOverview from '@/components/MarketsOverview';
import DashboardSummary from '@/components/DashboardSummary';
import { useData } from '@/context/DataContext';
import { getCities, deleteCity } from '@/lib/api';

export default function ManagePage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [clearing, setClearing] = useState(false);
  const { refreshAll } = useData();

  const handleDataChange = () => {
    setRefreshTrigger(prev => prev + 1);
    refreshAll();
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL data? This will delete all cities, listings, and revenue data.')) {
      return;
    }
    
    setClearing(true);
    try {
      const cities = await getCities();
      for (const city of cities) {
        await deleteCity(city.city, city.state, city.zip_code || undefined);
      }
      handleDataChange();
    } catch (error) {
      console.error('Failed to clear all data:', error);
      alert('Failed to clear all data');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <Link 
                href="/"
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm font-medium">Back to Search</span>
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {clearing ? 'Clearing...' : 'Clear All'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Data Management</h1>
          <p className="text-gray-500 mt-1">Configure markets, revenue data, and listings</p>
        </div>

        {/* System Status */}
        <div className="mb-8">
          <DashboardSummary refreshTrigger={refreshTrigger} />
        </div>

        {/* Markets Overview */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-gray-500" />
            Markets Overview
          </h2>
          <MarketsOverview refreshTrigger={refreshTrigger} onDataChange={handleDataChange} />
        </div>

        {/* Add Data Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Add City */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-gray-500" />
              Add Market
            </h2>
            <CityManager onCityChange={handleDataChange} />
          </div>

          {/* Add Revenue Data */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-gray-500" />
              Add Revenue Data
            </h2>
            <AirDNAInput onDataSaved={handleDataChange} refreshTrigger={refreshTrigger} />
          </div>
        </div>
      </main>
    </div>
  );
}
