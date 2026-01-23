'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, RefreshCw, Loader2, Filter } from 'lucide-react';
import { getDiscrepancyAnalysis, getCities, DiscrepancyResult, City, AmenityFilters } from '@/lib/api';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import AmenityFilter from './AmenityFilter';

interface Props {
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];
const columnHelper = createColumnHelper<DiscrepancyResult>();

export default function DiscrepancyTable({ refreshTrigger }: Props) {
  const [data, setData] = useState<DiscrepancyResult[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedBedrooms, setSelectedBedrooms] = useState<number | undefined>(undefined);
  const [amenityFilters, setAmenityFilters] = useState<AmenityFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'annual_profit_vs_bottom', desc: true },
  ]);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const results = await getDiscrepancyAnalysis(
        selectedCity || undefined,
        selectedState || undefined,
        selectedBedrooms,
        3,
        8,
        amenityFilters
      );
      setData(results);
    } catch (error) {
      console.error('Failed to fetch discrepancy data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, selectedCity, selectedState, selectedBedrooms, amenityFilters]);

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

  const columns = useMemo(() => [
    columnHelper.accessor(row => `${row.city}, ${row.state}`, {
      id: 'location',
      header: 'City',
      cell: info => (
        <span className="font-medium">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor('bedrooms', {
      header: 'BR',
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('airdna_annual_revenue', {
      header: 'AirDNA Annual',
      cell: info => (
        <div>
          <span className="text-green-600 font-medium">{formatCurrency(info.getValue())}</span>
          <div className="text-xs text-gray-500">
            {formatCurrency(info.row.original.airdna_monthly_revenue)}/mo
          </div>
        </div>
      ),
    }),
    columnHelper.accessor('avg_rental_price', {
      header: 'Avg Rent',
      cell: info => (
        <div>
          <span>{formatCurrency(info.getValue())}/mo</span>
          <div className="text-xs text-gray-500">
            {formatCurrency(info.getValue() * 12)}/yr
          </div>
        </div>
      ),
    }),
    columnHelper.accessor('bottom_10_avg_rental_price', {
      header: 'Bottom 10%',
      cell: info => (
        <div>
          <span className="text-blue-600">{formatCurrency(info.getValue())}/mo</span>
          <div className="text-xs text-gray-500">
            {formatCurrency(info.getValue() * 12)}/yr
          </div>
        </div>
      ),
    }),
    columnHelper.accessor('listing_count', {
      header: 'Listings',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('annual_profit_vs_avg', {
      header: 'Profit vs Avg',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn('font-medium', value > 0 ? 'text-green-600' : 'text-red-600')}>
            {value > 0 ? '+' : ''}{formatCurrency(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor('annual_profit_vs_bottom', {
      header: 'Profit vs Bottom',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn('font-semibold', value > 0 ? 'text-green-600' : 'text-red-600')}>
            {value > 0 ? '+' : ''}{formatCurrency(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor('roi_vs_bottom', {
      header: 'ROI',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn('font-semibold', value > 0 ? 'text-green-600' : 'text-red-600')}>
            {formatPercent(value)}
          </span>
        );
      },
    }),
  ], []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const activeFilterCount = Object.values(amenityFilters).filter(Boolean).length;

  if (loading && data.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary-600" />
          Arbitrage Opportunities
        </h2>
        <button onClick={fetchData} className="btn-secondary text-sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

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

        {showFilters && (
          <AmenityFilter
            filters={amenityFilters}
            onChange={setAmenityFilters}
          />
        )}
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-2">No data available for analysis.</p>
          <p className="text-sm">Add cities, scrape Zillow listings, and enter AirDNA data to see opportunities.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-4">
            Click column headers to sort. 
            <span className="font-medium text-green-600"> Green = profitable</span>, 
            <span className="font-medium text-red-600"> Red = not profitable</span>.
          </p>

          <div className="table-container">
            <table>
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th
                        key={header.id}
                        className={cn(
                          'cursor-pointer select-none hover:bg-gray-100',
                          header.column.getIsSorted() && 'bg-gray-100'
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr 
                    key={row.id}
                    className={cn(
                      row.original.annual_profit_vs_bottom > 20000 && 'bg-green-50/50'
                    )}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-sm text-gray-500">
            Showing {data.length} result{data.length !== 1 ? 's' : ''}
          </div>
        </>
      )}
    </div>
  );
}
