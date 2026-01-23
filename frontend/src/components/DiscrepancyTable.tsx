'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, RefreshCw, Loader2, Filter, Download } from 'lucide-react';
import { getDiscrepancyAnalysis, getCities, DiscrepancyResult, City, AmenityFilters } from '@/lib/api';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import AmenityFilter, { RequiredOptionalFilters } from './AmenityFilter';

interface Props {
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];
const columnHelper = createColumnHelper<DiscrepancyResult>();

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function DiscrepancyTable({ refreshTrigger }: Props) {
  const [data, setData] = useState<DiscrepancyResult[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedBedrooms, setSelectedBedrooms] = useState<number | undefined>(undefined);
  const [amenityFilters, setAmenityFilters] = useState<RequiredOptionalFilters>({ required: {}, optional: {} });
  const [showFilters, setShowFilters] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'airdna_to_rent_ratio', desc: true },
  ]);
  
  // Debounce filter changes
  const debouncedFilters = useDebounce(amenityFilters.required, 300);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Convert required filters to API format
      const apiFilters: AmenityFilters = {};
      Object.keys(debouncedFilters || {}).forEach(key => {
        (apiFilters as Record<string, boolean>)[key] = true;
      });

      const results = await getDiscrepancyAnalysis(
        selectedCity || undefined,
        selectedState || undefined,
        selectedBedrooms,
        3,
        8,
        apiFilters
      );
      
      // Add calculated ratio field
      const enrichedResults = results.map(r => ({
        ...r,
        airdna_to_rent_ratio: r.bottom_10_avg_rental_price > 0 
          ? r.airdna_monthly_revenue / r.bottom_10_avg_rental_price 
          : 0,
      }));
      
      setData(enrichedResults);
    } catch (error) {
      console.error('Failed to fetch discrepancy data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCity, selectedState, selectedBedrooms, debouncedFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

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

  // Export functions
  const exportToCSV = useCallback(() => {
    const headers = [
      'City', 'State', 'Bedrooms', 'AirDNA Annual', 'AirDNA Monthly', 
      'Avg Rent/Mo', 'Bottom 10% Rent/Mo', 'Listings', 
      'Annual Profit vs Avg', 'Annual Profit vs Bottom', 'ROI %', 'AirDNA/Rent Ratio'
    ];
    
    const rows = data.map(r => [
      r.city,
      r.state,
      r.bedrooms,
      r.airdna_annual_revenue,
      r.airdna_monthly_revenue,
      r.avg_rental_price,
      r.bottom_10_avg_rental_price,
      r.listing_count,
      r.annual_profit_vs_avg,
      r.annual_profit_vs_bottom,
      (r.roi_vs_bottom * 100).toFixed(1),
      ((r as any).airdna_to_rent_ratio || 0).toFixed(2)
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arbitrage-opportunities-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const exportToPDF = useCallback(() => {
    // Create a printable HTML document
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Arbitrage Opportunities Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #3b82f6; color: white; }
          tr:nth-child(even) { background-color: #f9fafb; }
          .positive { color: #16a34a; font-weight: bold; }
          .negative { color: #dc2626; }
          .highlight { background-color: #dcfce7 !important; }
          .footer { margin-top: 20px; font-size: 10px; color: #666; }
        </style>
      </head>
      <body>
        <h1>Rental Arbitrage Opportunities</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>Sorted by: AirDNA to Rent Ratio (Highest First)</p>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>BR</th>
              <th>AirDNA Annual</th>
              <th>AirDNA/Mo</th>
              <th>Avg Rent</th>
              <th>Bottom 10%</th>
              <th>Profit vs Bottom</th>
              <th>ROI</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr class="${r.annual_profit_vs_bottom > 20000 ? 'highlight' : ''}">
                <td>${r.city}, ${r.state}</td>
                <td>${r.bedrooms}</td>
                <td>$${r.airdna_annual_revenue.toLocaleString()}</td>
                <td>$${r.airdna_monthly_revenue.toLocaleString()}</td>
                <td>$${r.avg_rental_price.toLocaleString()}</td>
                <td>$${r.bottom_10_avg_rental_price.toLocaleString()}</td>
                <td class="${r.annual_profit_vs_bottom > 0 ? 'positive' : 'negative'}">
                  ${r.annual_profit_vs_bottom > 0 ? '+' : ''}$${r.annual_profit_vs_bottom.toLocaleString()}
                </td>
                <td class="${r.roi_vs_bottom > 0 ? 'positive' : 'negative'}">
                  ${(r.roi_vs_bottom * 100).toFixed(1)}%
                </td>
                <td>${((r as any).airdna_to_rent_ratio || 0).toFixed(2)}x</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="footer">
          <p>Total opportunities: ${data.length}</p>
          <p>Green highlighted rows have profit > $20,000/year</p>
        </div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  }, [data]);

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
    columnHelper.accessor('bottom_10_avg_rental_price', {
      header: 'Bottom 10% Rent',
      cell: info => (
        <div>
          <span className="text-blue-600">{formatCurrency(info.getValue())}/mo</span>
          <div className="text-xs text-gray-500">
            {formatCurrency(info.getValue() * 12)}/yr
          </div>
        </div>
      ),
    }),
    columnHelper.accessor((row: any) => row.airdna_to_rent_ratio || 0, {
      id: 'airdna_to_rent_ratio',
      header: 'AirDNA/Rent Ratio',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn(
            'font-bold text-lg',
            value >= 2 ? 'text-green-600' : value >= 1.5 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {value.toFixed(2)}x
          </span>
        );
      },
    }),
    columnHelper.accessor('listing_count', {
      header: 'Listings',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('annual_profit_vs_bottom', {
      header: 'Annual Profit',
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

  const requiredCount = Object.keys(amenityFilters.required || {}).length;
  const optionalCount = Object.keys(amenityFilters.optional || {}).length;
  const activeFilterCount = requiredCount + optionalCount;

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
        <div className="flex gap-2">
          <button onClick={fetchData} className="btn-secondary text-sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
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
            Auto-sorted by <span className="font-semibold">AirDNA to Rent Ratio</span> (highest first).
            Click column headers to change sort. 
            <span className="font-medium text-green-600"> Green = profitable</span>.
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

          {/* Export buttons and summary */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {data.length} result{data.length !== 1 ? 's' : ''}
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
