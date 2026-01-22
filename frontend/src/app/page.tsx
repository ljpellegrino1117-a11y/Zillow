'use client';

import { useState } from 'react';
import { BarChart3, Home } from 'lucide-react';
import ZipCodeManager from '@/components/ZipCodeManager';
import AirDNAInput from '@/components/AirDNAInput';
import DiscrepancyTable from '@/components/DiscrepancyTable';
import ListingsTable from '@/components/ListingsTable';

export default function Dashboard() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<'analysis' | 'listings'>('analysis');

  const handleDataChange = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-primary-600 p-2 rounded-lg">
                <Home className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Zillow Arbitrage</h1>
                <p className="text-xs text-gray-500">Find rental arbitrage opportunities</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
        {/* Top Section: Zip Codes & AirDNA Input */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <ZipCodeManager onZipCodeChange={handleDataChange} />
          <AirDNAInput onDataSaved={handleDataChange} />
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
            Zillow Arbitrage Tool • Compare Zillow rentals with AirDNA revenue data
          </p>
        </div>
      </footer>
    </div>
  );
}
