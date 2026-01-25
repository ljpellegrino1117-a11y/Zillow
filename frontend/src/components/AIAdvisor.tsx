'use client';

import { useState, useEffect } from 'react';
import { Bot, Sparkles, TrendingUp, AlertTriangle, Lightbulb, RefreshCw } from 'lucide-react';
import { useData } from '@/context/DataContext';

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
  const [isGenerating, setIsGenerating] = useState(false);

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
          message: `${sorted[0].city} has the most revenue data (${sorted[0].entries_count} entries). Consider searching there first for accurate profit estimates.`,
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
        message: '3-5 bedroom properties typically offer the best arbitrage margins. Properties with pools can command 15-25% higher nightly rates.'
      });
      
      newInsights.push({
        type: 'tip',
        message: 'Use "City + Radius" search with "exclude target city" option if the main city has STR restrictions but surrounding areas allow short-term rentals.'
      });
    }
    
    setInsights(newInsights);
    setCurrentInsightIndex(0);
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

  if (!currentInsight) {
    return null;
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl transition-all ${getInsightStyle(currentInsight.type)}`}>
        <div className="flex-shrink-0 mt-0.5">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {getInsightIcon(currentInsight.type)}
            <span className="text-xs font-medium uppercase tracking-wide opacity-75">
              {currentInsight.type === 'comparison' && 'Market Insight'}
              {currentInsight.type === 'opportunity' && 'Opportunity'}
              {currentInsight.type === 'risk' && 'Risk Alert'}
              {currentInsight.type === 'tip' && 'Pro Tip'}
            </span>
          </div>
          <p className="text-sm leading-relaxed">{currentInsight.message}</p>
        </div>
        {insights.length > 1 && (
          <button
            onClick={cycleInsight}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/50 transition-colors"
            title="Next insight"
          >
            <RefreshCw className="w-4 h-4" />
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
                idx === currentInsightIndex ? 'bg-gray-600 w-3' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
