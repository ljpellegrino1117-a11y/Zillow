'use client';

import { useState, useEffect } from 'react';
import { BarChart3, X } from 'lucide-react';

export interface STRCompsFilters {
  minBedrooms: number;
  maxBedrooms: number;
  amenities: {
    pool: boolean;
    waterfront: boolean;
    garage: boolean;
    yard: boolean;
    petFriendly: boolean;
    hotTub: boolean;
  };
  basement: 'any' | 'include' | 'exclude';  // Unfinished basement filter
  confidence: 'any' | 'medium' | 'high';
}

interface STRCompsFilterProps {
  isOpen: boolean;
  onClose: () => void;
  filters: STRCompsFilters;
  onApply: (filters: STRCompsFilters) => void;
}

export default function STRCompsFilter({ isOpen, onClose, filters, onApply }: STRCompsFilterProps) {
  const [localFilters, setLocalFilters] = useState<STRCompsFilters>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters, isOpen]);

  const handleAmenityToggle = (amenity: keyof STRCompsFilters['amenities']) => {
    setLocalFilters(prev => ({
      ...prev,
      amenities: {
        ...prev.amenities,
        [amenity]: !prev.amenities[amenity]
      }
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
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-gray-900">STR Comps</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Bedrooms */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Bedrooms</label>
          <div className="flex items-center gap-2">
            <select
              value={localFilters.minBedrooms}
              onChange={(e) => setLocalFilters(prev => ({ ...prev, minBedrooms: Number(e.target.value) }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>{n} BR</option>
              ))}
            </select>
            <span className="text-gray-400">to</span>
            <select
              value={localFilters.maxBedrooms}
              onChange={(e) => setLocalFilters(prev => ({ ...prev, maxBedrooms: Number(e.target.value) }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>{n} BR</option>
              ))}
            </select>
          </div>
        </div>

        {/* Amenities */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Amenities (require)</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'pool', label: 'Pool' },
              { key: 'waterfront', label: 'Waterfront' },
              { key: 'garage', label: 'Garage' },
              { key: 'yard', label: 'Yard' },
              { key: 'petFriendly', label: 'Pet Friendly' },
              { key: 'hotTub', label: 'Hot Tub' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localFilters.amenities[key as keyof STRCompsFilters['amenities']]}
                  onChange={() => handleAmenityToggle(key as keyof STRCompsFilters['amenities'])}
                  className="rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Unfinished Basement Filter */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Unfinished Basement</label>
          <div className="flex gap-2">
            {[
              { value: 'any', label: 'Any', title: 'Show all properties' },
              { value: 'include', label: 'Include', title: 'Only show properties WITH unfinished basement' },
              { value: 'exclude', label: 'Exclude', title: 'Only show properties WITHOUT unfinished basement' },
            ].map(({ value, label, title }) => (
              <button
                key={value}
                onClick={() => setLocalFilters(prev => ({ ...prev, basement: value as STRCompsFilters['basement'] }))}
                title={title}
                className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
                  localFilters.basement === value
                    ? value === 'include' 
                      ? 'bg-green-600 text-white'
                      : value === 'exclude'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {localFilters.basement === 'include' && 'Showing only properties with unfinished basement'}
            {localFilters.basement === 'exclude' && 'Excluding properties with unfinished basement'}
            {localFilters.basement === 'any' && 'Showing all properties regardless of basement'}
          </p>
        </div>

        {/* Data Confidence */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Data Confidence</label>
          <div className="flex gap-2">
            {[
              { value: 'any', label: 'Any' },
              { value: 'medium', label: 'Medium+' },
              { value: 'high', label: 'High only' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLocalFilters(prev => ({ ...prev, confidence: value as STRCompsFilters['confidence'] }))}
                className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
                  localFilters.confidence === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
