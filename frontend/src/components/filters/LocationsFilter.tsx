'use client';

import { useState, useEffect } from 'react';
import { MapPin, X, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { useData } from '@/context/DataContext';

export type SearchMode = 'all' | 'select' | 'radius';

export interface LocationFilters {
  mode: SearchMode;
  selectedCities: string[];
  radiusCity: string;
  radiusMiles: number;
  excludeTargetCity: boolean;
}

interface LocationsFilterProps {
  isOpen: boolean;
  onClose: () => void;
  filters: LocationFilters;
  onApply: (filters: LocationFilters) => void;
}

export default function LocationsFilter({ isOpen, onClose, filters, onApply }: LocationsFilterProps) {
  const { cityStatuses } = useData();
  const [localFilters, setLocalFilters] = useState<LocationFilters>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters, isOpen]);

  const citiesWithData = cityStatuses.filter(c => c.has_airbtics_data);
  const citiesWithoutData = cityStatuses.filter(c => !c.has_airbtics_data);

  const handleCityToggle = (cityStr: string) => {
    setLocalFilters(prev => ({
      ...prev,
      selectedCities: prev.selectedCities.includes(cityStr)
        ? prev.selectedCities.filter(c => c !== cityStr)
        : [...prev.selectedCities, cityStr]
    }));
  };

  const handleSelectAll = () => {
    const allCities = citiesWithData.map(c => `${c.city}, ${c.state}`);
    setLocalFilters(prev => ({
      ...prev,
      selectedCities: allCities
    }));
  };

  const handleSelectNone = () => {
    setLocalFilters(prev => ({
      ...prev,
      selectedCities: []
    }));
  };

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-gray-900">Locations</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Search Mode */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Search Mode</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={localFilters.mode === 'all'}
                onChange={() => setLocalFilters(prev => ({ ...prev, mode: 'all' }))}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">
                All Markets ({citiesWithData.length} with data)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={localFilters.mode === 'select'}
                onChange={() => setLocalFilters(prev => ({ ...prev, mode: 'select' }))}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">Select Cities</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={localFilters.mode === 'radius'}
                onChange={() => setLocalFilters(prev => ({ ...prev, mode: 'radius' }))}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">City + Radius</span>
            </label>
          </div>
        </div>

        {/* City Selection (for 'select' mode) */}
        {localFilters.mode === 'select' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Select Cities</label>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={handleSelectNone}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  None
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
              {citiesWithData.map(city => {
                const cityStr = `${city.city}, ${city.state}`;
                const isSelected = localFilters.selectedCities.includes(cityStr);
                return (
                  <label
                    key={city.city_id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleCityToggle(cityStr)}
                        className="rounded text-blue-600"
                      />
                      <span className="text-sm text-gray-700">{cityStr}</span>
                    </div>
                    <span className="text-xs text-green-600">{city.entries_count}</span>
                  </label>
                );
              })}
              {citiesWithoutData.map(city => {
                const cityStr = `${city.city}, ${city.state}`;
                return (
                  <div
                    key={city.city_id}
                    className="flex items-center justify-between p-2 rounded bg-gray-50 opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      <input type="checkbox" disabled className="rounded" />
                      <span className="text-sm text-gray-500">{cityStr}</span>
                    </div>
                    <span className="text-xs text-red-500">No data</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">
              {localFilters.selectedCities.length} of {citiesWithData.length} selected
            </p>
          </div>
        )}

        {/* Radius Settings (for 'radius' mode) */}
        {localFilters.mode === 'radius' && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Target City</label>
              <input
                type="text"
                value={localFilters.radiusCity}
                onChange={(e) => setLocalFilters(prev => ({ ...prev, radiusCity: e.target.value }))}
                placeholder="e.g., Austin, TX"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Radius</label>
              <select
                value={localFilters.radiusMiles}
                onChange={(e) => setLocalFilters(prev => ({ ...prev, radiusMiles: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={0}>Target city only</option>
                <option value={10}>10 miles</option>
                <option value={25}>25 miles</option>
                <option value={50}>50 miles</option>
                <option value={75}>75 miles</option>
                <option value={100}>100 miles</option>
              </select>
            </div>
            {localFilters.radiusMiles > 0 && (
              <label className="flex items-start gap-2 cursor-pointer p-2 bg-amber-50 rounded-lg border border-amber-200">
                <input
                  type="checkbox"
                  checked={localFilters.excludeTargetCity}
                  onChange={(e) => setLocalFilters(prev => ({ ...prev, excludeTargetCity: e.target.checked }))}
                  className="mt-0.5 rounded text-amber-600"
                />
                <div>
                  <span className="text-sm font-medium text-amber-800">Surrounding cities only</span>
                  <p className="text-xs text-amber-600">
                    Exclude target city (useful if it has STR restrictions)
                  </p>
                </div>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
        <button
          onClick={handleApply}
          className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
