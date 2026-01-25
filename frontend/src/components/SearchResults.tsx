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
      'Rank', 'ROI Score', 'Address', 'City', 'State', 'Zip Code', 'Bedrooms', 'Bathrooms', 'Sqft',
      'Monthly Rent', 'Annual Rent', 'Est. Revenue', 'Est. Expenses', 'Est. Profit', 
      'Break-even Occupancy', 'Agent Name', 'Agent Phone', 'Agent Email', 'Agent Company',
      'Listing URL', 'Has Pool', 'Has Waterfront', 'Has Garage', 'Has Yard',
      'Strengths', 'Weaknesses', 'Revenue Source'
    ];
    
    const rows = results.opportunities.map((opp, i) => [
      i + 1, opp.roi_score, opp.address, opp.city, opp.state, opp.zip_code || '',
      opp.bedrooms, opp.bathrooms || '', opp.sqft || '',
      opp.monthly_rent, opp.annual_rent, opp.estimated_annual_revenue, 
      opp.estimated_expenses, opp.estimated_profit,
      `${(opp.break_even_occupancy * 100).toFixed(0)}%`,
      opp.agent_name || '', opp.agent_phone || '', opp.agent_email || '', opp.agent_company || '',
      opp.url || '',
      opp.has_pool ? 'Yes' : 'No', opp.has_waterfront ? 'Yes' : 'No',
      opp.has_garage ? 'Yes' : 'No', opp.has_yard ? 'Yes' : 'No',
      opp.strengths.join('; '), opp.weaknesses.join('; '),
      opp.revenue_source
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opportunities-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToPDF = () => {
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Rental Arbitrage Opportunities</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
          h1 { color: #1e40af; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
          .summary { background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
          .summary-item { text-align: center; }
          .summary-value { font-size: 24px; font-weight: bold; color: #1e40af; }
          .summary-label { font-size: 12px; color: #6b7280; }
          .opportunity { border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 15px; page-break-inside: avoid; }
          .opportunity-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .rank { background: #1e40af; color: white; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 10px; }
          .score { padding: 4px 12px; border-radius: 20px; font-weight: bold; }
          .score-high { background: #dcfce7; color: #16a34a; }
          .score-good { background: #dbeafe; color: #2563eb; }
          .score-medium { background: #fef3c7; color: #d97706; }
          .score-low { background: #fee2e2; color: #dc2626; }
          .address { font-size: 18px; font-weight: 600; margin: 0; display: inline; }
          .location { color: #6b7280; font-size: 14px; margin-top: 4px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; background: #f9fafb; padding: 10px; border-radius: 6px; }
          .metric { text-align: center; }
          .metric-value { font-size: 16px; font-weight: 600; }
          .metric-label { font-size: 11px; color: #6b7280; }
          .profit-positive { color: #16a34a; }
          .profit-negative { color: #dc2626; }
          .contact-section { background: #f0f9ff; padding: 10px; border-radius: 6px; margin: 10px 0; }
          .contact-title { font-weight: 600; color: #1e40af; margin-bottom: 5px; }
          .listing-link a { color: #2563eb; font-weight: 500; }
          .strengths-weaknesses { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; }
          .strengths { color: #16a34a; }
          .weaknesses { color: #d97706; }
          .list-title { font-weight: 600; margin-bottom: 5px; }
          .amenities { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
          .amenity { background: #e5e7eb; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          @media print { .opportunity { page-break-inside: avoid; } }
        </style>
      </head>
      <body>
        <h1>Rental Arbitrage Opportunities</h1>
        <p>Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        
        <div class="summary">
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-value">${results.total_found}</div>
              <div class="summary-label">Opportunities Found</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${results.listings_analyzed.toLocaleString()}</div>
              <div class="summary-label">Listings Analyzed</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${results.markets_searched}</div>
              <div class="summary-label">Markets Searched</div>
            </div>
          </div>
        </div>

        ${results.ai_analysis ? `
        <div style="background: #faf5ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <div style="color: #7c3aed; font-weight: 600; margin-bottom: 10px;">AI Analysis</div>
          <p>${results.ai_analysis}</p>
        </div>
        ` : ''}

        <h2 style="color: #1e40af; margin-top: 30px;">Top Opportunities</h2>
        
        ${results.opportunities.map((opp, index) => `
          <div class="opportunity">
            <div class="opportunity-header">
              <div>
                <span class="rank">${index + 1}</span>
                <span class="address">${opp.address}</span>
                <div class="location">${opp.city}, ${opp.state} ${opp.zip_code || ''} | ${opp.bedrooms} BR ${opp.bathrooms ? `/ ${opp.bathrooms} BA` : ''} ${opp.sqft ? `| ${opp.sqft.toLocaleString()} sqft` : ''}</div>
              </div>
              <div class="score ${opp.roi_score >= 75 ? 'score-high' : opp.roi_score >= 60 ? 'score-good' : opp.roi_score >= 45 ? 'score-medium' : 'score-low'}">
                ${opp.roi_score}/100
              </div>
            </div>
            
            <div class="metrics">
              <div class="metric">
                <div class="metric-value">$${opp.monthly_rent.toLocaleString()}/mo</div>
                <div class="metric-label">Monthly Rent</div>
              </div>
              <div class="metric">
                <div class="metric-value">$${opp.estimated_annual_revenue.toLocaleString()}/yr</div>
                <div class="metric-label">Est. STR Revenue</div>
              </div>
              <div class="metric">
                <div class="metric-value">$${opp.estimated_expenses.toLocaleString()}/yr</div>
                <div class="metric-label">Est. Expenses</div>
              </div>
              <div class="metric">
                <div class="metric-value ${opp.estimated_profit >= 0 ? 'profit-positive' : 'profit-negative'}">$${opp.estimated_profit.toLocaleString()}/yr</div>
                <div class="metric-label">Est. Profit</div>
              </div>
            </div>
            
            <div class="contact-section">
              <div class="contact-title">Contact Information</div>
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; font-size: 13px;">
                ${opp.agent_name ? `<div><strong>Agent:</strong> ${opp.agent_name}</div>` : ''}
                ${opp.agent_company ? `<div><strong>Company:</strong> ${opp.agent_company}</div>` : ''}
                ${opp.agent_phone ? `<div><strong>Phone:</strong> ${opp.agent_phone}</div>` : ''}
                ${opp.agent_email ? `<div><strong>Email:</strong> ${opp.agent_email}</div>` : ''}
              </div>
              ${opp.url ? `<div class="listing-link" style="margin-top: 8px;"><strong>Listing:</strong> <a href="${opp.url}" target="_blank">${opp.url}</a></div>` : ''}
            </div>
            
            <div class="strengths-weaknesses">
              <div class="strengths">
                <div class="list-title">Strengths</div>
                ${opp.strengths.length > 0 ? opp.strengths.map(s => `<div>+ ${s}</div>`).join('') : '<div>None identified</div>'}
              </div>
              <div class="weaknesses">
                <div class="list-title">Risks</div>
                ${opp.weaknesses.length > 0 ? opp.weaknesses.map(w => `<div>- ${w}</div>`).join('') : '<div>None identified</div>'}
              </div>
            </div>
            
            <div class="amenities">
              ${opp.has_pool ? '<span class="amenity">Pool</span>' : ''}
              ${opp.has_waterfront ? '<span class="amenity">Waterfront</span>' : ''}
              ${opp.has_garage ? '<span class="amenity">Garage</span>' : ''}
              ${opp.has_yard ? '<span class="amenity">Yard</span>' : ''}
              <span class="amenity">Source: ${opp.listing_source}</span>
              <span class="amenity">Break-even: ${(opp.break_even_occupancy * 100).toFixed(0)}% occ.</span>
            </div>
          </div>
        `).join('')}
        
        <div class="footer">
          <p><strong>Score Guide:</strong> 75+ = Strong, 60-74 = Good, 45-59 = Moderate, &lt;45 = Higher risk</p>
          <p><strong>Note:</strong> Profit estimates include operating costs (cleaning, supplies, platform fees, utilities, insurance, maintenance). Actual results may vary.</p>
          <p>Generated by Zillow Arbitrage Tool</p>
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
            title="Export all data with listing URLs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={exportToPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            title="Print/save as PDF with clickable links"
          >
            <FileText className="w-4 h-4" />
            PDF
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
