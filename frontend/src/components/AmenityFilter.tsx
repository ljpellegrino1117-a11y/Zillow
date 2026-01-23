'use client';

import { AmenityFilters } from '@/lib/api';

interface Props {
  filters: AmenityFilters;
  onChange: (filters: AmenityFilters) => void;
  counts?: Record<string, number>;
}

const AMENITY_OPTIONS = [
  { key: 'has_pool', label: 'Pool', icon: '🏊', category: 'amenity' },
  { key: 'has_waterview', label: 'Water View', icon: '🌊', category: 'amenity' },
  { key: 'has_waterfront', label: 'Waterfront', icon: '🏖️', category: 'amenity' },
  { key: 'has_unfinished_basement', label: 'Unfinished Basement', icon: '🏚️', category: 'amenity' },
  { key: 'has_finished_basement', label: 'Finished Basement', icon: '🏠', category: 'amenity' },
  { key: 'has_basement', label: 'Any Basement', icon: '⬇️', category: 'amenity' },
  { key: 'has_garage', label: 'Garage', icon: '🚗', category: 'amenity' },
  { key: 'has_parking', label: 'Parking', icon: '🅿️', category: 'amenity' },
  { key: 'has_laundry', label: 'Laundry', icon: '🧺', category: 'amenity' },
  { key: 'has_ac', label: 'A/C', icon: '❄️', category: 'amenity' },
  { key: 'has_fireplace', label: 'Fireplace', icon: '🔥', category: 'amenity' },
  { key: 'has_yard', label: 'Yard', icon: '🌳', category: 'amenity' },
  { key: 'has_patio', label: 'Patio/Deck', icon: '🪑', category: 'amenity' },
  { key: 'has_balcony', label: 'Balcony', icon: '🏢', category: 'amenity' },
  { key: 'has_gym', label: 'Gym', icon: '💪', category: 'amenity' },
  { key: 'has_pet_friendly', label: 'Pet Friendly', icon: '🐕', category: 'amenity' },
] as const;

const EXTRA_ROOM_OPTIONS = [
  { key: 'has_office', label: 'Office', icon: '💼', category: 'extra_room' },
  { key: 'has_den', label: 'Den/Study', icon: '📚', category: 'extra_room' },
  { key: 'has_bonus_room', label: 'Bonus Room', icon: '➕', category: 'extra_room' },
  { key: 'has_loft', label: 'Loft', icon: '🏠', category: 'extra_room' },
  { key: 'has_flex_space', label: 'Flex Space', icon: '🔄', category: 'extra_room' },
  { key: 'has_sunroom', label: 'Sunroom', icon: '☀️', category: 'extra_room' },
  { key: 'has_media_room', label: 'Media Room', icon: '🎬', category: 'extra_room' },
  { key: 'has_game_room', label: 'Game Room', icon: '🎮', category: 'extra_room' },
  { key: 'has_studio', label: 'Studio/Hobby', icon: '🎨', category: 'extra_room' },
  { key: 'has_attic', label: 'Finished Attic', icon: '🏚️', category: 'extra_room' },
  { key: 'has_mother_in_law', label: 'In-Law Suite', icon: '🏘️', category: 'extra_room' },
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
    <div className="p-4 bg-gray-50 rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Filters
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

      {/* Extra Rooms (Potential Bedrooms) */}
      <div>
        <p className="text-xs font-medium text-blue-700 mb-2">Extra Rooms (Potential Bedrooms)</p>
        <div className="flex flex-wrap gap-2">
          {EXTRA_ROOM_OPTIONS.map(({ key, label, icon }) => {
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
                    ? 'bg-blue-100 border-blue-300 text-blue-800' 
                    : 'bg-white border-gray-200 text-gray-700 hover:border-blue-200'
                  }
                `}
              >
                <span>{icon}</span>
                <span>{label}</span>
                {count !== undefined && (
                  <span className={`text-xs ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Amenities */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Amenities</p>
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
      </div>
      
      <p className="text-xs text-gray-500">
        Filter listings by extra rooms (potential bedrooms) and amenities. Only listings with ALL selected items will be shown.
      </p>
    </div>
  );
}
