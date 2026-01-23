'use client';

import { useState, useEffect, useRef } from 'react';
import { Save, DollarSign, Loader2, Trash2, Plus, Check, X, Minus, Upload, Camera, MessageSquare, Send, Image as ImageIcon, History, ChevronDown, ChevronUp, Calendar, Zap, RefreshCw, Cloud, Database } from 'lucide-react';
import { getCities, createCity, getAirDNAData, saveAirDNAData, deleteAirDNAData, analyzeScreenshot, continueAIConversation, getSavedAIAnalyses, getAIAnalysisDetail, syncAirbticsData, syncAirbticsCity, getAirbticsSyncStatus, getAirbticsCityStatuses, City, AirDNAData, AirDNAAmenities, SavedAIAnalysis, AirbticsSyncStatus, AirbticsCityStatus } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import CityAutocomplete from './CityAutocomplete';

interface Props {
  onDataSaved?: () => void;
  refreshTrigger?: number;
}

const BEDROOM_OPTIONS = [3, 4, 5, 6, 7, 8];

// Tri-state: true = WITH, false = WITHOUT, undefined = ANY
type AmenityState = true | false | undefined;

// Property amenities for AirDNA revenue matching
// NOTE: Extra rooms (office, den, loft) are NOT here - they determine potential bedrooms on listings
const AMENITY_OPTIONS = [
  { key: 'has_pool', label: 'Pool', icon: '🏊' },
  { key: 'has_hot_tub', label: 'Hot Tub', icon: '🛁' },
  { key: 'has_waterfront', label: 'Waterfront/View', icon: '🌊' },
  { key: 'has_basement', label: 'Basement', icon: '⬇️' },
  { key: 'has_garage', label: 'Garage', icon: '🚗' },
  { key: 'has_yard', label: 'Yard', icon: '🌳' },
  { key: 'has_pet_friendly', label: 'Pet Friendly', icon: '🐕' },
  { key: 'has_mother_in_law', label: 'In-Law Suite', icon: '🏘️' },
];

export default function AirDNAInput({ onDataSaved, refreshTrigger }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [zipCode, setZipCode] = useState<string>('');
  const [existingData, setExistingData] = useState<AirDNAData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // New entry form
  const [bedroomsMin, setBedroomsMin] = useState<number>(3);
  const [bedroomsMax, setBedroomsMax] = useState<number>(3);
  const [revenue, setRevenue] = useState<string>('');
  const [revenueType, setRevenueType] = useState<'annual' | 'monthly'>('annual');
  // Tri-state amenities: true = WITH, false = WITHOUT, undefined = ANY (not set)
  const [selectedAmenities, setSelectedAmenities] = useState<Record<string, AmenityState>>({});
  const [showAmenities, setShowAmenities] = useState(false);
  
  // AI Screenshot Analysis
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [aiConversationId, setAiConversationId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFollowUp, setAiFollowUp] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Saved AI Analyses
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAIAnalysis[]>([]);
  const [showSavedAnalyses, setShowSavedAnalyses] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [expandedAnalysis, setExpandedAnalysis] = useState<number | null>(null);
  const [analysisImage, setAnalysisImage] = useState<string | null>(null);
  
  // Delete confirmation state
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  
  // Airbtics sync state
  const [airbticsSyncStatus, setAirbticsSyncStatus] = useState<AirbticsSyncStatus | null>(null);
  const [airbticsCityStatuses, setAirbticsCityStatuses] = useState<AirbticsCityStatus[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingCity, setSyncingCity] = useState<number | null>(null);
  
  // Airbtics city selector for batch sync
  const [showCitySelector, setShowCitySelector] = useState(false);
  const [selectedSyncCities, setSelectedSyncCities] = useState<{city: string, state: string}[]>([]);
  const [syncCityInput, setSyncCityInput] = useState('');
  const [syncStateInput, setSyncStateInput] = useState('');

  // Fetch cities on mount and when refreshTrigger changes
  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await getCities();
        setCities(data);
        if (data.length > 0 && !selectedCity) {
          setSelectedCity(data[0].city);
          setSelectedState(data[0].state);
        }
      } catch (error) {
        console.error('Failed to fetch cities:', error);
      }
    };
    fetchCities();
  }, [refreshTrigger]);

  // Fetch AirDNA data when city changes
  useEffect(() => {
    const fetchAirDNAData = async () => {
      if (!selectedCity || !selectedState) return;
      
      setLoading(true);
      try {
        const data = await getAirDNAData(selectedCity, selectedState);
        setExistingData(data);
      } catch (error) {
        console.error('Failed to fetch AirDNA data:', error);
        setExistingData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAirDNAData();
  }, [selectedCity, selectedState]);

  // Fetch Airbtics sync status on mount and poll while syncing
  useEffect(() => {
    let mounted = true;
    
    const fetchStatus = async () => {
      if (!mounted) return;
      try {
        const [status, cityStatuses] = await Promise.all([
          getAirbticsSyncStatus(),
          getAirbticsCityStatuses()
        ]);
        if (mounted) {
          setAirbticsSyncStatus(status);
          setAirbticsCityStatuses(cityStatuses);
        }
      } catch (error) {
        console.error('Failed to fetch Airbtics status:', error);
      }
    };
    
    fetchStatus();
    
    // Poll while syncing - only if actively syncing
    const interval = setInterval(() => {
      if ((syncingAll || airbticsSyncStatus?.status === 'syncing') && mounted) {
        fetchStatus();
      }
    }, 3000); // Increased to 3s for less load
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [syncingAll, airbticsSyncStatus?.status]);

  // Airbtics sync handlers
  const handleSyncAllCities = async () => {
    setSyncingAll(true);
    try {
      await syncAirbticsData();
      // Poll for status updates
      const checkStatus = async () => {
        const status = await getAirbticsSyncStatus();
        setAirbticsSyncStatus(status);
        if (status.status === 'syncing') {
          setTimeout(checkStatus, 2000);
        } else {
          setSyncingAll(false);
          // Refresh data
          const data = await getAirDNAData(selectedCity, selectedState);
          setExistingData(data);
          const cityStatuses = await getAirbticsCityStatuses();
          setAirbticsCityStatuses(cityStatuses);
          onDataSaved?.();
        }
      };
      checkStatus();
    } catch (error) {
      console.error('Failed to sync Airbtics data:', error);
      setSyncingAll(false);
    }
  };

  const handleSyncCity = async (cityId: number) => {
    setSyncingCity(cityId);
    try {
      await syncAirbticsCity(cityId);
      // Refresh data
      const data = await getAirDNAData(selectedCity, selectedState);
      setExistingData(data);
      const cityStatuses = await getAirbticsCityStatuses();
      setAirbticsCityStatuses(cityStatuses);
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to sync city:', error);
    } finally {
      setSyncingCity(null);
    }
  };

  const handleAddSyncCity = () => {
    if (!syncCityInput.trim() || !syncStateInput.trim()) return;
    
    const newCity = { city: syncCityInput.trim(), state: syncStateInput.trim() };
    // Check if already in list
    if (!selectedSyncCities.some(c => c.city === newCity.city && c.state === newCity.state)) {
      setSelectedSyncCities(prev => [...prev, newCity]);
    }
    setSyncCityInput('');
    setSyncStateInput('');
  };

  const handleRemoveSyncCity = (index: number) => {
    setSelectedSyncCities(prev => prev.filter((_, i) => i !== index));
  };

  const handleSyncSelectedCities = async () => {
    if (selectedSyncCities.length === 0) return;
    
    setSyncingAll(true);
    try {
      // First, create cities that don't exist
      for (const cityData of selectedSyncCities) {
        const existingCity = cities.find(c => c.city === cityData.city && c.state === cityData.state);
        if (!existingCity) {
          try {
            await createCity({ city: cityData.city, state: cityData.state });
          } catch (err) {
            console.log(`City ${cityData.city}, ${cityData.state} may already exist`);
          }
        }
      }
      
      // Refresh cities list
      const updatedCities = await getCities();
      setCities(updatedCities);
      
      // Get city IDs for selected cities
      const cityIds = selectedSyncCities
        .map(sc => updatedCities.find(c => c.city === sc.city && c.state === sc.state)?.id)
        .filter((id): id is number => id !== undefined);
      
      if (cityIds.length > 0) {
        await syncAirbticsData(cityIds, true);
        
        // Poll for status updates
        const checkStatus = async () => {
          const status = await getAirbticsSyncStatus();
          setAirbticsSyncStatus(status);
          if (status.status === 'syncing') {
            setTimeout(checkStatus, 3000);
          } else {
            setSyncingAll(false);
            const cityStatuses = await getAirbticsCityStatuses();
            setAirbticsCityStatuses(cityStatuses);
            onDataSaved?.();
          }
        };
        checkStatus();
      } else {
        setSyncingAll(false);
      }
    } catch (error) {
      console.error('Failed to sync selected cities:', error);
      setSyncingAll(false);
    }
  };

  // Get current city's Airbtics status
  const currentCityStatus = airbticsCityStatuses.find(
    cs => cs.city === selectedCity && cs.state === selectedState
  );

  const handleCitySelect = (value: string) => {
    const [city, state] = value.split('|');
    setSelectedCity(city);
    setSelectedState(state);
    setZipCode('');
  };

  // Cycle through: undefined (ANY) -> true (WITH) -> false (WITHOUT) -> undefined (ANY)
  const handleAmenityToggle = (key: string) => {
    setSelectedAmenities(prev => {
      const current = prev[key];
      let next: AmenityState;
      if (current === undefined) next = true;      // ANY -> WITH
      else if (current === true) next = false;      // WITH -> WITHOUT
      else next = undefined;                        // WITHOUT -> ANY
      
      const newState = { ...prev };
      if (next === undefined) {
        delete newState[key];
      } else {
        newState[key] = next;
      }
      return newState;
    });
  };

  const clearAmenities = () => {
    setSelectedAmenities({});
  };

  // Count amenities that have a specific state (WITH or WITHOUT)
  const selectedAmenityCount = Object.keys(selectedAmenities).length;

  const handleSave = async () => {
    if (!selectedCity || !selectedState) return;
    if (!revenue || parseInt(revenue) <= 0) {
      alert('Please enter a revenue value');
      return;
    }

    setSaving(true);
    try {
      // Build amenities object with tri-state values
      // true = WITH (required), false = WITHOUT (excluded)
      const amenities: Record<string, boolean> = {};
      AMENITY_OPTIONS.forEach(opt => {
        const state = selectedAmenities[opt.key];
        if (state !== undefined) {
          amenities[opt.key] = state; // true for WITH, false for WITHOUT
        }
      });

      // Convert monthly to annual if needed (backend always stores annual)
      const annualRevenue = revenueType === 'monthly' 
        ? parseInt(revenue) * 12 
        : parseInt(revenue);

      await saveAirDNAData({
        city: selectedCity,
        state: selectedState,
        zipCode: zipCode || undefined,
        bedroomsMin,
        bedroomsMax,
        averageAnnualRevenue: annualRevenue,
        amenities: Object.keys(amenities).length > 0 ? amenities : undefined
      });
      
      // Refresh data
      const newData = await getAirDNAData(selectedCity, selectedState);
      setExistingData(newData);
      
      // Reset form
      setRevenue('');
      setSelectedAmenities({});
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to save AirDNA data:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (id: number) => {
    // First click - show confirm button
    if (pendingDeleteId === id) {
      // Already showing confirm, do nothing (user must click confirm)
      return;
    }
    setPendingDeleteId(id);
    // Auto-cancel after 5 seconds if not confirmed
    setTimeout(() => {
      setPendingDeleteId(prev => prev === id ? null : prev);
    }, 5000);
  };

  const handleDeleteConfirm = async (id: number) => {
    try {
      await deleteAirDNAData(id);
      const newData = await getAirDNAData(selectedCity, selectedState);
      setExistingData(newData);
      setPendingDeleteId(null);
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to delete:', error);
      setPendingDeleteId(null);
    }
  };

  const handleDeleteCancel = () => {
    setPendingDeleteId(null);
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all AirDNA entries for this city?')) return;
    
    try {
      for (const entry of existingData) {
        await deleteAirDNAData(entry.id);
      }
      setExistingData([]);
      onDataSaved?.();
    } catch (error) {
      console.error('Failed to clear AirDNA data:', error);
    }
  };

  // AI Screenshot handlers
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      // Reset conversation when new image is selected
      setAiConversationId(null);
      setAiMessages([]);
    }
  };

  const handleAnalyzeScreenshot = async () => {
    if (!selectedImage) return;
    
    setAiLoading(true);
    try {
      const response = await analyzeScreenshot(selectedImage, aiContext, aiConversationId || undefined);
      setAiConversationId(response.conversation_id);
      
      // Add messages to chat
      if (aiContext) {
        setAiMessages(prev => [...prev, { role: 'user', content: aiContext }]);
      } else {
        setAiMessages(prev => [...prev, { role: 'user', content: '[Uploaded screenshot for analysis]' }]);
      }
      setAiMessages(prev => [...prev, { role: 'assistant', content: response.message }]);
      setAiContext('');
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || 'Failed to analyze screenshot';
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMsg}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSendFollowUp = async () => {
    if (!aiFollowUp.trim() || !aiConversationId) return;
    
    const message = aiFollowUp.trim();
    setAiFollowUp('');
    setAiMessages(prev => [...prev, { role: 'user', content: message }]);
    setAiLoading(true);
    
    try {
      const response = await continueAIConversation(aiConversationId, message);
      setAiMessages(prev => [...prev, { role: 'assistant', content: response.message }]);
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || 'Failed to continue conversation';
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMsg}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const resetAIAnalysis = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setAiContext('');
    setAiConversationId(null);
    setAiMessages([]);
    setAiFollowUp('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const loadSavedAnalyses = async () => {
    setLoadingSaved(true);
    try {
      const analyses = await getSavedAIAnalyses(20);
      setSavedAnalyses(analyses);
    } catch (error) {
      console.error('Failed to load saved analyses:', error);
    } finally {
      setLoadingSaved(false);
    }
  };

  const toggleSavedAnalyses = () => {
    if (!showSavedAnalyses && savedAnalyses.length === 0) {
      loadSavedAnalyses();
    }
    setShowSavedAnalyses(!showSavedAnalyses);
  };

  const viewAnalysisImage = async (analysisId: number) => {
    if (expandedAnalysis === analysisId) {
      setExpandedAnalysis(null);
      setAnalysisImage(null);
      return;
    }
    
    try {
      const detail = await getAIAnalysisDetail(analysisId);
      setAnalysisImage(`data:${detail.image_type};base64,${detail.image_data}`);
      setExpandedAnalysis(analysisId);
    } catch (error) {
      console.error('Failed to load analysis image:', error);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    
    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffMonths === 1) return '1 month ago';
    if (diffMonths < 12) return `${diffMonths} months ago`;
    return `${Math.floor(diffMonths / 12)} year(s) ago`;
  };

  const getAmenityBadges = (data: AirDNAData) => {
    const badges: { label: string; icon: string; state: 'with' | 'without' }[] = [];
    
    // Check each amenity - now they can be true (WITH) or false (WITHOUT)
    const amenityMap: Record<string, { label: string; icon: string }> = {
      has_pool: { label: 'Pool', icon: '🏊' },
      has_hot_tub: { label: 'Hot Tub', icon: '🛁' },
      has_waterfront: { label: 'Waterfront', icon: '🌊' },
      has_basement: { label: 'Basement', icon: '⬇️' },
      has_garage: { label: 'Garage', icon: '🚗' },
      has_yard: { label: 'Yard', icon: '🌳' },
      has_pet_friendly: { label: 'Pet Friendly', icon: '🐕' },
      has_mother_in_law: { label: 'In-Law', icon: '🏘️' },
    };

    for (const [key, info] of Object.entries(amenityMap)) {
      const value = (data as any)[key];
      if (value === true) {
        badges.push({ ...info, state: 'with' });
      } else if (value === false) {
        badges.push({ ...info, state: 'without' });
      }
    }
    
    return badges;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-green-600" />
          Short-Term Rental Revenue Data
        </h2>
        <div className="flex items-center gap-2">
          {existingData.length > 0 && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              {existingData.length} entries
            </span>
          )}
        </div>
      </div>

      {/* Airbtics Auto-Sync Section */}
      <div className="mb-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Airbtics API (Auto-Sync)
          </h3>
          <button
            onClick={handleSyncAllCities}
            disabled={syncingAll || airbticsSyncStatus?.status === 'syncing'}
            className="btn btn-sm bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1"
          >
            {syncingAll || airbticsSyncStatus?.status === 'syncing' ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3" />
                Sync All Cities
              </>
            )}
          </button>
        </div>
        
        <p className="text-xs text-blue-600 mb-2">
          Revenue data is automatically fetched from Airbtics API for all bedroom counts (1-8) and refreshed every 6 months.
        </p>
        
        {/* City Selector Toggle */}
        <button
          onClick={() => setShowCitySelector(!showCitySelector)}
          className="text-xs text-blue-700 hover:text-blue-900 underline mb-2"
        >
          {showCitySelector ? 'Hide' : 'Add specific cities to sync'}
        </button>
        
        {/* City Selector Panel */}
        {showCitySelector && (
          <div className="bg-white rounded-lg p-3 mb-3 border border-blue-200">
            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <CityAutocomplete
                  value={syncCityInput}
                  onChange={(city, state) => {
                    setSyncCityInput(city);
                    if (state) setSyncStateInput(state);
                  }}
                  placeholder="Type city name..."
                />
              </div>
              <select
                value={syncStateInput}
                onChange={(e) => setSyncStateInput(e.target.value)}
                className="input w-20 text-sm"
              >
                <option value="">State</option>
                {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={handleAddSyncCity}
                disabled={!syncCityInput || !syncStateInput}
                className="btn btn-sm bg-blue-500 hover:bg-blue-600 text-white px-2"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            
            {/* Selected Cities List */}
            {selectedSyncCities.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedSyncCities.map((city, idx) => (
                  <span 
                    key={idx} 
                    className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
                  >
                    {city.city}, {city.state}
                    <button 
                      onClick={() => handleRemoveSyncCity(idx)}
                      className="hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            
            {selectedSyncCities.length > 0 && (
              <button
                onClick={handleSyncSelectedCities}
                disabled={syncingAll || airbticsSyncStatus?.status === 'syncing'}
                className="btn btn-sm bg-green-600 hover:bg-green-700 text-white text-xs w-full justify-center"
              >
                {syncingAll ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Syncing {selectedSyncCities.length} cities...
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Sync {selectedSyncCities.length} Selected Cities
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Sync Status */}
        {airbticsSyncStatus && airbticsSyncStatus.status === 'syncing' && (
          <div className="bg-white rounded p-2 mb-3 border border-blue-100">
            <div className="flex items-center gap-2 text-xs text-blue-700">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{airbticsSyncStatus.message}</span>
            </div>
            <div className="mt-1 h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ 
                  width: `${airbticsSyncStatus.total_cities > 0 
                    ? (airbticsSyncStatus.synced_cities / airbticsSyncStatus.total_cities) * 100 
                    : 0}%` 
                }}
              />
            </div>
            <div className="mt-1 text-xs text-blue-500">
              {airbticsSyncStatus.synced_cities} / {airbticsSyncStatus.total_cities} cities
            </div>
          </div>
        )}

        {airbticsSyncStatus && airbticsSyncStatus.status === 'completed' && airbticsSyncStatus.last_sync && (
          <div className="text-xs text-blue-600">
            Last sync: {formatTimeAgo(airbticsSyncStatus.last_sync)}
            {airbticsSyncStatus.failed_cities > 0 && (
              <span className="text-orange-500 ml-2">
                ({airbticsSyncStatus.failed_cities} cities failed)
              </span>
            )}
          </div>
        )}

        {/* Current City Status */}
        {currentCityStatus && (
          <div className="mt-2 flex items-center justify-between bg-white rounded p-2 border border-blue-100">
            <div className="text-xs">
              <span className="text-gray-600">{currentCityStatus.city}, {currentCityStatus.state}:</span>
              {currentCityStatus.has_airbtics_data ? (
                <span className="ml-2 text-green-600">
                  {currentCityStatus.entries_count} entries
                  {currentCityStatus.last_fetch && (
                    <span className="text-gray-400 ml-1">
                      (fetched {formatTimeAgo(currentCityStatus.last_fetch)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="ml-2 text-orange-500">No data yet</span>
              )}
            </div>
            {cities.find(c => c.city === selectedCity && c.state === selectedState) && (
              <button
                onClick={() => {
                  const city = cities.find(c => c.city === selectedCity && c.state === selectedState);
                  if (city) handleSyncCity(city.id);
                }}
                disabled={syncingCity !== null}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                {syncingCity ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refresh
              </button>
            )}
          </div>
        )}
      </div>

      {/* Data Source Options */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setShowAIAnalysis(!showAIAnalysis)}
          className={`btn justify-center text-sm ${showAIAnalysis ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Camera className="h-4 w-4" />
          Screenshot AI
        </button>
        <button
          onClick={() => setShowAIAnalysis(false)}
          className={`btn justify-center text-sm ${!showAIAnalysis ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Database className="h-4 w-4" />
          Manual Entry
        </button>
      </div>

      {/* AI Screenshot Analysis Panel */}
      {showAIAnalysis && (
        <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
          <h3 className="text-sm font-semibold text-purple-800 mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            AI Screenshot Analysis
          </h3>
          
          <p className="text-xs text-purple-600 mb-3">
            Upload an AirDNA screenshot and AI will extract revenue data. You can ask follow-up questions for clarification.
          </p>

          {/* Image Upload Area */}
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
              id="screenshot-upload"
            />
            
            {!imagePreview ? (
              <label
                htmlFor="screenshot-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-purple-300 rounded-lg cursor-pointer bg-white hover:bg-purple-50 transition-colors"
              >
                <Upload className="h-8 w-8 text-purple-400 mb-2" />
                <span className="text-sm text-purple-600">Click to upload screenshot</span>
                <span className="text-xs text-purple-400">PNG, JPG, or WebP</span>
              </label>
            ) : (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Screenshot preview"
                  className="w-full max-h-48 object-contain rounded-lg border border-purple-200"
                />
                <button
                  onClick={resetAIAnalysis}
                  className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600"
                  title="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Context Input (before first analysis) */}
          {imagePreview && aiMessages.length === 0 && (
            <div className="mb-4">
              <label className="input-label">Add context (optional)</label>
              <textarea
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                placeholder="e.g., This is for 4-bedroom properties in Austin, TX with a pool..."
                className="input min-h-[60px] text-sm"
                rows={2}
              />
              <button
                onClick={handleAnalyzeScreenshot}
                disabled={aiLoading}
                className="btn-primary mt-2 w-full justify-center"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" />
                    Analyze Screenshot
                  </>
                )}
              </button>
            </div>
          )}

          {/* Chat Messages */}
          {aiMessages.length > 0 && (
            <div className="mb-4 max-h-64 overflow-y-auto space-y-3 bg-white rounded-lg p-3 border border-purple-100">
              {aiMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Follow-up Input */}
          {aiMessages.length > 0 && (
            <div className="flex gap-2">
              <input
                type="text"
                value={aiFollowUp}
                onChange={(e) => setAiFollowUp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendFollowUp()}
                placeholder="Ask a follow-up question..."
                className="input flex-1 text-sm"
                disabled={aiLoading}
              />
              <button
                onClick={handleSendFollowUp}
                disabled={aiLoading || !aiFollowUp.trim()}
                className="btn-primary px-3"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Note about API key */}
          <p className="text-xs text-purple-500 mt-3">
            Requires OPENAI_API_KEY environment variable on the backend.
          </p>

          {/* Saved Analyses Toggle */}
          <div className="mt-4 pt-4 border-t border-purple-200">
            <button
              onClick={toggleSavedAnalyses}
              className="flex items-center gap-2 text-sm text-purple-700 hover:text-purple-900"
            >
              <History className="h-4 w-4" />
              View Saved Analyses
              {showSavedAnalyses ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Saved Analyses List */}
          {showSavedAnalyses && (
            <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
              {loadingSaved ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
                </div>
              ) : savedAnalyses.length === 0 ? (
                <p className="text-xs text-purple-500 text-center py-4">No saved analyses yet</p>
              ) : (
                savedAnalyses.map((analysis) => (
                  <div key={analysis.id} className="bg-white rounded-lg border border-purple-100 p-3">
                    <div 
                      className="flex items-start justify-between cursor-pointer"
                      onClick={() => viewAnalysisImage(analysis.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500">{formatTimeAgo(analysis.created_at)}</span>
                          {analysis.extracted_city && analysis.extracted_state && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                              {analysis.extracted_city}, {analysis.extracted_state}
                            </span>
                          )}
                          {analysis.extracted_bedrooms && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              {analysis.extracted_bedrooms} BR
                            </span>
                          )}
                        </div>
                        {(analysis.extracted_annual_revenue || analysis.extracted_monthly_revenue) && (
                          <div className="text-sm font-medium text-green-600">
                            {analysis.extracted_annual_revenue 
                              ? `$${analysis.extracted_annual_revenue.toLocaleString()}/year`
                              : analysis.extracted_monthly_revenue 
                                ? `$${analysis.extracted_monthly_revenue.toLocaleString()}/month`
                                : ''
                            }
                          </div>
                        )}
                        {analysis.user_context && (
                          <p className="text-xs text-gray-500 truncate mt-1">
                            Context: {analysis.user_context}
                          </p>
                        )}
                      </div>
                      <div className="ml-2">
                        {expandedAnalysis === analysis.id ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    </div>
                    
                    {expandedAnalysis === analysis.id && (
                      <div className="mt-3 pt-3 border-t border-purple-100">
                        {analysisImage && (
                          <img 
                            src={analysisImage} 
                            alt="Analysis screenshot" 
                            className="w-full max-h-32 object-contain rounded mb-2"
                          />
                        )}
                        <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {analysis.ai_response.split('---EXTRACTED_DATA---')[0].trim()}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* City selector with autocomplete */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="md:col-span-2">
          <label className="input-label">City *</label>
          <CityAutocomplete
            value={selectedCity}
            onChange={(city, state) => {
              setSelectedCity(city);
              setSelectedState(state);
              setZipCode('');
            }}
            placeholder="Type a city name..."
          />
          {selectedState && (
            <p className="text-xs text-gray-500 mt-1">
              Selected: {selectedCity}, {selectedState}
            </p>
          )}
        </div>

        <div>
          <label className="input-label">
            Zip Code <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            placeholder="e.g., 60601"
            className="input"
            maxLength={5}
            disabled={!selectedCity}
          />
        </div>
      </div>

      {selectedCity && selectedState && (
        <>
          {/* Add new entry form */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Revenue Entry
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
              {/* Bedroom Range */}
              <div>
                <label className="input-label">Bedrooms Min</label>
                <select
                  value={bedroomsMin}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setBedroomsMin(val);
                    if (bedroomsMax < val) setBedroomsMax(val);
                  }}
                  className="input"
                >
                  {BEDROOM_OPTIONS.map(br => (
                    <option key={br} value={br}>{br} BR</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="input-label">Bedrooms Max</label>
                <select
                  value={bedroomsMax}
                  onChange={(e) => setBedroomsMax(parseInt(e.target.value))}
                  className="input"
                >
                  {BEDROOM_OPTIONS.filter(br => br >= bedroomsMin).map(br => (
                    <option key={br} value={br}>{br} BR</option>
                  ))}
                </select>
              </div>

              {/* Revenue */}
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="input-label mb-0">Revenue *</label>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setRevenueType('monthly')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        revenueType === 'monthly'
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevenueType('annual')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        revenueType === 'annual'
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Annual
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="text"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder={revenueType === 'monthly' ? 'e.g., 5500' : 'e.g., 65000'}
                    className="input pl-7"
                  />
                </div>
                {revenue && parseInt(revenue) > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    {revenueType === 'monthly' ? (
                      <>
                        {formatCurrency(parseInt(revenue))}/mo = <strong>{formatCurrency(parseInt(revenue) * 12)}/yr</strong>
                      </>
                    ) : (
                      <>
                        {formatCurrency(parseInt(revenue))}/yr = {formatCurrency(parseInt(revenue) / 12)}/mo
                      </>
                    )}
                  </p>
                )}
              </div>

              {/* Amenities toggle */}
              <div className="flex items-end">
                <button
                  onClick={() => setShowAmenities(!showAmenities)}
                  className={`btn w-full ${showAmenities || selectedAmenityCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Amenities
                  {selectedAmenityCount > 0 && (
                    <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded text-xs">
                      {selectedAmenityCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Amenity selection - tri-state: WITH / WITHOUT / ANY */}
            {showAmenities && (
              <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium text-gray-600">
                      Click to cycle: <span className="text-gray-400">Any</span> → 
                      <span className="text-green-600 mx-1">WITH</span> → 
                      <span className="text-red-600">WITHOUT</span> → 
                      <span className="text-gray-400">Any</span>
                    </p>
                  </div>
                  {selectedAmenityCount > 0 && (
                    <button onClick={clearAmenities} className="text-xs text-gray-500 hover:text-gray-700">
                      Clear all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map(opt => {
                    const state = selectedAmenities[opt.key];
                    const isWithRequired = state === true;
                    const isWithoutRequired = state === false;
                    
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleAmenityToggle(opt.key)}
                        className={`
                          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                          transition-colors border
                          ${isWithRequired 
                            ? 'bg-green-100 border-green-400 text-green-800' 
                            : isWithoutRequired
                            ? 'bg-red-100 border-red-400 text-red-800'
                            : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
                          }
                        `}
                        title={isWithRequired ? 'WITH (must have)' : isWithoutRequired ? 'WITHOUT (must NOT have)' : 'Any (no filter)'}
                      >
                        {isWithRequired && <Check className="h-3 w-3" />}
                        {isWithoutRequired && <X className="h-3 w-3" />}
                        {!isWithRequired && !isWithoutRequired && <Minus className="h-3 w-3" />}
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-xs">
                  <span className="flex items-center gap-1 text-green-700">
                    <Check className="h-3 w-3" /> = WITH (must have)
                  </span>
                  <span className="flex items-center gap-1 text-red-700">
                    <X className="h-3 w-3" /> = WITHOUT (must NOT have)
                  </span>
                  <span className="flex items-center gap-1 text-gray-500">
                    <Minus className="h-3 w-3" /> = Any (no filter)
                  </span>
                </div>
              </div>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || !revenue || parseInt(revenue) <= 0}
              className="btn-primary"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Entry
                </>
              )}
            </button>
          </div>

          {/* Existing entries */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : existingData.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Existing Entries ({existingData.length})
              </h3>
              <div className="space-y-2">
                {existingData.map(entry => {
                  const badges = getAmenityBadges(entry);
                  const isAirbtics = entry.source === 'airbtics';
                  const isScreenshot = entry.source === 'screenshot';
                  return (
                    <div 
                      key={entry.id} 
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isAirbtics 
                          ? 'bg-blue-50 border-blue-200' 
                          : isScreenshot
                            ? 'bg-purple-50 border-purple-200'
                            : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          {/* Source badge */}
                          {isAirbtics ? (
                            <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Cloud className="h-3 w-3" />
                              API
                            </span>
                          ) : isScreenshot ? (
                            <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Camera className="h-3 w-3" />
                              AI
                            </span>
                          ) : (
                            <span className="text-xs bg-gray-500 text-white px-1.5 py-0.5 rounded">
                              Manual
                            </span>
                          )}
                          <span className="font-medium text-gray-900">
                            {entry.bedrooms_min === entry.bedrooms_max 
                              ? `${entry.bedrooms_min} BR` 
                              : `${entry.bedrooms_min}-${entry.bedrooms_max} BR`
                            }
                          </span>
                          {entry.zip_code && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              {entry.zip_code}
                            </span>
                          )}
                        </div>
                        <div className="text-green-600 font-semibold">
                          {formatCurrency(entry.average_annual_revenue)}/yr
                          <span className="text-gray-500 font-normal text-sm ml-1">
                            ({formatCurrency(entry.average_annual_revenue / 12)}/mo)
                          </span>
                        </div>
                        {/* Show percentiles for Airbtics data */}
                        {isAirbtics && entry.revenue_p25 && (
                          <div className="text-xs text-gray-500">
                            <span title="25th percentile">p25: {formatCurrency(entry.revenue_p25)}</span>
                            <span className="mx-1">|</span>
                            <span title="75th percentile">p75: {formatCurrency(entry.revenue_p75 || 0)}</span>
                            <span className="mx-1">|</span>
                            <span title="90th percentile">p90: {formatCurrency(entry.revenue_p90 || 0)}</span>
                          </div>
                        )}
                        {badges.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {badges.map((badge, i) => (
                              <span 
                                key={i} 
                                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                                  badge.state === 'with' 
                                    ? 'bg-green-50 text-green-700' 
                                    : 'bg-red-50 text-red-700'
                                }`}
                                title={`${badge.state === 'with' ? 'WITH' : 'WITHOUT'} ${badge.label}`}
                              >
                                {badge.state === 'with' ? '✓' : '✗'}
                                {badge.icon}
                              </span>
                            ))}
                          </div>
                        )}
                        {badges.length === 0 && (
                          <span className="text-xs text-gray-400">No amenity filter</span>
                        )}
                      </div>
                      
                      {/* Two-step delete confirmation */}
                      {pendingDeleteId === entry.id ? (
                        <div className="flex items-center gap-2 animate-pulse">
                          <span className="text-xs text-red-600 font-medium">Delete?</span>
                          <button
                            onClick={() => handleDeleteConfirm(entry.id)}
                            className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={handleDeleteCancel}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs px-2 py-1 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(entry.id)}
                          className="text-gray-400 hover:text-red-500 p-1 transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 text-sm">
              No AirDNA data entries yet. Add one above to get started.
            </div>
          )}
        </>
      )}

      {cities.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No cities available. Add a city first to enter AirDNA data.
        </div>
      )}
    </div>
  );
}
