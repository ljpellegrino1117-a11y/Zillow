'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, RefreshCw, Loader2, Filter, Download, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Target, Brain, DollarSign, Percent } from 'lucide-react';
import { getDiscrepancyAnalysis, getCities, DiscrepancyResult, City, AmenityFilters } from '@/lib/api';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import AmenityFilter, { RequiredOptionalFilters } from './AmenityFilter';

interface Props {
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];
const columnHelper = createColumnHelper<DiscrepancyResult>();

// Score color helper
function getScoreColor(score: number): string {
  if (score >= 75) return 'text-green-600 bg-green-100';
  if (score >= 60) return 'text-blue-600 bg-blue-100';
  if (score >= 45) return 'text-yellow-600 bg-yellow-100';
  if (score >= 30) return 'text-orange-600 bg-orange-100';
  return 'text-red-600 bg-red-100';
}

function getConfidenceBadge(confidence: string): { color: string; label: string } {
  switch (confidence) {
    case 'high': return { color: 'bg-green-100 text-green-700', label: 'High Confidence' };
    case 'medium': return { color: 'bg-yellow-100 text-yellow-700', label: 'Medium Confidence' };
    default: return { color: 'bg-red-100 text-red-700', label: 'Low Confidence' };
  }
}

// Debounce hook - 150ms for snappier feel
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'opportunity_score', desc: true },
  ]);
  
  const toggleRowExpansion = (rowId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };
  
  // Debounce filter changes - 200ms balance between responsiveness and API efficiency
  const debouncedFilters = useDebounce(amenityFilters.required, 200);

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
      
      setData(results);
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
      'Score', 'Confidence', 'City', 'State', 'Bedrooms', 
      'Net Monthly Cashflow', 'Net Annual Profit', 'Break-Even Occupancy',
      'AirDNA Annual', 'Adj Annual (w/occupancy)', 'Annual Expenses',
      'Avg Rent/Mo', 'Bottom 10% Rent/Mo', 'Listings', 
      'Recommendation', 'Strengths', 'Weaknesses'
    ];
    
    const rows = data.map(r => [
      r.opportunity_score,
      r.data_confidence,
      r.city,
      r.state,
      r.bedrooms,
      r.net_monthly_cashflow.toFixed(0),
      r.net_annual_profit.toFixed(0),
      (r.break_even_occupancy * 100).toFixed(0) + '%',
      r.airdna_annual_revenue.toFixed(0),
      r.adjusted_annual_revenue.toFixed(0),
      r.estimated_annual_expenses.toFixed(0),
      r.avg_rental_price.toFixed(0),
      r.bottom_10_avg_rental_price.toFixed(0),
      r.listing_count,
      r.recommendation.replace(/"/g, "'"),
      r.strengths.join('; ').replace(/"/g, "'"),
      r.weaknesses.join('; ').replace(/"/g, "'")
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
    // Create a printable HTML document with enhanced analysis
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Arbitrage Opportunities Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; font-size: 11px; }
          h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; font-size: 18px; }
          h2 { color: #374151; font-size: 14px; margin-top: 20px; }
          table { border-collapse: collapse; width: 100%; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
          th { background-color: #3b82f6; color: white; font-size: 10px; }
          tr:nth-child(even) { background-color: #f9fafb; }
          .positive { color: #16a34a; font-weight: bold; }
          .negative { color: #dc2626; }
          .score-high { background-color: #dcfce7 !important; }
          .score-good { background-color: #dbeafe !important; }
          .score-low { background-color: #fee2e2 !important; }
          .footer { margin-top: 20px; font-size: 9px; color: #666; }
          .opportunity { page-break-inside: avoid; margin-bottom: 15px; border: 1px solid #e5e7eb; padding: 10px; border-radius: 5px; }
          .recommendation { background-color: #f3f4f6; padding: 8px; border-radius: 4px; margin-top: 8px; }
          .metrics { display: flex; gap: 10px; margin-top: 8px; }
          .metric { background-color: #eff6ff; padding: 5px 10px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Rental Arbitrage Analysis Report</h1>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Total Opportunities Analyzed:</strong> ${data.length}</p>
        <p><strong>Sorted by:</strong> AI Opportunity Score (Highest First)</p>
        
        <h2>Summary Table</h2>
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Location</th>
              <th>BR</th>
              <th>Net Cashflow/Mo</th>
              <th>Break-Even Occ.</th>
              <th>Target Rent</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr class="${r.opportunity_score >= 75 ? 'score-high' : r.opportunity_score >= 60 ? 'score-good' : r.opportunity_score < 30 ? 'score-low' : ''}">
                <td><strong>${r.opportunity_score}</strong></td>
                <td>${r.city}, ${r.state}</td>
                <td>${r.bedrooms}</td>
                <td class="${r.net_monthly_cashflow > 0 ? 'positive' : 'negative'}">
                  ${r.net_monthly_cashflow > 0 ? '+' : ''}$${Math.round(r.net_monthly_cashflow).toLocaleString()}
                </td>
                <td>${(r.break_even_occupancy * 100).toFixed(0)}%</td>
                <td>$${Math.round(r.bottom_10_avg_rental_price).toLocaleString()}/mo</td>
                <td>${r.data_confidence}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <h2>Detailed Analysis</h2>
        ${data.slice(0, 10).map(r => `
          <div class="opportunity">
            <h3 style="margin: 0 0 8px 0; color: #1f2937;">
              ${r.city}, ${r.state} - ${r.bedrooms} BR 
              <span style="background: ${r.opportunity_score >= 75 ? '#dcfce7' : r.opportunity_score >= 60 ? '#dbeafe' : r.opportunity_score < 30 ? '#fee2e2' : '#fef3c7'}; padding: 2px 8px; border-radius: 10px; margin-left: 10px;">
                Score: ${r.opportunity_score}/100
              </span>
            </h3>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px;">
              <div class="metric"><strong>Net Cashflow:</strong> $${Math.round(r.net_monthly_cashflow).toLocaleString()}/mo</div>
              <div class="metric"><strong>Break-Even:</strong> ${(r.break_even_occupancy * 100).toFixed(0)}% occ.</div>
              <div class="metric"><strong>Target Rent:</strong> $${Math.round(r.bottom_10_avg_rental_price).toLocaleString()}/mo</div>
              <div class="metric"><strong>Expenses:</strong> $${Math.round(r.estimated_annual_expenses).toLocaleString()}/yr</div>
            </div>
            
            <div class="recommendation">
              <strong>AI Recommendation:</strong> ${r.recommendation}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px;">
              <div>
                <strong style="color: #16a34a;">Strengths:</strong>
                <ul style="margin: 4px 0; padding-left: 20px;">
                  ${r.strengths.map(s => `<li>${s}</li>`).join('')}
                  ${r.strengths.length === 0 ? '<li style="color: #9ca3af;">None identified</li>' : ''}
                </ul>
              </div>
              <div>
                <strong style="color: #d97706;">Risks:</strong>
                <ul style="margin: 4px 0; padding-left: 20px;">
                  ${r.weaknesses.map(w => `<li>${w}</li>`).join('')}
                  ${r.weaknesses.length === 0 ? '<li style="color: #9ca3af;">None identified</li>' : ''}
                </ul>
              </div>
            </div>
          </div>
        `).join('')}
        
        <div class="footer">
          <p><strong>Score Guide:</strong> 75+ = Strong opportunity (green), 60-74 = Good opportunity (blue), 45-59 = Moderate, 30-44 = Marginal, &lt;30 = Not recommended (red)</p>
          <p><strong>Note:</strong> Analysis includes estimated operating costs (cleaning, supplies, platform fees, utilities, insurance, maintenance). Actual results may vary.</p>
          <p>Report shows detailed analysis for top 10 opportunities. Export to CSV for complete data.</p>
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
    columnHelper.accessor('opportunity_score', {
      header: 'Score',
      cell: info => {
        const score = info.getValue();
        return (
          <div className={cn('font-bold text-lg px-2 py-1 rounded-lg text-center', getScoreColor(score))}>
            {score}
          </div>
        );
      },
    }),
    columnHelper.accessor(row => `${row.city}, ${row.state}`, {
      id: 'location',
      header: 'City',
      cell: info => {
        const conf = getConfidenceBadge(info.row.original.data_confidence);
        return (
          <div>
            <span className="font-medium">{info.getValue()}</span>
            <div className={cn('text-xs px-1.5 py-0.5 rounded inline-block mt-1', conf.color)}>
              {conf.label}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor('bedrooms', {
      header: 'BR',
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('net_monthly_cashflow', {
      header: 'Net Cashflow',
      cell: info => {
        const value = info.getValue();
        return (
          <div>
            <span className={cn('font-bold text-lg', value > 0 ? 'text-green-600' : 'text-red-600')}>
              {value > 0 ? '+' : ''}{formatCurrency(value)}/mo
            </span>
            <div className="text-xs text-gray-500">
              {formatCurrency(info.row.original.net_annual_profit)}/yr
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor('break_even_occupancy', {
      header: 'Break-Even',
      cell: info => {
        const value = info.getValue();
        return (
          <span className={cn(
            'font-semibold',
            value < 0.50 ? 'text-green-600' : value < 0.65 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {(value * 100).toFixed(0)}% occ.
          </span>
        );
      },
    }),
    columnHelper.accessor('bottom_10_avg_rental_price', {
      header: 'Target Rent',
      cell: info => (
        <div>
          <span className="text-blue-600 font-medium">{formatCurrency(info.getValue())}/mo</span>
          <div className="text-xs text-gray-500">
            bottom 10%
          </div>
        </div>
      ),
    }),
    columnHelper.accessor('listing_count', {
      header: 'Data',
      cell: info => (
        <div className="text-sm">
          <div>{info.getValue()} listings</div>
          <div className="text-xs text-gray-500">{info.row.original.airdna_data_count} AirDNA</div>
        </div>
      ),
    }),
    columnHelper.display({
      id: 'expand',
      header: '',
      cell: info => {
        const rowId = `${info.row.original.city}_${info.row.original.state}_${info.row.original.bedrooms}`;
        const isExpanded = expandedRows.has(rowId);
        return (
          <button 
            onClick={() => toggleRowExpansion(rowId)}
            className="p-1 hover:bg-gray-100 rounded"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        );
      },
    }),
  ], [expandedRows]);

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
            Sorted by <span className="font-semibold">Opportunity Score</span> (AI-calculated based on profitability, risk, and data quality).
            Click rows to expand for detailed analysis. 
            <span className="font-medium text-green-600"> Green scores (75+) = strong opportunities</span>.
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
                          header.id !== 'expand' && 'cursor-pointer select-none hover:bg-gray-100',
                          header.column.getIsSorted() && 'bg-gray-100'
                        )}
                        onClick={header.id !== 'expand' ? header.column.getToggleSortingHandler() : undefined}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.id !== 'expand' && (
                            header.column.getIsSorted() === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-30" />
                            )
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => {
                  const rowId = `${row.original.city}_${row.original.state}_${row.original.bedrooms}`;
                  const isExpanded = expandedRows.has(rowId);
                  const d = row.original;
                  
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={cn(
                          'cursor-pointer hover:bg-gray-50',
                          d.opportunity_score >= 75 && 'bg-green-50/50',
                          d.opportunity_score < 30 && 'bg-red-50/30'
                        )}
                        onClick={() => toggleRowExpansion(rowId)}
                      >
                        {row.getVisibleCells().map(cell => (
                          <td key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && (
                        <tr key={`${row.id}-expanded`} className="bg-gray-50">
                          <td colSpan={columns.length} className="p-4">
                            {/* AI Analysis Panel */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                              {/* Recommendation */}
                              <div className="lg:col-span-3 bg-white rounded-lg border p-4">
                                <div className="flex items-start gap-3">
                                  <Brain className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <h4 className="font-semibold text-gray-900 mb-1">AI Analysis</h4>
                                    <p className="text-gray-700">{d.recommendation}</p>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Strengths */}
                              <div className="bg-white rounded-lg border p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <CheckCircle className="h-5 w-5 text-green-600" />
                                  <h4 className="font-semibold text-green-700">Strengths</h4>
                                </div>
                                {d.strengths.length > 0 ? (
                                  <ul className="space-y-2">
                                    {d.strengths.map((s, i) => (
                                      <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                        <span className="text-green-500 mt-1">•</span>
                                        {s}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-gray-500 italic">No significant strengths identified</p>
                                )}
                              </div>
                              
                              {/* Weaknesses */}
                              <div className="bg-white rounded-lg border p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                                  <h4 className="font-semibold text-amber-700">Risks & Weaknesses</h4>
                                </div>
                                {d.weaknesses.length > 0 ? (
                                  <ul className="space-y-2">
                                    {d.weaknesses.map((w, i) => (
                                      <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                        <span className="text-amber-500 mt-1">•</span>
                                        {w}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-gray-500 italic">No significant weaknesses identified</p>
                                )}
                              </div>
                              
                              {/* Financial Breakdown */}
                              <div className="bg-white rounded-lg border p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <DollarSign className="h-5 w-5 text-blue-600" />
                                  <h4 className="font-semibold text-blue-700">Financial Breakdown</h4>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">AirDNA Gross Revenue</span>
                                    <span className="font-medium">{formatCurrency(d.airdna_annual_revenue)}/yr</span>
                                  </div>
                                  <div className="flex justify-between text-gray-500">
                                    <span>× Est. Occupancy ({(d.estimated_occupancy_rate * 100).toFixed(0)}%)</span>
                                    <span>{formatCurrency(d.adjusted_annual_revenue)}/yr</span>
                                  </div>
                                  <div className="flex justify-between text-red-600">
                                    <span>− Annual Rent (bottom 10%)</span>
                                    <span>-{formatCurrency(d.bottom_10_avg_rental_price * 12)}/yr</span>
                                  </div>
                                  <div className="flex justify-between text-red-600">
                                    <span>− Operating Expenses</span>
                                    <span>-{formatCurrency(d.estimated_annual_expenses)}/yr</span>
                                  </div>
                                  <div className="border-t pt-2 flex justify-between font-bold">
                                    <span className={d.net_annual_profit > 0 ? 'text-green-600' : 'text-red-600'}>
                                      Net Annual Profit
                                    </span>
                                    <span className={d.net_annual_profit > 0 ? 'text-green-600' : 'text-red-600'}>
                                      {d.net_annual_profit > 0 ? '+' : ''}{formatCurrency(d.net_annual_profit)}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-500 mt-2">
                                    Expenses include: cleaning, supplies, platform fees (15%), utilities, insurance, maintenance
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Key Metrics Row */}
                            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="bg-blue-50 rounded-lg p-3 text-center">
                                <div className="text-xs text-blue-600 uppercase font-medium">Expense Ratio</div>
                                <div className="text-lg font-bold text-blue-700">{(d.expense_ratio * 100).toFixed(0)}%</div>
                              </div>
                              <div className="bg-purple-50 rounded-lg p-3 text-center">
                                <div className="text-xs text-purple-600 uppercase font-medium">AirDNA/Rent Ratio</div>
                                <div className="text-lg font-bold text-purple-700">
                                  {(d.airdna_annual_revenue / (d.bottom_10_avg_rental_price * 12)).toFixed(2)}x
                                </div>
                              </div>
                              <div className="bg-green-50 rounded-lg p-3 text-center">
                                <div className="text-xs text-green-600 uppercase font-medium">Gross ROI</div>
                                <div className="text-lg font-bold text-green-700">{d.roi_vs_bottom.toFixed(0)}%</div>
                              </div>
                              <div className="bg-amber-50 rounded-lg p-3 text-center">
                                <div className="text-xs text-amber-600 uppercase font-medium">Avg Market Rent</div>
                                <div className="text-lg font-bold text-amber-700">{formatCurrency(d.avg_rental_price)}/mo</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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
