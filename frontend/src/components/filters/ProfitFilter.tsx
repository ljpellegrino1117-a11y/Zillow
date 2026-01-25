'use client';

import { useState, useEffect } from 'react';
import { DollarSign, X, Pencil } from 'lucide-react';

export interface ProfitFilters {
  minProfit: number;
  minRent: number;
  maxRent: number;
  minROI: number;
  maxBreakEven: number;
}

interface ProfitFilterProps {
  isOpen: boolean;
  onClose: () => void;
  filters: ProfitFilters;
  onApply: (filters: ProfitFilters) => void;
}

// Preset values for each filter
// -999999 means "show all including negative profit"
const PROFIT_PRESETS = [-999999, 0, 10000, 20000, 50000];
const ROI_PRESETS = [0, 50, 60, 75];
const BREAKEVEN_PRESETS = [100, 70, 60, 50];
const RENT_MIN_PRESETS = [0, 1000, 2000, 3000, 5000];
const RENT_MAX_PRESETS = [3000, 5000, 7500, 10000, 50000];

// Helper to check if a value is a preset
const isPreset = (value: number, presets: number[]) => presets.includes(value);

// Format currency for display
const formatCurrency = (value: number) => {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `$${value}`;
};

export default function ProfitFilter({ isOpen, onClose, filters, onApply }: ProfitFilterProps) {
  const [localFilters, setLocalFilters] = useState<ProfitFilters>(filters);
  
  // Track custom mode for each filter
  const [customProfit, setCustomProfit] = useState(false);
  const [customRent, setCustomRent] = useState(false);
  const [customROI, setCustomROI] = useState(false);
  const [customBreakEven, setCustomBreakEven] = useState(false);
  
  // Custom input values (as strings for better input handling)
  const [customProfitValue, setCustomProfitValue] = useState('');
  const [customMinRentValue, setCustomMinRentValue] = useState('');
  const [customMaxRentValue, setCustomMaxRentValue] = useState('');
  const [customROIValue, setCustomROIValue] = useState('');
  const [customBreakEvenValue, setCustomBreakEvenValue] = useState('');

  useEffect(() => {
    setLocalFilters(filters);
    
    // Determine if current values are custom (not in presets)
    const isProfitCustom = !isPreset(filters.minProfit, PROFIT_PRESETS);
    const isRentCustom = !isPreset(filters.minRent, RENT_MIN_PRESETS) || !isPreset(filters.maxRent, RENT_MAX_PRESETS);
    const isROICustom = !isPreset(filters.minROI, ROI_PRESETS);
    const isBreakEvenCustom = !isPreset(filters.maxBreakEven, BREAKEVEN_PRESETS);
    
    setCustomProfit(isProfitCustom);
    setCustomRent(isRentCustom);
    setCustomROI(isROICustom);
    setCustomBreakEven(isBreakEvenCustom);
    
    // Set custom values if they're custom
    if (isProfitCustom) setCustomProfitValue(filters.minProfit.toString());
    if (isRentCustom) {
      setCustomMinRentValue(filters.minRent.toString());
      setCustomMaxRentValue(filters.maxRent.toString());
    }
    if (isROICustom) setCustomROIValue(filters.minROI.toString());
    if (isBreakEvenCustom) setCustomBreakEvenValue(filters.maxBreakEven.toString());
  }, [filters, isOpen]);

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  // Handle preset selection for min profit
  const handleProfitPreset = (value: number) => {
    setCustomProfit(false);
    setLocalFilters(prev => ({ ...prev, minProfit: value }));
  };

  // Handle custom profit input
  const handleCustomProfitChange = (value: string) => {
    setCustomProfitValue(value);
    const numValue = parseInt(value) || 0;
    setLocalFilters(prev => ({ ...prev, minProfit: Math.max(0, numValue) }));
  };

  // Handle preset selection for rent
  const handleRentPreset = (min: number, max: number) => {
    setCustomRent(false);
    setLocalFilters(prev => ({ ...prev, minRent: min, maxRent: max }));
  };

  // Handle custom rent inputs
  const handleCustomMinRentChange = (value: string) => {
    setCustomMinRentValue(value);
    const numValue = parseInt(value) || 0;
    setLocalFilters(prev => ({ ...prev, minRent: Math.max(0, numValue) }));
  };

  const handleCustomMaxRentChange = (value: string) => {
    setCustomMaxRentValue(value);
    const numValue = parseInt(value) || 0;
    setLocalFilters(prev => ({ ...prev, maxRent: Math.max(0, numValue) }));
  };

  // Handle preset selection for ROI
  const handleROIPreset = (value: number) => {
    setCustomROI(false);
    setLocalFilters(prev => ({ ...prev, minROI: value }));
  };

  // Handle custom ROI input
  const handleCustomROIChange = (value: string) => {
    setCustomROIValue(value);
    const numValue = parseInt(value) || 0;
    setLocalFilters(prev => ({ ...prev, minROI: Math.min(100, Math.max(0, numValue)) }));
  };

  // Handle preset selection for break-even
  const handleBreakEvenPreset = (value: number) => {
    setCustomBreakEven(false);
    setLocalFilters(prev => ({ ...prev, maxBreakEven: value }));
  };

  // Handle custom break-even input
  const handleCustomBreakEvenChange = (value: string) => {
    setCustomBreakEvenValue(value);
    const numValue = parseInt(value) || 0;
    setLocalFilters(prev => ({ ...prev, maxBreakEven: Math.min(100, Math.max(0, numValue)) }));
  };

  if (!isOpen) return null;

  // Common button styles
  const presetBtnClass = (isActive: boolean) =>
    `px-3 py-1.5 text-sm rounded-lg transition-colors ${
      isActive
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`;

  const customBtnClass = (isActive: boolean) =>
    `px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1 ${
      isActive
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`;

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-gray-900">Profit Constraints</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-5">
        {/* Min Annual Profit */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Min Annual Profit</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleProfitPreset(-999999)}
              className={presetBtnClass(!customProfit && localFilters.minProfit === -999999)}
              title="Show all opportunities including negative profit"
            >
              All
            </button>
            <button
              onClick={() => handleProfitPreset(0)}
              className={presetBtnClass(!customProfit && localFilters.minProfit === 0)}
              title="Only show profitable opportunities"
            >
              $0+
            </button>
            <button
              onClick={() => handleProfitPreset(10000)}
              className={presetBtnClass(!customProfit && localFilters.minProfit === 10000)}
            >
              $10k+
            </button>
            <button
              onClick={() => handleProfitPreset(20000)}
              className={presetBtnClass(!customProfit && localFilters.minProfit === 20000)}
            >
              $20k+
            </button>
            <button
              onClick={() => handleProfitPreset(50000)}
              className={presetBtnClass(!customProfit && localFilters.minProfit === 50000)}
            >
              $50k+
            </button>
            <button
              onClick={() => {
                setCustomProfit(true);
                setCustomProfitValue(localFilters.minProfit > 0 ? localFilters.minProfit.toString() : '');
              }}
              className={customBtnClass(customProfit)}
            >
              <Pencil className="w-3 h-3" />
              Custom
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            "All" includes break-even and negative profit opportunities
          </p>
          {customProfit && (
            <div className="mt-2 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                placeholder="Enter amount"
                value={customProfitValue}
                onChange={(e) => handleCustomProfitChange(e.target.value)}
                className={`${inputClass} pl-7`}
                min={0}
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Monthly Rent Budget */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Monthly Rent Budget</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleRentPreset(0, 50000)}
              className={presetBtnClass(!customRent && localFilters.minRent === 0 && localFilters.maxRent === 50000)}
            >
              Any
            </button>
            <button
              onClick={() => handleRentPreset(0, 3000)}
              className={presetBtnClass(!customRent && localFilters.minRent === 0 && localFilters.maxRent === 3000)}
            >
              Under $3k
            </button>
            <button
              onClick={() => handleRentPreset(3000, 5000)}
              className={presetBtnClass(!customRent && localFilters.minRent === 3000 && localFilters.maxRent === 5000)}
            >
              $3-5k
            </button>
            <button
              onClick={() => handleRentPreset(5000, 10000)}
              className={presetBtnClass(!customRent && localFilters.minRent === 5000 && localFilters.maxRent === 10000)}
            >
              $5-10k
            </button>
            <button
              onClick={() => {
                setCustomRent(true);
                setCustomMinRentValue(localFilters.minRent.toString());
                setCustomMaxRentValue(localFilters.maxRent.toString());
              }}
              className={customBtnClass(customRent)}
            >
              <Pencil className="w-3 h-3" />
              Custom
            </button>
          </div>
          {customRent && (
            <div className="mt-2 flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  placeholder="Min"
                  value={customMinRentValue}
                  onChange={(e) => handleCustomMinRentChange(e.target.value)}
                  className={`${inputClass} pl-7`}
                  min={0}
                />
              </div>
              <span className="text-gray-400 text-sm">to</span>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={customMaxRentValue}
                  onChange={(e) => handleCustomMaxRentChange(e.target.value)}
                  className={`${inputClass} pl-7`}
                  min={0}
                />
              </div>
            </div>
          )}
        </div>

        {/* Min ROI Score */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Min ROI Score</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleROIPreset(0)}
              className={presetBtnClass(!customROI && localFilters.minROI === 0)}
            >
              Any
            </button>
            <button
              onClick={() => handleROIPreset(50)}
              className={presetBtnClass(!customROI && localFilters.minROI === 50)}
            >
              50+
            </button>
            <button
              onClick={() => handleROIPreset(60)}
              className={presetBtnClass(!customROI && localFilters.minROI === 60)}
            >
              60+
            </button>
            <button
              onClick={() => handleROIPreset(75)}
              className={presetBtnClass(!customROI && localFilters.minROI === 75)}
            >
              75+
            </button>
            <button
              onClick={() => {
                setCustomROI(true);
                setCustomROIValue(localFilters.minROI > 0 ? localFilters.minROI.toString() : '');
              }}
              className={customBtnClass(customROI)}
            >
              <Pencil className="w-3 h-3" />
              Custom
            </button>
          </div>
          {customROI && (
            <div className="mt-2 relative">
              <input
                type="number"
                placeholder="Enter score (0-100)"
                value={customROIValue}
                onChange={(e) => handleCustomROIChange(e.target.value)}
                className={inputClass}
                min={0}
                max={100}
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">/100</span>
            </div>
          )}
        </div>

        {/* Max Break-even Occupancy */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Max Break-even Occupancy</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleBreakEvenPreset(100)}
              className={presetBtnClass(!customBreakEven && localFilters.maxBreakEven === 100)}
            >
              Any
            </button>
            <button
              onClick={() => handleBreakEvenPreset(70)}
              className={presetBtnClass(!customBreakEven && localFilters.maxBreakEven === 70)}
            >
              70%
            </button>
            <button
              onClick={() => handleBreakEvenPreset(60)}
              className={presetBtnClass(!customBreakEven && localFilters.maxBreakEven === 60)}
            >
              60%
            </button>
            <button
              onClick={() => handleBreakEvenPreset(50)}
              className={presetBtnClass(!customBreakEven && localFilters.maxBreakEven === 50)}
            >
              50%
            </button>
            <button
              onClick={() => {
                setCustomBreakEven(true);
                setCustomBreakEvenValue(localFilters.maxBreakEven < 100 ? localFilters.maxBreakEven.toString() : '');
              }}
              className={customBtnClass(customBreakEven)}
            >
              <Pencil className="w-3 h-3" />
              Custom
            </button>
          </div>
          {customBreakEven && (
            <div className="mt-2 relative">
              <input
                type="number"
                placeholder="Enter percentage (0-100)"
                value={customBreakEvenValue}
                onChange={(e) => handleCustomBreakEvenChange(e.target.value)}
                className={`${inputClass} pr-8`}
                min={0}
                max={100}
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
        <button
          onClick={handleApply}
          className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
