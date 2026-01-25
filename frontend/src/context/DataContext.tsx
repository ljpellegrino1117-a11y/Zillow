'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  getCities,
  getAirbticsCityStatuses,
  getListingsLifecycleStats,
  getDatabaseStatus,
  City,
  AirbticsCityStatus,
  ListingsLifecycleStats,
  DatabaseStatus,
  invalidateCache
} from '@/lib/api';

interface DataState {
  cities: City[];
  cityStatuses: AirbticsCityStatus[];
  listingsStats: ListingsLifecycleStats | null;
  databaseStatus: DatabaseStatus | null;
  isLoading: boolean;
  lastRefresh: number;
  error: string | null;
}

interface DataContextType extends DataState {
  refreshAll: () => Promise<void>;
  refreshCities: () => Promise<void>;
  refreshListings: () => Promise<void>;
  invalidateAndRefresh: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

// Minimum time between full refreshes (30 seconds)
const MIN_REFRESH_INTERVAL = 30000;

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DataState>({
    cities: [],
    cityStatuses: [],
    listingsStats: null,
    databaseStatus: null,
    isLoading: true,
    lastRefresh: 0,
    error: null
  });
  
  const refreshInProgress = useRef(false);
  const initialLoadDone = useRef(false);

  // Fetch all data in parallel
  const fetchAllData = useCallback(async (force = false) => {
    // Prevent concurrent refreshes
    if (refreshInProgress.current) return;
    
    // Rate limit refreshes unless forced
    const now = Date.now();
    if (!force && now - state.lastRefresh < MIN_REFRESH_INTERVAL) {
      return;
    }
    
    refreshInProgress.current = true;
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const [cities, cityStatuses, listingsStats, databaseStatus] = await Promise.all([
        getCities(),
        getAirbticsCityStatuses(),
        getListingsLifecycleStats(),
        getDatabaseStatus()
      ]);
      
      setState({
        cities,
        cityStatuses,
        listingsStats,
        databaseStatus,
        isLoading: false,
        lastRefresh: Date.now(),
        error: null
      });
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to load data'
      }));
    } finally {
      refreshInProgress.current = false;
    }
  }, [state.lastRefresh]);

  // Refresh just cities
  const refreshCities = useCallback(async () => {
    try {
      const [cities, cityStatuses] = await Promise.all([
        getCities(),
        getAirbticsCityStatuses()
      ]);
      setState(prev => ({
        ...prev,
        cities,
        cityStatuses,
        lastRefresh: Date.now()
      }));
    } catch (err) {
      console.error('Failed to refresh cities:', err);
    }
  }, []);

  // Refresh just listings
  const refreshListings = useCallback(async () => {
    try {
      const listingsStats = await getListingsLifecycleStats();
      setState(prev => ({
        ...prev,
        listingsStats,
        lastRefresh: Date.now()
      }));
    } catch (err) {
      console.error('Failed to refresh listings:', err);
    }
  }, []);

  // Force full refresh (invalidate cache first)
  const invalidateAndRefresh = useCallback(async () => {
    invalidateCache();
    await fetchAllData(true);
  }, [fetchAllData]);

  // Initial load
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      fetchAllData(true);
    }
  }, [fetchAllData]);

  return (
    <DataContext.Provider
      value={{
        ...state,
        refreshAll: () => fetchAllData(true),
        refreshCities,
        refreshListings,
        invalidateAndRefresh
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}

// Hook for derived data
export function useCitiesWithData() {
  const { cityStatuses } = useData();
  return cityStatuses.filter(c => c.has_airbtics_data);
}

export function useCitiesNeedingData() {
  const { cityStatuses } = useData();
  return cityStatuses.filter(c => !c.has_airbtics_data);
}

export function useDataSummary() {
  const { cityStatuses, listingsStats, databaseStatus } = useData();
  
  const citiesWithData = cityStatuses.filter(c => c.has_airbtics_data).length;
  const totalCities = cityStatuses.length;
  const totalListings = listingsStats?.active_listings || 0;
  const dbType = databaseStatus?.database_type || 'Unknown';
  
  return {
    citiesWithData,
    totalCities,
    totalListings,
    dbType,
    isReady: totalCities > 0 && citiesWithData > 0 && totalListings > 0
  };
}
