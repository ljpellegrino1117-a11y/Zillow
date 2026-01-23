'use client';

import { useState, useEffect } from 'react';
import { Building2, ExternalLink, Loader2, Filter } from 'lucide-react';
import { getListings, getCities, getAmenityCounts, ZillowListing, City, AmenityFilters, AmenityCounts } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import AmenityFilter from './AmenityFilter';

interface Props {
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];

export default function ListingsTable({ refreshTrigger }: Props) {
  const [listings, setListings] = useState<ZillowListing[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedBedrooms, setSelectedBedrooms] = useState<number | undefined>(undefined);
  const [amenityFilters, setAmenityFilters] = useState<AmenityFilters>({});
  const [amenityCounts, setAmenityCounts] = useState<AmenityCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await getCities();
        setCities(data);
      } catch (error) {
        console.error('Failed to fetch cities:', error);
      }
    };
    fetchCities();
  }, [refreshTrigger]);

  useEffect(() => {
    const fetchListings = async () => {
      setLoading(true);
      try {
        const data = await getListings(
          selectedCity || undefined,
          selectedState || undefined,
          selectedBedrooms,
          undefined,
          undefined,
          undefined,
          undefined,
          amenityFilters,
          100
        );
        setListings(data);
      } catch (error) {
        console.error('Failed to fetch listings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchListings();
  }, [selectedCity, selectedState, selectedBedrooms, amenityFilters, refreshTrigger]);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const counts = await getAmenityCounts(
          selectedCity || undefined,
          selectedState || undefined,
          selectedBedrooms
        );
        setAmenityCounts(counts);
      } catch (error) {
        console.error('Failed to fetch amenity counts:', error);
      }
    };
    fetchCounts();
  }, [selectedCity, selectedState, selectedBedrooms, refreshTrigger]);

  const handleCitySelect = (value: string) => {
    if (!value) {
      setSelectedCity('');
      setSelectedState('');
    } else {
      const [city, state] = value.split('|');
      setSelectedCity(city);
      setSelectedState(state);
    }
  };

  const getAmenityBadges = (listing: ZillowListing) => {
    const badges = [];
    if (listing.has_pool) badges.push({ label: 'Pool', icon: '🏊' });
    if (listing.has_waterview) badges.push({ label: 'Water View', icon: '🌊' });
    if (listing.has_waterfront) badges.push({ label: 'Waterfront', icon: '🏖️' });
    if (listing.has_unfinished_basement) badges.push({ label: 'Unfin. Basement', icon: '🏚️' });
    if (listing.has_finished_basement) badges.push({ label: 'Fin. Basement', icon: '🏠' });
    if (listing.has_garage) badges.push({ label: 'Garage', icon: '🚗' });
    if (listing.has_yard) badges.push({ label: 'Yard', icon: '🌳' });
    return badges;
  };

  const getExtraRoomBadges = (listing: ZillowListing) => {
    const badges = [];
    if (listing.has_office) badges.push({ label: 'Office', icon: '💼' });
    if (listing.has_den) badges.push({ label: 'Den', icon: '📚' });
    if (listing.has_bonus_room) badges.push({ label: 'Bonus', icon: '➕' });
    if (listing.has_loft) badges.push({ label: 'Loft', icon: '🏠' });
    if (listing.has_flex_space) badges.push({ label: 'Flex', icon: '🔄' });
    if (listing.has_sunroom) badges.push({ label: 'Sunroom', icon: '☀️' });
    if (listing.has_media_room) badges.push({ label: 'Media', icon: '🎬' });
    if (listing.has_game_room) badges.push({ label: 'Game', icon: '🎮' });
    if (listing.has_studio) badges.push({ label: 'Studio', icon: '🎨' });
    if (listing.has_attic) badges.push({ label: 'Attic', icon: '🏚️' });
    if (listing.has_mother_in_law) badges.push({ label: 'In-Law', icon: '🏘️' });
    return badges;
  };

  const activeFilterCount = Object.values(amenityFilters).filter(Boolean).length;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary-600" />
        Zillow Listings
      </h2>

      {/* Filters */}
      <div className="space-y-4 mb-4">
        <div className="flex flex-wrap gap-4">
          <div className="w-48">
            <label className="input-label">City</label>
            <select
              value={selectedCity && selectedState ? `${selectedCity}|${selectedState}` : ''}
              onChange={(e) => handleCitySelect(e.target.value)}
              className="input"
            >
              <option value="">All cities</option>
              {cities.map(c => (
                <option key={c.id} value={`${c.city}|${c.state}`}>
                  {c.city}, {c.state}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="input-label">Bedrooms</label>
            <select
              value={selectedBedrooms ?? ''}
              onChange={(e) => setSelectedBedrooms(e.target.value ? parseInt(e.target.value) : undefined)}
              className="input"
            >
              <option value="">All</option>
              {BEDROOM_OPTIONS.map(br => (
                <option key={br} value={br}>{br} BR</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn ${showFilters || activeFilterCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Filter className="h-4 w-4" />
              Amenities
              {activeFilterCount > 0 && (
                <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded text-xs">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Amenity Filters */}
        {showFilters && (
          <AmenityFilter
            filters={amenityFilters}
            onChange={setAmenityFilters}
            counts={amenityCounts || undefined}
          />
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No listings found.</p>
          <p className="text-sm mt-1">Scrape a city to see listings here.</p>
        </div>
      ) : (
        <>
          <div className="table-container max-h-[500px] overflow-y-auto">
            <table>
              <thead className="sticky top-0">
                <tr>
                  <th>Address</th>
                  <th>BR</th>
                  <th>Potential BR</th>
                  <th>BA</th>
                  <th>Price</th>
                  <th>Extra Rooms</th>
                  <th>Amenities</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      <div className="max-w-xs truncate font-medium" title={listing.address}>
                        {listing.address}
                      </div>
                      {listing.city && (
                        <div className="text-xs text-gray-500">
                          {listing.city}, {listing.state} {listing.zip_code}
                        </div>
                      )}
                    </td>
                    <td className="font-medium">{listing.bedrooms}</td>
                    <td>
                      {listing.potential_bedrooms && listing.potential_bedrooms > listing.bedrooms ? (
                        <span className="font-semibold text-blue-600" title={`+${listing.extra_rooms_count} extra rooms`}>
                          {listing.potential_bedrooms}
                          <span className="text-xs text-blue-400 ml-1">+{listing.extra_rooms_count}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">{listing.bedrooms}</span>
                      )}
                    </td>
                    <td>{listing.bathrooms || '—'}</td>
                    <td className="font-semibold text-green-600">{formatCurrency(listing.price)}/mo</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {getExtraRoomBadges(listing).slice(0, 3).map((badge, i) => (
                          <span key={i} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded" title={badge.label}>
                            {badge.icon}
                          </span>
                        ))}
                        {getExtraRoomBadges(listing).length > 3 && (
                          <span className="text-xs text-blue-400">
                            +{getExtraRoomBadges(listing).length - 3}
                          </span>
                        )}
                        {getExtraRoomBadges(listing).length === 0 && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {getAmenityBadges(listing).slice(0, 3).map((badge, i) => (
                          <span key={i} className="text-xs bg-gray-100 px-1.5 py-0.5 rounded" title={badge.label}>
                            {badge.icon}
                          </span>
                        ))}
                        {getAmenityBadges(listing).length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{getAmenityBadges(listing).length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {listing.url && (
                        <a
                          href={listing.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-700"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Showing {listings.length} listing{listings.length !== 1 ? 's' : ''}
            {amenityCounts && ` of ${amenityCounts.total} total`}
          </div>
        </>
      )}
    </div>
  );
}
