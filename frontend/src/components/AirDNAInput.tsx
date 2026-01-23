'use client';

import { useState, useEffect } from 'react';
import { Save, DollarSign, Loader2, Check, Plus, X } from 'lucide-react';
import { getCities, getAirDNAData, saveAirDNAData, getAirDNAZipCodes, City, AirDNAData } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface Props {
  onDataSaved?: () => void;
}

const BEDROOM_COUNTS = [3, 4, 5, 6, 7, 8];

export default function AirDNAInput({ onDataSaved }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [zipCode, setZipCode] = useState<string>('');
  const [existingZipCodes, setExistingZipCodes] = useState<(string | null)[]>([]);
  const [revenues, setRevenues] = useState<Record<number, string>>({});
  const [existingData, setExistingData] = useState<AirDNAData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fetch cities on mount
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
  }, [selectedCity]);

  // Fetch existing zip codes when city changes
  useEffect(() => {
    const fetchZipCodes = async () => {
      if (!selectedCity || !selectedState) return;
      
      try {
        const zips = await getAirDNAZipCodes(selectedCity, selectedState);
        setExistingZipCodes(zips);
      } catch (error) {
        console.error('Failed to fetch zip codes:', error);
        setExistingZipCodes([]);
      }
    };
    fetchZipCodes();
  }, [selectedCity, selectedState]);

  // Fetch AirDNA data when city or zip changes
  useEffect(() => {
    const fetchAirDNAData = async () => {
      if (!selectedCity || !selectedState) return;
      
      setLoading(true);
      try {
        const data = await getAirDNAData(selectedCity, selectedState, zipCode || undefined);
        setExistingData(data);
        
        // Pre-fill form with existing data
        const revenueMap: Record<number, string> = {};
        data.forEach(d => {
          // Only pre-fill if zip code matches (or both are empty for city-wide)
          const dataZip = d.zip_code || '';
          if (dataZip === zipCode) {
            revenueMap[d.bedrooms] = d.average_annual_revenue.toString();
          }
        });
        setRevenues(revenueMap);
      } catch (error) {
        console.error('Failed to fetch AirDNA data:', error);
        setRevenues({});
        setExistingData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAirDNAData();
  }, [selectedCity, selectedState, zipCode]);

  const handleCitySelect = (value: string) => {
    const [city, state] = value.split('|');
    setSelectedCity(city);
    setSelectedState(state);
    setZipCode(''); // Reset zip when city changes
    setSaved(false);
  };

  const handleZipSelect = (value: string) => {
    setZipCode(value);
    setSaved(false);
  };

  const handleRevenueChange = (bedrooms: number, value: string) => {
    const cleaned = value.replace(/[^\d]/g, '');
    setRevenues(prev => ({ ...prev, [bedrooms]: cleaned }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedCity || !selectedState) return;

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
      await saveAirDNAData(selectedCity, selectedState, data, zipCode || undefined);
      setSaved(true);
      onDataSaved?.();
      
      // Refresh existing data and zip codes
      const newData = await getAirDNAData(selectedCity, selectedState, zipCode || undefined);
      setExistingData(newData);
      
      const zips = await getAirDNAZipCodes(selectedCity, selectedState);
      setExistingZipCodes(zips);
    } catch (error) {
      console.error('Failed to save AirDNA data:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getExistingValue = (bedrooms: number): number | null => {
    const existing = existingData.find(d => {
      const dataZip = d.zip_code || '';
      return d.bedrooms === bedrooms && dataZip === zipCode;
    });
    return existing ? existing.average_annual_revenue : null;
  };

  // Check if we have city-wide data
  const hasCityWideData = existingZipCodes.includes(null);
  const zipCodesWithData = existingZipCodes.filter(z => z !== null) as string[];

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-green-600" />
        AirDNA Revenue Data
      </h2>

      <p className="text-sm text-gray-600 mb-4">
        Enter the average annual revenue from AirDNA. You can enter city-wide data or specify a zip code for more granular analysis.
      </p>

      {/* City selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="input-label">City *</label>
          <select
            value={selectedCity && selectedState ? `${selectedCity}|${selectedState}` : ''}
            onChange={(e) => handleCitySelect(e.target.value)}
            className="input"
          >
            <option value="">Select a city...</option>
            {cities.map(c => (
              <option key={c.id} value={`${c.city}|${c.state}`}>
                {c.city}, {c.state}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">
            Zip Code <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={zipCode}
              onChange={(e) => {
                setZipCode(e.target.value.replace(/[^\d]/g, '').slice(0, 5));
                setSaved(false);
              }}
              placeholder="e.g., 60601"
              className="input flex-1"
              maxLength={5}
              disabled={!selectedCity}
            />
            {zipCode && (
              <button
                onClick={() => setZipCode('')}
                className="btn-secondary px-3"
                title="Clear zip code (use city-wide)"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {zipCode ? `Data for zip code ${zipCode}` : 'City-wide average (no zip code)'}
          </p>
        </div>
      </div>

      {/* Existing zip codes */}
      {selectedCity && (existingZipCodes.length > 0) && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-medium text-gray-600 mb-2">Existing data:</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleZipSelect('')}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                zipCode === '' 
                  ? 'bg-primary-100 border-primary-300 text-primary-800' 
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              City-wide {hasCityWideData && '✓'}
            </button>
            {zipCodesWithData.map(zip => (
              <button
                key={zip}
                onClick={() => handleZipSelect(zip)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  zipCode === zip 
                    ? 'bg-primary-100 border-primary-300 text-primary-800' 
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {zip} ✓
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedCity && selectedState && (
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
                        {bedrooms} BR
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
                      {revenues[bedrooms] && parseInt(revenues[bedrooms]) > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          {formatCurrency(parseInt(revenues[bedrooms]) / 12)}/mo
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
                      Save {zipCode ? `for ${zipCode}` : 'City-wide Data'}
                    </>
                  )}
                </button>
                
                {existingData.length > 0 && (
                  <span className="text-sm text-gray-500">
                    {existingData.filter(d => (d.zip_code || '') === zipCode).length} bedroom values saved
                    {zipCode ? ` for ${zipCode}` : ' (city-wide)'}
                  </span>
                )}
              </div>
            </>
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
