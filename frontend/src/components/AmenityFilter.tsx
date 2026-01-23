'use client';

import { AmenityFilters } from '@/lib/api';

interface Props {
  filters: AmenityFilters;
  onChange: (filters: AmenityFilters) => void;
  counts?: Record<string, number>;
}

const AMENITY_OPTIONS = [
  { key: 'has_pool', label: 'Pool', icon: '🏊' },
  { key: 'has_waterview', label: 'Water View', icon: '🌊' },
  { key: 'has_waterfront', label: 'Waterfront', icon: '🏖️' },
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

export default function AmenityFilter({ filters, onChange, counts }: Props) {
  const handleToggle = (key: string) => {
    const newFilters = { ...filters };
    if (newFilters[key as keyof AmenityFilters]) {
      delete newFilters[key as keyof AmenityFilters];
    } else {
      newFilters[key as keyof AmenityFilters] = true;
    }
    onChange(newFilters);
  };

  const clearAll = () => {
    onChange({});
  };

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          Required Amenities
          {activeCount > 0 && (
            <span className="ml-2 text-xs font-normal text-primary-600">
              ({activeCount} selected)
            </span>
          )}
        </h3>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
        )}
      </div>
      
      <div className="flex flex-wrap gap-2">
        {AMENITY_OPTIONS.map(({ key, label, icon }) => {
          const isActive = filters[key as keyof AmenityFilters];
          const count = counts?.[key];
          
          return (
            <button
              key={key}
              onClick={() => handleToggle(key)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                transition-colors border
                ${isActive 
                  ? 'bg-primary-100 border-primary-300 text-primary-800' 
                  : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {count !== undefined && (
                <span className={`text-xs ${isActive ? 'text-primary-600' : 'text-gray-400'}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>
      
      <p className="mt-3 text-xs text-gray-500">
        Select amenities to filter listings. Only listings with ALL selected amenities will be shown.
      </p>
    </div>
  );
}
