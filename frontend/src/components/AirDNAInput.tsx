'use client';

import { useState, useEffect } from 'react';
import { Save, DollarSign, Loader2, Check } from 'lucide-react';
import { getZipCodes, getAirDNAData, saveAirDNAData, ZipCode, AirDNAData } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface Props {
  onDataSaved?: () => void;
}

const BEDROOM_COUNTS = [3, 4, 5, 6, 7, 8];

export default function AirDNAInput({ onDataSaved }: Props) {
  const [zipCodes, setZipCodes] = useState<ZipCode[]>([]);
  const [selectedZipCode, setSelectedZipCode] = useState<string>('');
  const [revenues, setRevenues] = useState<Record<number, string>>({});
  const [existingData, setExistingData] = useState<AirDNAData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchZipCodes = async () => {
      try {
        const data = await getZipCodes();
        setZipCodes(data);
        if (data.length > 0 && !selectedZipCode) {
          setSelectedZipCode(data[0].zip_code);
        }
      } catch (error) {
        console.error('Failed to fetch zip codes:', error);
      }
    };
    fetchZipCodes();
  }, [selectedZipCode]);

  useEffect(() => {
    const fetchAirDNAData = async () => {
      if (!selectedZipCode) return;
      
      setLoading(true);
      try {
        const data = await getAirDNAData(selectedZipCode);
        setExistingData(data);
        
        // Pre-fill form with existing data
        const revenueMap: Record<number, string> = {};
        data.forEach(d => {
          revenueMap[d.bedrooms] = d.average_annual_revenue.toString();
        });
        setRevenues(revenueMap);
      } catch (error) {
        console.error('Failed to fetch AirDNA data:', error);
        setRevenues({});
      } finally {
        setLoading(false);
      }
    };
    fetchAirDNAData();
  }, [selectedZipCode]);

  const handleRevenueChange = (bedrooms: number, value: string) => {
    // Allow only numbers and empty string
    const cleaned = value.replace(/[^\d]/g, '');
    setRevenues(prev => ({ ...prev, [bedrooms]: cleaned }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedZipCode) return;

    const data = BEDROOM_COUNTS
      .filter(br => revenues[br] && parseInt(revenues[br]) > 0)
      .map(br => ({
        bedrooms: br,
        average_annual_revenue: parseInt(revenues[br]),
      }));

    if (data.length === 0) {
      alert('Please enter at least one revenue value');
      return;
    }

    setSaving(true);
    try {
      await saveAirDNAData(selectedZipCode, data);
      setSaved(true);
      onDataSaved?.();
      
      // Refresh existing data
      const newData = await getAirDNAData(selectedZipCode);
      setExistingData(newData);
    } catch (error) {
      console.error('Failed to save AirDNA data:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getExistingValue = (bedrooms: number): number | null => {
    const existing = existingData.find(d => d.bedrooms === bedrooms);
    return existing ? existing.average_annual_revenue : null;
  };

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-green-600" />
        AirDNA Revenue Data
      </h2>

      <p className="text-sm text-gray-600 mb-4">
        Enter the average annual revenue from AirDNA for each bedroom count in the selected zip code.
        This data will be used to calculate arbitrage opportunities.
      </p>

      {/* Zip code selector */}
      <div className="mb-6">
        <label className="input-label">Select Zip Code</label>
        <select
          value={selectedZipCode}
          onChange={(e) => setSelectedZipCode(e.target.value)}
          className="input"
        >
          <option value="">Select a zip code...</option>
          {zipCodes.map(zip => (
            <option key={zip.id} value={zip.zip_code}>
              {zip.zip_code} {zip.city && zip.state ? `- ${zip.city}, ${zip.state}` : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedZipCode && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Revenue inputs */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                {BEDROOM_COUNTS.map(bedrooms => {
                  const existingValue = getExistingValue(bedrooms);
                  return (
                    <div key={bedrooms}>
                      <label className="input-label">
                        {bedrooms} Bedroom{bedrooms > 1 ? 's' : ''}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input
                          type="text"
                          value={revenues[bedrooms] || ''}
                          onChange={(e) => handleRevenueChange(bedrooms, e.target.value)}
                          placeholder="Annual"
                          className="input pl-7"
                        />
                      </div>
                      {existingValue !== null && !revenues[bedrooms] && (
                        <p className="text-xs text-gray-500 mt-1">
                          Current: {formatCurrency(existingValue)}
                        </p>
                      )}
                      {revenues[bedrooms] && parseInt(revenues[bedrooms]) > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          Monthly: {formatCurrency(parseInt(revenues[bedrooms]) / 12)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save button */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleSave}
                  disabled={saving || !Object.values(revenues).some(v => v && parseInt(v) > 0)}
                  className="btn-primary"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : saved ? (
                    <>
                      <Check className="h-4 w-4" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save AirDNA Data
                    </>
                  )}
                </button>
                
                {existingData.length > 0 && (
                  <span className="text-sm text-gray-500">
                    {existingData.length} bedroom count{existingData.length > 1 ? 's' : ''} saved
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}

      {zipCodes.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No zip codes available. Add a zip code first to enter AirDNA data.
        </div>
      )}
    </div>
  );
}
