'use client';

import { useState, useEffect } from 'react';
import { 
  Brain, 
  RefreshCw, 
  TrendingUp, 
  Calendar, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  DollarSign,
  MapPin
} from 'lucide-react';
import { getInvestmentSuggestions, InvestmentSuggestions, MarketOpportunity } from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

export default function AIInvestmentSuggestions({ refreshTrigger }: Props) {
  const [suggestions, setSuggestions] = useState<InvestmentSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInvestmentSuggestions();
      setSuggestions(data);
      setLastGenerated(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error('Failed to fetch suggestions:', err);
      setError(err.response?.data?.detail || 'Failed to generate suggestions. Make sure OpenAI API key is configured.');
    } finally {
      setLoading(false);
    }
  };

  // Format markdown-like text to HTML
  const formatSuggestions = (text: string) => {
    if (!text) return '';
    
    // Convert markdown headers
    let formatted = text
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^### (.*$)/gim, '<h4 class="text-lg font-semibold text-gray-900 mt-4 mb-2">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 class="text-xl font-bold text-gray-900 mt-5 mb-3">$1</h3>')
      .replace(/^# (.*$)/gim, '<h2 class="text-2xl font-bold text-gray-900 mt-6 mb-4">$1</h2>')
      .replace(/^- (.*$)/gim, '<li class="ml-4 text-gray-700">$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li class="ml-4 text-gray-700 list-decimal">$1</li>')
      .replace(/\n\n/g, '</p><p class="mb-3 text-gray-700">')
      .replace(/\n/g, '<br/>');
    
    return `<p class="mb-3 text-gray-700">${formatted}</p>`;
  };

  return (
    <div className="card bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200">
      {/* Header */}
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              AI Investment Advisor
              <Sparkles className="h-4 w-4 text-yellow-500" />
            </h2>
            <p className="text-sm text-gray-600">
              ROI-focused suggestions based on your market data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastGenerated && (
            <span className="text-xs text-gray-500">
              Generated at {lastGenerated}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetchSuggestions();
            }}
            disabled={loading}
            className="btn btn-primary text-sm py-1.5 px-3"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {suggestions ? 'Refresh Analysis' : 'Generate Analysis'}
              </>
            )}
          </button>
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="mt-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          )}

          {!suggestions && !loading && !error && (
            <div className="text-center py-12 bg-white/50 rounded-lg border border-dashed border-indigo-200">
              <Brain className="h-12 w-12 text-indigo-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Ready to Analyze Your Markets
              </h3>
              <p className="text-gray-600 mb-4 max-w-md mx-auto">
                Click "Generate Analysis" to get AI-powered investment suggestions 
                based on your AirDNA/Airbtics data, with special attention to 
                FIFA 2026 opportunities and ROI potential.
              </p>
              <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Event-aware timing
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  ROI calculations
                </span>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  Profit projections
                </span>
              </div>
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="inline-flex items-center gap-3 bg-white px-6 py-4 rounded-lg shadow-sm">
                <RefreshCw className="h-6 w-6 text-indigo-600 animate-spin" />
                <div className="text-left">
                  <p className="font-medium text-gray-900">Analyzing your markets...</p>
                  <p className="text-sm text-gray-500">This may take 10-15 seconds</p>
                </div>
              </div>
            </div>
          )}

          {suggestions && !loading && (
            <div className="space-y-6">
              {/* Stats Bar */}
              <div className="flex items-center gap-6 bg-white/70 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-600" />
                  <span className="text-sm">
                    <strong>{suggestions.markets_analyzed}</strong> markets analyzed
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  <span className="text-sm">
                    <strong>{suggestions.total_data_points}</strong> data points
                  </span>
                </div>
                {suggestions.event_opportunities.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-orange-600" />
                    <span className="text-sm">
                      <strong>{suggestions.event_opportunities.length}</strong> FIFA 2026 cities
                    </span>
                  </div>
                )}
              </div>

              {/* Top Opportunities Quick View */}
              {suggestions.top_opportunities.length > 0 && (
                <div className="bg-white rounded-lg p-4 border border-indigo-100">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    Top Revenue Markets
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {suggestions.top_opportunities.map((opp, idx) => (
                      <div 
                        key={idx}
                        className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-100"
                      >
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {opp.city}, {opp.state}
                        </div>
                        <div className="text-lg font-bold text-green-700">
                          ${(opp.avg_annual_revenue / 1000).toFixed(0)}k
                        </div>
                        <div className="text-xs text-gray-500">
                          avg/year • {opp.data_points} records
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FIFA Cities Alert */}
              {suggestions.event_opportunities.length > 0 && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg p-4 border border-orange-200">
                  <h3 className="font-semibold text-orange-800 mb-2 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    FIFA World Cup 2026 Host Cities in Your Data
                  </h3>
                  <p className="text-sm text-orange-700 mb-3">
                    These cities will see massive STR demand June-July 2026. Investment window is closing!
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.event_opportunities.map((opp, idx) => (
                      <span 
                        key={idx}
                        className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium"
                      >
                        {opp.city}, {opp.state}
                        <span className="text-orange-600">
                          (${(opp.avg_annual_revenue / 1000).toFixed(0)}k/yr)
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Main AI Analysis */}
              <div className="bg-white rounded-lg p-6 border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Brain className="h-5 w-5 text-indigo-600" />
                  Investment Analysis & Recommendations
                </h3>
                <div 
                  className="prose prose-sm max-w-none ai-content"
                  dangerouslySetInnerHTML={{ __html: formatSuggestions(suggestions.suggestions) }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .ai-content h2, .ai-content h3, .ai-content h4 {
          color: #1f2937;
        }
        .ai-content strong {
          color: #4338ca;
        }
        .ai-content li {
          margin-bottom: 0.25rem;
        }
      `}</style>
    </div>
  );
}
