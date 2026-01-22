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
  ColumnFiltersState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, RefreshCw, Loader2 } from 'lucide-react';
import { getDiscrepancyAnalysis, DiscrepancyResult } from '@/lib/api';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';

interface Props {
  refreshTrigger?: number;
}

const columnHelper = createColumnHelper<DiscrepancyResult>();

export default function DiscrepancyTable({ refreshTrigger }: Props) {
  const [data, setData] = useState<DiscrepancyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'annual_profit_vs_bottom', desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const results = await getDiscrepancyAnalysis();
      setData(results);
    } catch (error) {
      console.error('Failed to fetch discrepancy data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [refreshTrigger]);

  const columns = useMemo(() => [
    columnHelper.accessor('zip_code', {
      header: 'Zip Code',
      cell: info => (
        <div>
          <span className="font-medium">{info.getValue()}</span>
          {(info.row.original.city || info.row.original.state) && (
            <div className="text-xs text-gray-500">
              {[info.row.original.city, info.row.original.state].filter(Boolean).join(', ')}
            </div>
          )}
        </div>
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
    columnHelper.accessor('listing_count', {
      header: 'Listings',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('annual_profit_vs_avg', {
      header: 'Profit vs Avg',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn(
            'font-medium',
            value > 0 ? 'text-green-600' : 'text-red-600'
          )}>
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
          <span className={cn(
            'font-semibold',
            value > 0 ? 'text-green-600' : 'text-red-600'
          )}>
            {value > 0 ? '+' : ''}{formatCurrency(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor('roi_vs_avg', {
      header: 'ROI vs Avg',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn(
            value > 0 ? 'text-green-600' : 'text-red-600'
          )}>
            {formatPercent(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor('roi_vs_bottom', {
      header: 'ROI vs Bottom',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn(
            'font-semibold',
            value > 0 ? 'text-green-600' : 'text-red-600'
          )}>
            {formatPercent(value)}
          </span>
        );
      },
    }),
  ], []);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (loading) {
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
        <button onClick={fetchData} className="btn-secondary text-sm">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-2">No data available for analysis.</p>
          <p className="text-sm">Add zip codes, scrape Zillow listings, and enter AirDNA data to see opportunities.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-4">
            Sorted by annual profit potential. Click column headers to sort. 
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
