'use client';

import { useState } from 'react';

// All amenity and extra room options
const EXTRA_ROOM_OPTIONS = [
  { key: 'has_office', label: 'Office', icon: '💼' },
  { key: 'has_den', label: 'Den/Study', icon: '📚' },
  { key: 'has_bonus_room', label: 'Bonus Room', icon: '➕' },
  { key: 'has_loft', label: 'Loft', icon: '🏠' },
  { key: 'has_flex_space', label: 'Flex Space', icon: '🔄' },
  { key: 'has_sunroom', label: 'Sunroom', icon: '☀️' },
  { key: 'has_media_room', label: 'Media Room', icon: '🎬' },
  { key: 'has_game_room', label: 'Game Room', icon: '🎮' },
  { key: 'has_studio', label: 'Studio/Hobby', icon: '🎨' },
  { key: 'has_attic', label: 'Finished Attic', icon: '🏚️' },
  { key: 'has_mother_in_law', label: 'In-Law Suite', icon: '🏘️' },
] as const;

const AMENITY_OPTIONS = [
  { key: 'has_pool', label: 'Pool', icon: '🏊' },
  { key: 'has_waterfront', label: 'Waterfront/View', icon: '🌊' },
  { key: 'has_unfinished_basement', label: 'Unfinished Basement', icon: '🏚️' },
  { key: 'has_finished_basement', label: 'Finished Basement', icon: '🏠' },
  { key: 'has_basement', label: 'Any Basement', icon: '⬇️' },
  { key: 'has_garage', label: 'Garage', icon: '🚗' },
  { key: 'has_parking', label: 'Parking', icon: '🅿️' },
  { key: 'has_laundry', label: 'Laundry', icon: '🧺' },
  { key: 'has_ac', label: 'A/C', icon: '❄️' },
  { key: 'has_fireplace', label: 'Fireplace', icon: '🔥' },
  { key: 'has_yard', label: 'Yard', icon: '🌳' },
  { key: 'has_patio', label: 'Patio/Deck', icon: '🪑' },
  { key: 'has_balcony', label: 'Balcony', icon: '🏢' },
  { key: 'has_gym', label: 'Gym', icon: '💪' },
  { key: 'has_pet_friendly', label: 'Pet Friendly', icon: '🐕' },
] as const;

export interface RequiredOptionalFilters {
  required: Record<string, boolean>;
  optional: Record<string, boolean>;
}

interface Props {
  filters: RequiredOptionalFilters;
  onChange: (filters: RequiredOptionalFilters) => void;
  counts?: Record<string, number>;
}

type FilterType = 'required' | 'optional';

export default function AmenityFilter({ filters, onChange, counts }: Props) {
  const [activeTab, setActiveTab] = useState<FilterType>('required');

  const handleToggle = (key: string, type: FilterType) => {
    const newFilters = { ...filters };
    const targetSet = { ...newFilters[type] };
    
    if (targetSet[key]) {
      delete targetSet[key];
    } else {
      targetSet[key] = true;
      // Remove from the other set if present
      const otherType = type === 'required' ? 'optional' : 'required';
      const otherSet = { ...newFilters[otherType] };
      delete otherSet[key];
      newFilters[otherType] = otherSet;
    }
    
    newFilters[type] = targetSet;
    onChange(newFilters);
  };

  const clearAll = () => {
    onChange({ required: {}, optional: {} });
  };

  const requiredCount = Object.keys(filters.required || {}).length;
  const optionalCount = Object.keys(filters.optional || {}).length;
  const totalCount = requiredCount + optionalCount;

  const getButtonState = (key: string): { type: FilterType | null; isActive: boolean } => {
    if (filters.required?.[key]) return { type: 'required', isActive: true };
    if (filters.optional?.[key]) return { type: 'optional', isActive: true };
    return { type: null, isActive: false };
  };

  const renderAmenityButton = (
    option: { key: string; label: string; icon: string },
    category: 'extra_room' | 'amenity'
  ) => {
    const { type, isActive } = getButtonState(option.key);
    const count = counts?.[option.key];
    
    // Determine button style based on state
    let buttonClass = 'bg-white border-gray-200 text-gray-700 hover:border-gray-300';
    if (isActive) {
      if (type === 'required') {
        buttonClass = 'bg-red-100 border-red-300 text-red-800';
      } else if (type === 'optional') {
        buttonClass = 'bg-yellow-100 border-yellow-300 text-yellow-800';
      }
    }

    return (
      <button
        key={option.key}
        onClick={() => handleToggle(option.key, activeTab)}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
          transition-colors border ${buttonClass}
        `}
        title={isActive ? `${type === 'required' ? 'Required' : 'Optional'} - Click to change` : `Click to add as ${activeTab}`}
      >
        <span>{option.icon}</span>
        <span>{option.label}</span>
        {isActive && (
          <span className={`text-xs px-1 rounded ${type === 'required' ? 'bg-red-200' : 'bg-yellow-200'}`}>
            {type === 'required' ? 'REQ' : 'OPT'}
          </span>
        )}
        {count !== undefined && !isActive && (
          <span className="text-xs text-gray-400">({count})</span>
        )}
      </button>
    );
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Amenity Filters
          {totalCount > 0 && (
            <span className="ml-2 text-xs font-normal">
              <span className="text-red-600">({requiredCount} required)</span>
              {optionalCount > 0 && <span className="text-yellow-600 ml-1">({optionalCount} optional)</span>}
            </span>
          )}
        </h3>
        {totalCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Tab selector for Required vs Optional */}
      <div className="flex gap-2 p-1 bg-gray-200 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('required')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'required'
              ? 'bg-red-500 text-white shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Required
          {requiredCount > 0 && (
            <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-xs">{requiredCount}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('optional')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'optional'
              ? 'bg-yellow-500 text-white shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Optional
          {optionalCount > 0 && (
            <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-xs">{optionalCount}</span>
          )}
        </button>
      </div>

      {/* Description */}
      <div className={`text-xs p-2 rounded ${activeTab === 'required' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
        {activeTab === 'required' ? (
          <>
            <strong>Required amenities:</strong> Listings MUST have ALL of these to be shown.
          </>
        ) : (
          <>
            <strong>Optional amenities:</strong> Listings with these will be sorted to the TOP, but won't be excluded.
          </>
        )}
      </div>

      {/* Extra Rooms (Potential Bedrooms) */}
      <div>
        <p className="text-xs font-medium text-blue-700 mb-2">Extra Rooms (Potential Bedrooms)</p>
        <div className="flex flex-wrap gap-2">
          {EXTRA_ROOM_OPTIONS.map(option => renderAmenityButton(option, 'extra_room'))}
        </div>
      </div>

      {/* Amenities */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Amenities</p>
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map(option => renderAmenityButton(option, 'amenity'))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-200"></span> Required
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-yellow-200"></span> Optional (sorted to top)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-gray-200"></span> Not filtered
        </span>
      </div>
    </div>
  );
}
