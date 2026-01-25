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
  MapPin,
  Plus,
  Trash2,
  Clock,
  Zap,
  X
} from 'lucide-react';
import { 
  getInvestmentSuggestions, 
  getAllEvents,
  createCustomEvent,
  deleteCustomEvent,
  InvestmentSuggestionsResponse,
  EventData,
  EventsListResponse,
  EventCreate
} from '@/lib/api';

interface Props {
  refreshTrigger?: number;
}

export default function AIInvestmentSuggestions({ refreshTrigger }: Props) {
  const [suggestions, setSuggestions] = useState<InvestmentSuggestionsResponse | null>(null);
  const [events, setEvents] = useState<EventsListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'analysis' | 'events' | 'add'>('analysis');
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  
  // Add event form state
  const [newEvent, setNewEvent] = useState<EventCreate>({
    name: '',
    city: '',
    state: '',
    start_date: '',
    end_date: '',
    event_type: 'other',
    demand_multiplier: 2.0,
    recurrence: 'one_time',
    description: '',
    affects_radius_miles: 25
  });
  const [addingEvent, setAddingEvent] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load events on mount
  useEffect(() => {
    loadEvents();
  }, [refreshTrigger]);

  const loadEvents = async () => {
    try {
      setEventsLoading(true);
      const data = await getAllEvents(730); // 2 years ahead
      setEvents(data);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setEventsLoading(false);
    }
  };

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

  const handleAddEvent = async () => {
    if (!newEvent.name || !newEvent.city || !newEvent.state || !newEvent.start_date || !newEvent.end_date) {
      setAddError('Please fill in all required fields');
      return;
    }
    
    setAddingEvent(true);
    setAddError(null);
    
    try {
      await createCustomEvent(newEvent);
      // Reset form
      setNewEvent({
        name: '',
        city: '',
        state: '',
        start_date: '',
        end_date: '',
        event_type: 'other',
        demand_multiplier: 2.0,
        recurrence: 'one_time',
        description: '',
        affects_radius_miles: 25
      });
      // Reload events
      await loadEvents();
      setActiveTab('events');
    } catch (err: any) {
      setAddError(err.response?.data?.detail || 'Failed to add event');
    } finally {
      setAddingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: number) => {
    if (!confirm('Are you sure you want to delete this custom event?')) return;
    
    try {
      await deleteCustomEvent(eventId);
      await loadEvents();
    } catch (err) {
      console.error('Failed to delete event:', err);
    }
  };

  // Format markdown-like text to HTML
  const formatSuggestions = (text: string) => {
    if (!text) return '';
    
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

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'strategic': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getUrgencyIcon = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return <Zap className="h-3.5 w-3.5" />;
      case 'high': return <Clock className="h-3.5 w-3.5" />;
      default: return <Calendar className="h-3.5 w-3.5" />;
    }
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
              AI Event Advisor
              <Sparkles className="h-4 w-4 text-yellow-500" />
            </h2>
            <p className="text-sm text-gray-600">
              Event-driven investment analysis & custom event tracking
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
                {suggestions ? 'Refresh' : 'Generate'}
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
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('analysis'); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'analysis' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Brain className="h-4 w-4 inline mr-1" />
              AI Analysis
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('events'); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'events' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Calendar className="h-4 w-4 inline mr-1" />
              Events Calendar
              {events && <span className="ml-1 text-xs">({events.events.length})</span>}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('add'); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'add' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Plus className="h-4 w-4 inline mr-1" />
              Add Event
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* AI Analysis Tab */}
          {activeTab === 'analysis' && (
            <div>
              {!suggestions && !loading && !error && (
                <div className="text-center py-12 bg-white/50 rounded-lg border border-dashed border-indigo-200">
                  <Brain className="h-12 w-12 text-indigo-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Ready to Analyze Your Markets
                  </h3>
                  <p className="text-gray-600 mb-4 max-w-md mx-auto">
                    Click "Generate" to get AI-powered investment suggestions based on your 
                    revenue data and upcoming events.
                  </p>
                  <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {events?.total_curated || 0} curated events
                    </span>
                    <span className="flex items-center gap-1">
                      <Plus className="h-4 w-4" />
                      {events?.total_custom || 0} custom events
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
                      <p className="text-sm text-gray-500">Researching events & trends (15-20 seconds)</p>
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
                        <strong>{suggestions.markets_analyzed}</strong> markets
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <span className="text-sm">
                        <strong>{suggestions.total_data_points}</strong> revenue records
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-orange-600" />
                      <span className="text-sm">
                        <strong>{suggestions.total_events_tracked || 0}</strong> events tracked
                      </span>
                    </div>
                  </div>

                  {/* Events by Urgency */}
                  {suggestions.events_by_urgency && (
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-orange-600" />
                        Events Affecting Your Markets
                      </h3>
                      
                      <div className="space-y-3">
                        {/* Urgent */}
                        {suggestions.events_by_urgency.urgent?.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1 text-sm font-medium text-red-800 mb-2">
                              <Zap className="h-4 w-4" />
                              URGENT ({`<`}3 months)
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {suggestions.events_by_urgency.urgent.map((event, idx) => (
                                <span 
                                  key={idx}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getUrgencyColor('urgent')}`}
                                >
                                  {event.name}
                                  <span className="opacity-75">
                                    {event.days_until}d • {event.demand_multiplier}x
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* High */}
                        {suggestions.events_by_urgency.high?.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1 text-sm font-medium text-orange-800 mb-2">
                              <Clock className="h-4 w-4" />
                              HIGH PRIORITY (3-6 months)
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {suggestions.events_by_urgency.high.map((event, idx) => (
                                <span 
                                  key={idx}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getUrgencyColor('high')}`}
                                >
                                  {event.name}
                                  <span className="opacity-75">
                                    {event.days_until}d • {event.demand_multiplier}x
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Top Revenue Markets */}
                  {suggestions.top_opportunities?.length > 0 && (
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
                            {opp.events && opp.events.length > 0 && (
                              <div className="mt-1 text-xs text-orange-600">
                                {opp.events.length} event{opp.events.length > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
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

          {/* Events Calendar Tab */}
          {activeTab === 'events' && (
            <div>
              {eventsLoading ? (
                <div className="text-center py-8">
                  <RefreshCw className="h-6 w-6 text-indigo-600 animate-spin mx-auto" />
                  <p className="text-gray-500 mt-2">Loading events...</p>
                </div>
              ) : events ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-white/70 rounded-lg p-3">
                    <span className="text-sm text-gray-600">
                      <strong>{events.total_curated}</strong> curated events • 
                      <strong className="ml-1">{events.total_custom}</strong> custom events
                    </span>
                    <span className="text-sm text-gray-600">
                      <strong>{events.markets_with_events}</strong> markets affected
                    </span>
                  </div>
                  
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Event</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Dates</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Urgency</th>
                          <th className="text-center px-4 py-3 font-medium text-gray-600">Demand</th>
                          <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {events.events.slice(0, 20).map((event, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{event.name}</div>
                              <div className="text-xs text-gray-500">{event.event_type}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {event.city}, {event.state}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(event.start_date).toLocaleDateString()} - 
                              {new Date(event.end_date).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getUrgencyColor(event.urgency)}`}>
                                {getUrgencyIcon(event.urgency)}
                                {event.urgency}
                                <span className="opacity-75">({event.days_until}d)</span>
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="font-medium text-orange-600">
                                {event.demand_multiplier}x
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {event.is_custom && (
                                <button
                                  onClick={() => event.id && handleDeleteEvent(event.id)}
                                  className="text-red-600 hover:text-red-800 p-1"
                                  title="Delete custom event"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {events.events.length > 20 && (
                      <div className="px-4 py-3 bg-gray-50 text-sm text-gray-500">
                        Showing 20 of {events.events.length} events
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No events loaded
                </div>
              )}
            </div>
          )}

          {/* Add Event Tab */}
          {activeTab === 'add' && (
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Plus className="h-5 w-5 text-indigo-600" />
                Add Custom Event
              </h3>
              
              {addError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-red-600 text-sm">{addError}</p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Name *
                  </label>
                  <input
                    type="text"
                    value={newEvent.name}
                    onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
                    placeholder="e.g., Taylor Swift Concert"
                    className="input w-full"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      City *
                    </label>
                    <input
                      type="text"
                      value={newEvent.city}
                      onChange={(e) => setNewEvent({ ...newEvent, city: e.target.value })}
                      placeholder="Austin"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      State *
                    </label>
                    <input
                      type="text"
                      value={newEvent.state}
                      onChange={(e) => setNewEvent({ ...newEvent, state: e.target.value })}
                      placeholder="TX"
                      maxLength={2}
                      className="input w-full uppercase"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={newEvent.start_date}
                    onChange={(e) => setNewEvent({ ...newEvent, start_date: e.target.value })}
                    className="input w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    value={newEvent.end_date}
                    onChange={(e) => setNewEvent({ ...newEvent, end_date: e.target.value })}
                    className="input w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Type
                  </label>
                  <select
                    value={newEvent.event_type}
                    onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
                    className="input w-full"
                  >
                    <option value="sports">Sports</option>
                    <option value="conference">Conference</option>
                    <option value="festival">Festival</option>
                    <option value="holiday">Holiday</option>
                    <option value="cultural">Cultural</option>
                    <option value="political">Political</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Demand Multiplier
                  </label>
                  <select
                    value={newEvent.demand_multiplier}
                    onChange={(e) => setNewEvent({ ...newEvent, demand_multiplier: parseFloat(e.target.value) })}
                    className="input w-full"
                  >
                    <option value="1.5">1.5x - Moderate increase</option>
                    <option value="2.0">2.0x - Significant increase</option>
                    <option value="2.5">2.5x - High demand</option>
                    <option value="3.0">3.0x - Very high demand</option>
                    <option value="3.5">3.5x - Extremely high</option>
                    <option value="4.0">4.0x - Maximum demand</option>
                  </select>
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={newEvent.description}
                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                    placeholder="Brief description of the event and expected impact..."
                    className="input w-full"
                    rows={2}
                  />
                </div>
              </div>
              
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleAddEvent}
                  disabled={addingEvent}
                  className="btn btn-primary"
                >
                  {addingEvent ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Add Event
                    </>
                  )}
                </button>
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
