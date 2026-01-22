'use client';

import { useState, useEffect } from 'react';
import { Building2, ExternalLink, Loader2 } from 'lucide-react';
import { getListings, getZipCodes, ZillowListing, ZipCode } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface Props {
  refreshTrigger?: number;
}

export default function ListingsTable({ refreshTrigger }: Props) {
  const [listings, setListings] = useState<ZillowListing[]>([]);
  const [zipCodes, setZipCodes] = useState<ZipCode[]>([]);
  const [selectedZipCode, setSelectedZipCode] = useState<string>('');
  const [selectedBedrooms, setSelectedBedrooms] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchZipCodes = async () => {
      try {
        const data = await getZipCodes();
        setZipCodes(data);
      } catch (error) {
        console.error('Failed to fetch zip codes:', error);
      }
    };
    fetchZipCodes();
  }, [refreshTrigger]);

  useEffect(() => {
    const fetchListings = async () => {
      setLoading(true);
      try {
        const data = await getListings(
          selectedZipCode || undefined,
          selectedBedrooms ? parseInt(selectedBedrooms) : undefined,
          undefined,
          undefined,
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
  }, [selectedZipCode, selectedBedrooms, refreshTrigger]);

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary-600" />
        Zillow Listings
      </h2>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <div className="w-48">
          <label className="input-label">Zip Code</label>
          <select
            value={selectedZipCode}
            onChange={(e) => setSelectedZipCode(e.target.value)}
            className="input"
          >
            <option value="">All zip codes</option>
            {zipCodes.map(zip => (
              <option key={zip.id} value={zip.zip_code}>
                {zip.zip_code}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="input-label">Bedrooms</label>
          <select
            value={selectedBedrooms}
            onChange={(e) => setSelectedBedrooms(e.target.value)}
            className="input"
          >
            <option value="">All</option>
            {[3, 4, 5, 6, 7, 8].map(br => (
              <option key={br} value={br}>{br} BR</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No listings found.</p>
          <p className="text-sm mt-1">Scrape a zip code to see listings here.</p>
        </div>
      ) : (
        <>
          <div className="table-container max-h-96 overflow-y-auto">
            <table>
              <thead className="sticky top-0">
                <tr>
                  <th>Address</th>
                  <th>BR</th>
                  <th>BA</th>
                  <th>Price</th>
                  <th>Type</th>
                  <th>SqFt</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      <div className="max-w-xs truncate" title={listing.address}>
                        {listing.address}
                      </div>
                      {listing.city && (
                        <div className="text-xs text-gray-500">
                          {listing.city}, {listing.state}
                        </div>
                      )}
                    </td>
                    <td>{listing.bedrooms}</td>
                    <td>{listing.bathrooms || '—'}</td>
                    <td className="font-medium">{formatCurrency(listing.price)}/mo</td>
                    <td className="text-gray-600">{listing.property_type || '—'}</td>
                    <td className="text-gray-600">
                      {listing.sqft ? listing.sqft.toLocaleString() : '—'}
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
          </div>
        </>
      )}
    </div>
  );
}
