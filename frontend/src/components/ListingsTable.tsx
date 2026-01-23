'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Building2, ExternalLink, Loader2, Filter, Download } from 'lucide-react';
import { getListings, getCities, getAmenityCounts, ZillowListing, City, AmenityFilters, AmenityCounts } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import AmenityFilter, { RequiredOptionalFilters } from './AmenityFilter';

interface Props {
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];
const LISTING_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'rental', label: 'Rentals Only' },
  { value: 'for_sale', label: 'For Sale Only' },
];

export default function ListingsTable({ refreshTrigger }: Props) {
  const [listings, setListings] = useState<ZillowListing[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedBedrooms, setSelectedBedrooms] = useState<number | undefined>(undefined);
  const [selectedListingType, setSelectedListingType] = useState<string>('');
  const [showCreativeOnly, setShowCreativeOnly] = useState(false);
  const [amenityFilters, setAmenityFilters] = useState<RequiredOptionalFilters>({ required: {}, optional: {} });
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
        // Convert required filters to API format
        const apiFilters: AmenityFilters = {};
        Object.keys(amenityFilters.required || {}).forEach(key => {
          (apiFilters as Record<string, boolean>)[key] = true;
        });

        const data = await getListings(
          selectedCity || undefined,
          selectedState || undefined,
          selectedBedrooms,
          undefined,
          undefined,
          undefined,
          undefined,
          apiFilters,
          500, // Get more listings for sorting
          0,
          selectedListingType || undefined,
          showCreativeOnly || undefined
        );
        setListings(data);
      } catch (error) {
        console.error('Failed to fetch listings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchListings();
  }, [selectedCity, selectedState, selectedBedrooms, amenityFilters.required, selectedListingType, showCreativeOnly, refreshTrigger]);

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

  // Calculate optional amenity score for sorting
  const calculateOptionalScore = useCallback((listing: ZillowListing): number => {
    const optionalKeys = Object.keys(amenityFilters.optional || {});
    if (optionalKeys.length === 0) return 0;
    
    let score = 0;
    optionalKeys.forEach(key => {
      if ((listing as any)[key]) {
        score += 1;
      }
    });
    return score;
  }, [amenityFilters.optional]);

  // Sort listings - optional amenities at top, then by price
  const sortedListings = useMemo(() => {
    const optionalKeys = Object.keys(amenityFilters.optional || {});
    if (optionalKeys.length === 0) return listings;
    
    return [...listings].sort((a, b) => {
      const scoreA = calculateOptionalScore(a);
      const scoreB = calculateOptionalScore(b);
      
      // First sort by optional amenity score (descending)
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      // Then by price (ascending)
      return (a.price || 0) - (b.price || 0);
    });
  }, [listings, amenityFilters.optional, calculateOptionalScore]);

  const getAmenityBadges = (listing: ZillowListing) => {
    const badges = [];
    if (listing.has_pool) badges.push({ label: 'Pool', icon: '🏊' });
    if (listing.has_waterfront) badges.push({ label: 'Waterfront/View', icon: '🌊' });
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

  // Export functions
  const exportToCSV = useCallback(() => {
    const headers = [
      'Type', 'Address', 'City', 'State', 'Zip', 'Bedrooms', 'Potential BR', 
      'Bathrooms', 'Price/Mo', 'Sale Price', 'SqFt', 'Extra Rooms', 
      'Pool', 'Waterfront', 'Basement', 'Garage', 'Creative Financing', 'URL'
    ];
    
    const rows = sortedListings.map(l => [
      l.listing_type,
      l.address,
      l.city,
      l.state,
      l.zip_code || '',
      l.bedrooms,
      l.potential_bedrooms || l.bedrooms,
      l.bathrooms || '',
      l.price || '',
      l.sale_price || '',
      l.sqft || '',
      l.extra_rooms_count || 0,
      l.has_pool ? 'Yes' : 'No',
      l.has_waterfront ? 'Yes' : 'No',
      l.has_basement ? 'Yes' : 'No',
      l.has_garage ? 'Yes' : 'No',
      l.has_creative_financing ? 'Yes' : 'No',
      l.url || ''
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zillow-listings-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [sortedListings]);

  const exportToPDF = useCallback(() => {
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Zillow Listings Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; font-size: 11px; }
          h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
          th { background-color: #3b82f6; color: white; font-size: 10px; }
          tr:nth-child(even) { background-color: #f9fafb; }
          .rental { color: #16a34a; font-weight: bold; }
          .for_sale { color: #9333ea; font-weight: bold; }
          .creative { background-color: #fef3c7; }
          .footer { margin-top: 20px; font-size: 10px; color: #666; }
        </style>
      </head>
      <body>
        <h1>Zillow Listings</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>Total listings: ${sortedListings.length}</p>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Address</th>
              <th>BR</th>
              <th>+Rooms</th>
              <th>BA</th>
              <th>Price</th>
              <th>Amenities</th>
            </tr>
          </thead>
          <tbody>
            ${sortedListings.slice(0, 100).map(l => `
              <tr class="${l.has_creative_financing ? 'creative' : ''}">
                <td class="${l.listing_type}">${l.listing_type === 'for_sale' ? 'FOR SALE' : 'RENTAL'}</td>
                <td>${l.address}<br/><small>${l.city}, ${l.state} ${l.zip_code || ''}</small></td>
                <td>${l.bedrooms}</td>
                <td>${l.extra_rooms_count > 0 ? '+' + l.extra_rooms_count : '-'}</td>
                <td>${l.bathrooms || '-'}</td>
                <td>${l.listing_type === 'for_sale' ? '$' + (l.sale_price || 0).toLocaleString() : '$' + (l.price || 0).toLocaleString() + '/mo'}</td>
                <td>${[
                  l.has_pool ? '🏊' : '',
                  l.has_waterfront ? '🏖️' : '',
                  l.has_basement ? '⬇️' : '',
                  l.has_garage ? '🚗' : '',
                ].filter(Boolean).join(' ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${sortedListings.length > 100 ? '<p class="footer">Showing first 100 of ' + sortedListings.length + ' listings. Export to CSV for full list.</p>' : ''}
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  }, [sortedListings]);

  const requiredCount = Object.keys(amenityFilters.required || {}).length;
  const optionalCount = Object.keys(amenityFilters.optional || {}).length;
  const activeFilterCount = requiredCount + optionalCount;

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
          <div className="w-40">
            <label className="input-label">Type</label>
            <select
              value={selectedListingType}
              onChange={(e) => setSelectedListingType(e.target.value)}
              className="input"
            >
              {LISTING_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer bg-yellow-50 px-3 py-2 rounded-lg border border-yellow-200">
              <input
                type="checkbox"
                checked={showCreativeOnly}
                onChange={(e) => setShowCreativeOnly(e.target.checked)}
                className="rounded text-yellow-600 focus:ring-yellow-500"
              />
              <span className="text-sm font-medium text-yellow-800">Creative $ Only</span>
            </label>
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

      {/* Optional amenities notice */}
      {optionalCount > 0 && (
        <div className="mb-4 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          Listings with optional amenities are sorted to the top ({optionalCount} optional filter{optionalCount !== 1 ? 's' : ''} active)
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : sortedListings.length === 0 ? (
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
                  <th>Type</th>
                  <th>Address</th>
                  <th>Listed BR</th>
                  <th>Potential BR Range</th>
                  <th>BA</th>
                  <th>Price</th>
                  <th>Extra Rooms</th>
                  <th>Amenities</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedListings.map((listing) => {
                  const optionalScore = calculateOptionalScore(listing);
                  return (
                    <tr key={listing.id} className={optionalScore > 0 ? 'bg-yellow-50' : ''}>
                      <td>
                        <div className="flex flex-col gap-1">
                          {listing.listing_type === 'for_sale' ? (
                            <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded w-fit">
                              FOR SALE
                            </span>
                          ) : (
                            <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded w-fit">
                              RENTAL
                            </span>
                          )}
                          {listing.has_creative_financing && (
                            <span className="text-xs font-semibold bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded w-fit" title={listing.financing_keywords || 'Creative financing available'}>
                              CREATIVE $
                            </span>
                          )}
                          {optionalScore > 0 && (
                            <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded w-fit">
                              +{optionalScore} OPT
                            </span>
                          )}
                        </div>
                      </td>
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
                        {listing.extra_rooms_count && listing.extra_rooms_count > 0 ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-blue-600">
                              {Array.from(
                                { length: listing.extra_rooms_count + 1 }, 
                                (_, i) => listing.bedrooms + i
                              ).join(', ')}
                            </span>
                            <span className="text-xs text-gray-500">
                              +{listing.extra_rooms_count} convertible
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">{listing.bedrooms} only</span>
                        )}
                      </td>
                      <td>{listing.bathrooms || '—'}</td>
                      <td>
                        {listing.listing_type === 'for_sale' ? (
                          <div>
                            <div className="font-semibold text-purple-600">
                              {listing.sale_price ? formatCurrency(listing.sale_price) : '—'}
                            </div>
                            {listing.price && (
                              <div className="text-xs text-gray-500">
                                Est. rent: {formatCurrency(listing.price)}/mo
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="font-semibold text-green-600">{formatCurrency(listing.price)}/mo</span>
                        )}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Export buttons and summary */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {sortedListings.length} listing{sortedListings.length !== 1 ? 's' : ''}
              {amenityCounts && ` of ${amenityCounts.total} total`}
            </div>
            <div className="flex gap-2">
              <button onClick={exportToCSV} className="btn-secondary text-sm">
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button onClick={exportToPDF} className="btn-secondary text-sm">
                <Download className="h-4 w-4" />
                Export PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
