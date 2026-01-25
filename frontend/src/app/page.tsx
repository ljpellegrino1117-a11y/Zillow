'use client';

import { useState, useRef } from 'react';
import { Home, ChevronDown, ChevronUp, Settings, RefreshCw } from 'lucide-react';
import CityManager from '@/components/CityManager';
import AirDNAInput from '@/components/AirDNAInput';
import DashboardSummary from '@/components/DashboardSummary';
import OpportunityFinder from '@/components/OpportunityFinder';
import DataStatusBar from '@/components/DataStatusBar';
import MarketsOverview from '@/components/MarketsOverview';
import { useData } from '@/context/DataContext';

export default function Dashboard() {
  const [showDataManagement, setShowDataManagement] = useState(false);
  const { refreshAll, isLoading } = useData();
  const dataManagementRef = useRef<HTMLDivElement>(null);

  const handleDataChange = () => {
    refreshAll();
  };

  const handleSyncClick = () => {
    setShowDataManagement(true);
    setTimeout(() => {
      dataManagementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Compact Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-1.5 rounded-lg">
                <Home className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Zillow Arbitrage</h1>
              </div>
            </div>
            <button
              onClick={() => refreshAll()}
              disabled={isLoading}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Refresh all data"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        
        {/* Data Status - Compact */}
        <DataStatusBar onSyncClick={handleSyncClick} />

        {/* Opportunity Finder - Main Feature */}
        <div className="mb-4">
          <OpportunityFinder />
        </div>

        {/* Data Management - Collapsible */}
        <div ref={dataManagementRef}>
          <button
            onClick={() => setShowDataManagement(!showDataManagement)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-500" />
              <span className="font-medium text-gray-700">Data Management</span>
              <span className="text-sm text-gray-400">(Markets & Revenue Data)</span>
            </div>
            {showDataManagement ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          
          {showDataManagement && (
            <div className="mt-4 space-y-4">
              <DashboardSummary refreshTrigger={0} />
              <MarketsOverview refreshTrigger={0} onDataChange={handleDataChange} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CityManager onCityChange={handleDataChange} />
                <AirDNAInput onDataSaved={handleDataChange} refreshTrigger={0} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="mt-auto py-3 text-center text-xs text-gray-400">
        Rental Arbitrage Finder
      </footer>
    </div>
  );
}
