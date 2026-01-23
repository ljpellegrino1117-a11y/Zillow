'use client';

import { useState } from 'react';
import { BarChart3, Home, Trash2 } from 'lucide-react';
import CityManager from '@/components/CityManager';
import AirDNAInput from '@/components/AirDNAInput';
import DiscrepancyTable from '@/components/DiscrepancyTable';
import ListingsTable from '@/components/ListingsTable';
import { getCities, deleteCity, getAirDNAData, deleteAirDNAData } from '@/lib/api';

export default function Dashboard() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<'analysis' | 'listings'>('analysis');
  const [clearing, setClearing] = useState(false);

  const handleDataChange = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL data? This will delete all cities, listings, and AirDNA data.')) {
      return;
    }
    
    setClearing(true);
    try {
      // Get all cities and delete them (this cascades to listings)
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-primary-600 p-2 rounded-lg flex-shrink-0">
                <Home className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 truncate">Zillow Arbitrage</h1>
                <p className="text-xs text-gray-500 truncate">Find rental arbitrage opportunities</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="btn text-xs py-1.5 px-3 text-red-600 hover:bg-red-50 border border-red-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearing ? 'Clearing...' : 'Clear All Data'}
              </button>
              <a
                href="http://localhost:8000/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                API Docs
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Section: Cities & AirDNA Input */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <CityManager onCityChange={handleDataChange} />
          <AirDNAInput onDataSaved={handleDataChange} refreshTrigger={refreshTrigger} />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('analysis')}
            className={`btn ${activeTab === 'analysis' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <BarChart3 className="h-4 w-4" />
            Arbitrage Analysis
          </button>
          <button
            onClick={() => setActiveTab('listings')}
            className={`btn ${activeTab === 'listings' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Home className="h-4 w-4" />
            Listings
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'analysis' ? (
          <DiscrepancyTable refreshTrigger={refreshTrigger} />
        ) : (
          <ListingsTable refreshTrigger={refreshTrigger} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            Zillow Arbitrage Tool - Compare rentals with AirDNA revenue data
          </p>
        </div>
      </footer>
    </div>
  );
}
