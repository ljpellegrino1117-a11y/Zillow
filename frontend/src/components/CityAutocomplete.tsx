'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCities, USCity } from '@/data/us-cities';
import { MapPin } from 'lucide-react';

interface Props {
  value: string;
  onChange: (city: string, state: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CityAutocomplete({ value, onChange, placeholder = "e.g., Chicago", className = "" }: Props) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<USCity[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Update input when value prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Search for cities when input changes
  useEffect(() => {
    if (inputValue.length >= 2) {
      const results = searchCities(inputValue, 8);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setHighlightedIndex(-1);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [inputValue]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current && 
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Auto-select state if there's an exact match
    if (newValue.length >= 2) {
      const results = searchCities(newValue, 1);
      if (results.length > 0 && results[0].city.toLowerCase() === newValue.toLowerCase()) {
        onChange(newValue, results[0].state);
        return;
      }
    }
    onChange(newValue, ''); // No exact match, let user select state manually
  };

  const handleSelectCity = useCallback((city: USCity) => {
    setInputValue(city.city);
    onChange(city.city, city.state);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelectCity(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleFocus = () => {
    if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  // Auto-select first suggestion when leaving the field
  const handleBlur = () => {
    // Small delay to allow click on suggestion to register
    setTimeout(() => {
      if (inputValue.length >= 2 && suggestions.length > 0) {
        // Auto-select if there's a close match
        const exactMatch = suggestions.find(s => s.city.toLowerCase() === inputValue.toLowerCase());
        if (exactMatch) {
          setInputValue(exactMatch.city);
          onChange(exactMatch.city, exactMatch.state);
        } else if (suggestions.length === 1) {
          // If only one suggestion, auto-select it
          setInputValue(suggestions[0].city);
          onChange(suggestions[0].city, suggestions[0].state);
        }
      }
      setShowSuggestions(false);
    }, 200);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="input w-full"
        autoComplete="off"
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-y-auto"
        >
          {suggestions.map((city, index) => (
            <button
              key={`${city.city}-${city.state}`}
              type="button"
              onClick={() => handleSelectCity(city)}
              className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-blue-50 transition-colors ${
                index === highlightedIndex ? 'bg-blue-50' : ''
              }`}
            >
              <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="font-medium text-gray-900">{city.city}</span>
              <span className="text-gray-500 text-sm">{city.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
