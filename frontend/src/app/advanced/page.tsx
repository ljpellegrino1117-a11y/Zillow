'use client';

import { useState, useRef } from 'react';
import { 
  Home, 
  RefreshCw, 
  Settings, 
  ChevronDown, 
  ChevronUp,
  Bug,
  ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import DataStatusBar from '@/components/DataStatusBar';
import OpportunityFinder from '@/components/OpportunityFinder';
import DashboardSummary from '@/components/DashboardSummary';
import MarketsOverview from '@/components/MarketsOverview';
import CityManager from '@/components/CityManager';
import AirDNAInput from '@/components/AirDNAInput';
import { useData } from '@/context/DataContext';

export default function AdvancedDashboard() {
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { refreshAll, isLoading } = useData();
  const dataManagementRef = useRef<HTMLDivElement>(null);

  const handleDataChange = () => {
    setRefreshTrigger(prev => prev + 1);
    refreshAll();
  };

  const handleSyncClick = () => {
    setShowDataManagement(true);
    setTimeout(() => {
      dataManagementRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <Link 
                href="/"
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm font-medium">Back to Search</span>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-amber-500" />
                <span className="text-sm font-medium text-gray-700">Advanced / Debug View</span>
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* Data Status - Compact */}
        <DataStatusBar onSyncClick={handleSyncClick} />

        {/* Opportunity Finder - Main Feature */}
        <div className="mb-4">
          <OpportunityFinder refreshTrigger={refreshTrigger} />
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
              <DashboardSummary refreshTrigger={refreshTrigger} />
              <MarketsOverview refreshTrigger={refreshTrigger} onDataChange={handleDataChange} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CityManager onCityChange={handleDataChange} />
                <AirDNAInput onDataSaved={handleDataChange} refreshTrigger={refreshTrigger} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-3 text-center text-xs text-gray-400">
        Advanced Dashboard - Debug & Testing View
      </footer>
    </div>
  );
}
