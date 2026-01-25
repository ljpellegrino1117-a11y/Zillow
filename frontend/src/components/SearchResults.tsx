'use client';

import { useState } from 'react';
import { 
  ExternalLink, 
  Phone, 
  Mail, 
  ChevronDown, 
  ChevronUp,
  MapPin,
  Home,
  Building,
  FileSpreadsheet,
  FileText,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { OpportunityListing, OpportunitySearchResponse } from '@/lib/api';

interface SearchResultsProps {
  results: OpportunitySearchResponse | null;
  isLoading: boolean;
}

export default function SearchResults({ results, isLoading }: SearchResultsProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="w-full max-w-4xl mx-auto mt-8">
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-200 rounded-full" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                </div>
                <div className="h-8 bg-gray-200 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  if (results.opportunities.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto mt-8">
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Home className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Opportunities Found</h3>
          <p className="text-gray-500">Try adjusting your filters or searching different markets.</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'bg-green-100 text-green-700';
    if (score >= 60) return 'bg-blue-100 text-blue-700';
    if (score >= 45) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  };

  const exportToCSV = () => {
    const headers = [
      'Rank', 'ROI Score', 'Address', 'City', 'State', 'Bedrooms', 'Monthly Rent',
      'Est. Revenue', 'Est. Profit', 'Break-even', 'Agent', 'Phone', 'URL'
    ];
    
    const rows = results.opportunities.map((opp, i) => [
      i + 1, opp.roi_score, opp.address, opp.city, opp.state, opp.bedrooms,
      opp.monthly_rent, opp.estimated_annual_revenue, opp.estimated_profit,
      `${(opp.break_even_occupancy * 100).toFixed(0)}%`,
      opp.agent_name || '', opp.agent_phone || '', opp.url || ''
    ]);
    
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opportunities-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="w-full max-w-4xl mx-auto mt-8 pb-32">
      {/* Results Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-sm text-gray-500">
            Found <span className="font-semibold text-gray-900">{results.total_found}</span> opportunities
            {' '}from {results.listings_analyzed.toLocaleString()} listings
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {/* Warnings */}
      {results.warnings.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-700">
              {results.warnings.slice(0, 3).map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {results.opportunities.map((opp, index) => (
          <div
            key={opp.listing_id || index}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-300 transition-colors"
          >
            {/* Main Row */}
            <div
              className="p-4 cursor-pointer"
              onClick={() => setExpandedId(expandedId === index ? null : index)}
            >
              <div className="flex items-center gap-4">
                {/* Rank */}
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                  #{index + 1}
                </div>

                {/* Address */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{opp.address}</h3>
                  <p className="text-sm text-gray-500">
                    {opp.city}, {opp.state} • {opp.bedrooms} BR
                    {opp.bathrooms ? ` / ${opp.bathrooms} BA` : ''}
                    {opp.sqft ? ` • ${opp.sqft.toLocaleString()} sqft` : ''}
                  </p>
                </div>

                {/* Metrics */}
                <div className="hidden sm:flex items-center gap-6 text-right">
                  <div>
                    <p className="text-xs text-gray-500">Rent</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(opp.monthly_rent)}/mo</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Profit</p>
                    <p className={`font-bold ${opp.estimated_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(opp.estimated_profit)}/yr
                    </p>
                  </div>
                </div>

                {/* Score */}
                <div className={`px-3 py-1.5 rounded-full font-bold text-sm ${getScoreColor(opp.roi_score)}`}>
                  {opp.roi_score}
                </div>

                {/* Expand Icon */}
                {expandedId === index ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </div>

            {/* Expanded Details */}
            {expandedId === index && (
              <div className="border-t border-gray-100 p-4 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Financials */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Financials</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Annual Rent:</span>
                        <span className="text-red-600">-{formatCurrency(opp.annual_rent)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">STR Revenue:</span>
                        <span className="text-blue-600">+{formatCurrency(opp.estimated_annual_revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Expenses:</span>
                        <span className="text-red-600">-{formatCurrency(opp.estimated_expenses)}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-gray-200">
                        <span className="font-medium">Net Profit:</span>
                        <span className={`font-medium ${opp.estimated_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(opp.estimated_profit)}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Break-even:</span>
                        <span>{(opp.break_even_occupancy * 100).toFixed(0)}% occupancy</span>
                      </div>
                    </div>
                  </div>

                  {/* Strengths & Risks */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Analysis</h4>
                    <div className="space-y-2">
                      {opp.strengths.length > 0 && (
                        <div>
                          <p className="text-xs text-green-600 font-medium mb-1">Strengths</p>
                          {opp.strengths.slice(0, 2).map((s, i) => (
                            <p key={i} className="text-xs text-gray-600">+ {s}</p>
                          ))}
                        </div>
                      )}
                      {opp.weaknesses.length > 0 && (
                        <div>
                          <p className="text-xs text-amber-600 font-medium mb-1">Risks</p>
                          {opp.weaknesses.slice(0, 2).map((w, i) => (
                            <p key={i} className="text-xs text-gray-600">- {w}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Contact */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Contact</h4>
                    <div className="space-y-2 text-sm">
                      {opp.agent_name && (
                        <p className="font-medium text-gray-900">{opp.agent_name}</p>
                      )}
                      {opp.agent_company && (
                        <p className="text-gray-600 flex items-center gap-1">
                          <Building className="w-3.5 h-3.5" />
                          {opp.agent_company}
                        </p>
                      )}
                      {opp.agent_phone && (
                        <a href={`tel:${opp.agent_phone}`} className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" />
                          {opp.agent_phone}
                        </a>
                      )}
                      {opp.agent_email && (
                        <a href={`mailto:${opp.agent_email}`} className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5" />
                          Email
                        </a>
                      )}
                      {opp.url && (
                        <a
                          href={opp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View Listing
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Amenities Tags */}
                <div className="mt-4 pt-3 border-t border-gray-200 flex flex-wrap gap-2">
                  {opp.has_pool && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Pool</span>}
                  {opp.has_waterfront && <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-1 rounded">Waterfront</span>}
                  {opp.has_garage && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">Garage</span>}
                  {opp.has_yard && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Yard</span>}
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                    {opp.listing_source}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
