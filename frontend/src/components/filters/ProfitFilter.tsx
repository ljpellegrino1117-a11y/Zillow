'use client';

import { useState, useEffect } from 'react';
import { DollarSign, X } from 'lucide-react';

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

export default function ProfitFilter({ isOpen, onClose, filters, onApply }: ProfitFilterProps) {
  const [localFilters, setLocalFilters] = useState<ProfitFilters>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters, isOpen]);

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50">
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
      <div className="p-4 space-y-4">
        {/* Min Annual Profit */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Min Annual Profit</label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 0, label: 'Any' },
              { value: 10000, label: '$10k+' },
              { value: 20000, label: '$20k+' },
              { value: 50000, label: '$50k+' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLocalFilters(prev => ({ ...prev, minProfit: value }))}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  localFilters.minProfit === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Monthly Rent Budget */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Monthly Rent Budget</label>
          <div className="flex items-center gap-2">
            <select
              value={localFilters.minRent}
              onChange={(e) => setLocalFilters(prev => ({ ...prev, minRent: Number(e.target.value) }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={0}>$0</option>
              <option value={1000}>$1,000</option>
              <option value={2000}>$2,000</option>
              <option value={3000}>$3,000</option>
              <option value={5000}>$5,000</option>
            </select>
            <span className="text-gray-400">to</span>
            <select
              value={localFilters.maxRent}
              onChange={(e) => setLocalFilters(prev => ({ ...prev, maxRent: Number(e.target.value) }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={3000}>$3,000</option>
              <option value={5000}>$5,000</option>
              <option value={7500}>$7,500</option>
              <option value={10000}>$10,000</option>
              <option value={50000}>No limit</option>
            </select>
          </div>
        </div>

        {/* Min ROI Score */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Min ROI Score</label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 0, label: 'Any' },
              { value: 50, label: '50+' },
              { value: 60, label: '60+' },
              { value: 75, label: '75+' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLocalFilters(prev => ({ ...prev, minROI: value }))}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  localFilters.minROI === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Max Break-even Occupancy */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Max Break-even Occupancy</label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 100, label: 'Any' },
              { value: 70, label: '70%' },
              { value: 60, label: '60%' },
              { value: 50, label: '50%' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLocalFilters(prev => ({ ...prev, maxBreakEven: value }))}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  localFilters.maxBreakEven === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
