'use client';

import { useState, useEffect, useRef } from 'react';
import { Bot, Sparkles, TrendingUp, AlertTriangle, Lightbulb, RefreshCw, Send, Loader2, MessageSquare } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { askAIAdvisor, AIQuestionResponse } from '@/lib/api';

interface AIInsight {
  type: 'comparison' | 'opportunity' | 'risk' | 'tip';
  message: string;
  market?: string;
}

interface AIAdvisorProps {
  searchResults?: any;
  isSearching?: boolean;
}

export default function AIAdvisor({ searchResults, isSearching }: AIAdvisorProps) {
  const { cityStatuses, listingsStats } = useData();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  
  // Question/Answer state
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [response, setResponse] = useState<AIQuestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate insights based on available data
  useEffect(() => {
    generateInsights();
  }, [cityStatuses, searchResults]);

  const generateInsights = () => {
    const newInsights: AIInsight[] = [];
    
    // Get cities with data
    const citiesWithData = cityStatuses.filter(c => c.has_airbtics_data);
    
    if (citiesWithData.length === 0) {
      newInsights.push({
        type: 'tip',
        message: 'Add revenue data to start finding arbitrage opportunities. Click "Data Availability" below to add markets.'
      });
    } else if (searchResults?.opportunities?.length > 0) {
      // After search - analyze results
      const topOpp = searchResults.opportunities[0];
      const avgProfit = searchResults.opportunities.reduce((sum: number, o: any) => sum + o.estimated_profit, 0) / searchResults.opportunities.length;
      
      newInsights.push({
        type: 'opportunity',
        message: `Top opportunity: ${topOpp.address} in ${topOpp.city} with $${topOpp.estimated_profit.toLocaleString()}/yr profit potential.`,
        market: topOpp.city
      });
      
      if (searchResults.opportunities.length > 5) {
        const highROI = searchResults.opportunities.filter((o: any) => o.roi_score >= 70).length;
        newInsights.push({
          type: 'comparison',
          message: `Found ${highROI} properties with ROI score 70+. Average profit across ${searchResults.opportunities.length} opportunities: $${Math.round(avgProfit).toLocaleString()}/yr.`
        });
      }
      
      // Check for risk factors
      const highBreakEven = searchResults.opportunities.filter((o: any) => o.break_even_occupancy > 0.6).length;
      if (highBreakEven > searchResults.opportunities.length / 2) {
        newInsights.push({
          type: 'risk',
          message: `${highBreakEven} properties require >60% occupancy to break even. Verify local STR regulations before committing.`
        });
      }
    } else {
      // Before search - show general insights
      const totalListings = listingsStats?.active_listings || 0;
      
      if (citiesWithData.length >= 2) {
        // Compare markets
        const sorted = [...citiesWithData].sort((a, b) => b.entries_count - a.entries_count);
        newInsights.push({
          type: 'comparison',
          message: `${sorted[0].city} has STR revenue data for ${sorted[0].entries_count} bedroom configurations. Consider searching there first for more accurate profit estimates.`,
          market: sorted[0].city
        });
      }
      
      if (totalListings > 1000) {
        newInsights.push({
          type: 'opportunity',
          message: `${totalListings.toLocaleString()} active listings across ${citiesWithData.length} markets. Use filters to narrow down the best opportunities.`
        });
      }
      
      // General tips
      newInsights.push({
        type: 'tip',
        message: '6+ bedroom properties often have the highest profit margins due to less competition and group travel demand. Make sure to add STR revenue data for these bedroom counts.'
      });
      
      newInsights.push({
        type: 'tip',
        message: 'Use "City + Radius" search with "exclude target city" option if the main city has STR restrictions but surrounding areas allow short-term rentals.'
      });
      
      // Check if user might be missing high-bedroom data
      const totalEntries = citiesWithData.reduce((sum, c) => sum + c.entries_count, 0);
      if (totalEntries > 0 && totalEntries < citiesWithData.length * 6) {
        newInsights.push({
          type: 'risk',
          message: 'Your STR revenue data may be incomplete. Make sure to add data for 6-8 bedroom properties which typically have the highest profit potential.'
        });
      }
    }
    
    setInsights(newInsights);
    setCurrentInsightIndex(0);
  };

  const handleAskQuestion = async () => {
    if (!question.trim() || isAsking) return;
    
    setIsAsking(true);
    setError(null);
    
    try {
      const result = await askAIAdvisor(question.trim());
      setResponse(result);
      setQuestion(''); // Clear input after successful response
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to get a response. Please try again.');
      console.error('AI Advisor error:', err);
    } finally {
      setIsAsking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAskQuestion();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuestion(suggestion);
    inputRef.current?.focus();
  };

  const cycleInsight = () => {
    if (insights.length > 1) {
      setCurrentInsightIndex((prev) => (prev + 1) % insights.length);
    }
  };

  const currentInsight = insights[currentInsightIndex];

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'comparison':
        return <TrendingUp className="w-4 h-4" />;
      case 'opportunity':
        return <Sparkles className="w-4 h-4" />;
      case 'risk':
        return <AlertTriangle className="w-4 h-4" />;
      case 'tip':
      default:
        return <Lightbulb className="w-4 h-4" />;
    }
  };

  const getInsightStyle = (type: string) => {
    switch (type) {
      case 'comparison':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      case 'opportunity':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'risk':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'tip':
      default:
        return 'bg-indigo-50 border-indigo-200 text-indigo-800';
    }
  };

  if (isSearching) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
          <Bot className="w-5 h-5 text-gray-400 animate-pulse" />
          <span className="text-gray-500">Analyzing opportunities...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* AI Advisor Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
          <Bot className="w-5 h-5" />
          <span className="font-medium">AI Advisor</span>
          {response?.source === 'openai' && (
            <span className="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded-full">GPT</span>
          )}
        </div>

        {/* Question Input */}
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about markets, properties, or strategies..."
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={isAsking}
            />
            <button
              onClick={handleAskQuestion}
              disabled={!question.trim() || isAsking}
              className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isAsking ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Response Area */}
        {(response || error) && (
          <div className="p-4 border-b border-gray-100">
            {error ? (
              <div className="text-red-600 text-sm">{error}</div>
            ) : response && (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-4 h-4 text-indigo-500 mt-1 flex-shrink-0" />
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {response.answer}
                  </div>
                </div>
                
                {/* Suggestions */}
                {response.suggestions && response.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {response.suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Insights Section */}
        {currentInsight && (
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 uppercase tracking-wide">
              <Lightbulb className="w-3 h-3" />
              <span>Insights</span>
              {insights.length > 1 && (
                <span className="ml-auto text-gray-400">
                  {currentInsightIndex + 1} / {insights.length}
                </span>
              )}
            </div>
            <div className={`flex items-start gap-3 px-3 py-2 border rounded-lg transition-all ${getInsightStyle(currentInsight.type)}`}>
              <div className="flex-shrink-0 mt-0.5">
                {getInsightIcon(currentInsight.type)}
              </div>
              <p className="text-sm leading-relaxed flex-1">{currentInsight.message}</p>
              {insights.length > 1 && (
                <button
                  onClick={cycleInsight}
                  className="flex-shrink-0 p-1 rounded hover:bg-white/50 transition-colors"
                  title="Next insight"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {insights.length > 1 && (
              <div className="flex justify-center gap-1 mt-2">
                {insights.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentInsightIndex(idx)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      idx === currentInsightIndex ? 'bg-gray-500 w-3' : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
