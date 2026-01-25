"""
AI Advisor - Rule-based response engine for arbitrage questions.
Provides data-driven answers without requiring external API keys.
"""

import re
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from .models import City, ZillowListing, AirDNAData


class RuleBasedAdvisor:
    """Handles common arbitrage questions using pattern matching and database queries."""
    
    def __init__(self, db: Session):
        self.db = db
        
    def answer(self, question: str, context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Process a question and return an answer based on available data.
        
        Returns:
            {
                "answer": str,
                "source": "rule_based",
                "suggestions": List[str],
                "data": Optional[Dict]  # Supporting data for the answer
            }
        """
        question_lower = question.lower().strip()
        
        # Try each handler in order
        handlers = [
            self._handle_best_market,
            self._handle_compare_cities,
            self._handle_lowest_rent,
            self._handle_highest_revenue,
            self._handle_bedroom_query,
            self._handle_amenity_query,
            self._handle_profit_query,
            self._handle_occupancy_query,
            self._handle_listing_count,
            self._handle_general_advice,
        ]
        
        for handler in handlers:
            result = handler(question_lower, context)
            if result:
                result["source"] = "rule_based"
                return result
        
        # Default response if no pattern matches
        return {
            "answer": "I can help you with questions about markets, rental prices, revenue potential, and arbitrage opportunities. Try asking about specific cities, bedroom counts, or comparing markets.",
            "source": "rule_based",
            "suggestions": [
                "What are the best markets for 4BR properties?",
                "Compare Austin vs Denver",
                "Which city has the lowest rent?",
                "Show me properties with pools"
            ]
        }
    
    def _handle_best_market(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about best markets."""
        patterns = [
            r"best (?:market|city|cities|area|place)s? (?:for )?(\d+)?",
            r"where should i (?:invest|look|search)",
            r"top (?:market|city|cities)",
            r"highest (?:profit|revenue|roi)",
        ]
        
        for pattern in patterns:
            if re.search(pattern, question):
                # Get cities with revenue data, sorted by average revenue
                results = self.db.query(
                    City.city,
                    City.state,
                    func.avg(AirDNAData.average_annual_revenue).label('avg_revenue'),
                    func.count(AirDNAData.id).label('data_points')
                ).join(AirDNAData, City.id == AirDNAData.city_id)\
                .group_by(City.id)\
                .order_by(desc('avg_revenue'))\
                .limit(5)\
                .all()
                
                if not results:
                    return {
                        "answer": "I don't have enough revenue data yet to recommend markets. Add revenue data for cities to get recommendations.",
                        "suggestions": ["Go to Data Management to add revenue data"]
                    }
                
                top_cities = [f"{r.city}, {r.state} (${r.avg_revenue:,.0f}/yr avg)" for r in results]
                
                return {
                    "answer": f"Based on average STR revenue, the top markets are:\n\n" + 
                             "\n".join([f"• {c}" for c in top_cities]),
                    "suggestions": [f"Search {results[0].city}" if results else "Add more markets"],
                    "data": {"top_markets": [{"city": r.city, "state": r.state, "avg_revenue": float(r.avg_revenue)} for r in results]}
                }
        
        return None
    
    def _handle_compare_cities(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle city comparison questions."""
        # Look for "compare X vs Y" or "X or Y" or "X versus Y"
        patterns = [
            r"compare (\w+(?:\s+\w+)?)\s+(?:vs|versus|and|or|to)\s+(\w+(?:\s+\w+)?)",
            r"(\w+(?:\s+\w+)?)\s+(?:vs|versus|or)\s+(\w+(?:\s+\w+)?)",
            r"which is better[,:]?\s+(\w+(?:\s+\w+)?)\s+or\s+(\w+(?:\s+\w+)?)",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, question)
            if match:
                city1_name = match.group(1).title()
                city2_name = match.group(2).title()
                
                # Get data for both cities
                city1_data = self._get_city_stats(city1_name)
                city2_data = self._get_city_stats(city2_name)
                
                if not city1_data and not city2_data:
                    return {
                        "answer": f"I don't have data for either {city1_name} or {city2_name}. Add these markets first.",
                        "suggestions": ["Add markets in Data Management"]
                    }
                
                if not city1_data:
                    return {
                        "answer": f"I don't have data for {city1_name}, but {city2_name} has {city2_data['listings']} listings with avg rent ${city2_data['avg_rent']:,.0f}/mo.",
                        "suggestions": [f"Add {city1_name} to compare"]
                    }
                
                if not city2_data:
                    return {
                        "answer": f"I don't have data for {city2_name}, but {city1_name} has {city1_data['listings']} listings with avg rent ${city1_data['avg_rent']:,.0f}/mo.",
                        "suggestions": [f"Add {city2_name} to compare"]
                    }
                
                # Compare
                comparison = []
                comparison.append(f"**{city1_name}**: {city1_data['listings']} listings, avg rent ${city1_data['avg_rent']:,.0f}/mo")
                if city1_data['avg_revenue']:
                    comparison.append(f"  → Avg STR revenue: ${city1_data['avg_revenue']:,.0f}/yr")
                
                comparison.append(f"\n**{city2_name}**: {city2_data['listings']} listings, avg rent ${city2_data['avg_rent']:,.0f}/mo")
                if city2_data['avg_revenue']:
                    comparison.append(f"  → Avg STR revenue: ${city2_data['avg_revenue']:,.0f}/yr")
                
                # Determine winner
                winner = None
                if city1_data['avg_revenue'] and city2_data['avg_revenue']:
                    if city1_data['avg_revenue'] > city2_data['avg_revenue']:
                        winner = city1_name
                        margin = ((city1_data['avg_revenue'] / city2_data['avg_revenue']) - 1) * 100
                    else:
                        winner = city2_name
                        margin = ((city2_data['avg_revenue'] / city1_data['avg_revenue']) - 1) * 100
                    comparison.append(f"\n**Recommendation**: {winner} shows {margin:.0f}% higher revenue potential.")
                
                return {
                    "answer": "\n".join(comparison),
                    "suggestions": [f"Search {winner}" if winner else f"Search {city1_name}"],
                    "data": {"city1": city1_data, "city2": city2_data}
                }
        
        return None
    
    def _get_city_stats(self, city_name: str) -> Optional[Dict]:
        """Get statistics for a city."""
        city = self.db.query(City).filter(
            func.lower(City.city).like(f"%{city_name.lower()}%")
        ).first()
        
        if not city:
            return None
        
        # Get listing stats
        listings = self.db.query(
            func.count(ZillowListing.id).label('count'),
            func.avg(ZillowListing.price).label('avg_rent')
        ).filter(
            ZillowListing.city_id == city.id,
            ZillowListing.status == 'active'
        ).first()
        
        # Get revenue stats
        revenue = self.db.query(
            func.avg(AirDNAData.average_annual_revenue).label('avg_revenue')
        ).filter(AirDNAData.city_id == city.id).first()
        
        return {
            "city": city.city,
            "state": city.state,
            "listings": listings.count or 0,
            "avg_rent": float(listings.avg_rent or 0),
            "avg_revenue": float(revenue.avg_revenue) if revenue.avg_revenue else None
        }
    
    def _handle_lowest_rent(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about lowest rent."""
        if any(word in question for word in ['lowest rent', 'cheapest', 'affordable', 'low rent', 'cheap rent']):
            results = self.db.query(
                City.city,
                City.state,
                func.avg(ZillowListing.price).label('avg_rent'),
                func.count(ZillowListing.id).label('count')
            ).join(ZillowListing, City.id == ZillowListing.city_id)\
            .filter(ZillowListing.status == 'active')\
            .group_by(City.id)\
            .having(func.count(ZillowListing.id) >= 5)\
            .order_by('avg_rent')\
            .limit(5)\
            .all()
            
            if not results:
                return {
                    "answer": "I don't have enough listing data to determine the cheapest markets.",
                    "suggestions": ["Fetch listings for your markets"]
                }
            
            cities = [f"{r.city}, {r.state}: ${r.avg_rent:,.0f}/mo avg ({r.count} listings)" for r in results]
            
            return {
                "answer": "Markets with lowest average rent:\n\n" + "\n".join([f"• {c}" for c in cities]),
                "suggestions": [f"Search {results[0].city}"],
                "data": {"cheapest_markets": [{"city": r.city, "avg_rent": float(r.avg_rent)} for r in results]}
            }
        
        return None
    
    def _handle_highest_revenue(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about highest revenue."""
        if any(phrase in question for phrase in ['highest revenue', 'most revenue', 'best revenue', 'top revenue']):
            results = self.db.query(
                City.city,
                City.state,
                func.max(AirDNAData.average_annual_revenue).label('max_revenue'),
                AirDNAData.bedrooms_min
            ).join(AirDNAData, City.id == AirDNAData.city_id)\
            .group_by(City.id, AirDNAData.bedrooms_min)\
            .order_by(desc('max_revenue'))\
            .limit(5)\
            .all()
            
            if not results:
                return {
                    "answer": "I don't have revenue data yet. Add STR revenue data to see top earners.",
                    "suggestions": ["Add revenue data in Data Management"]
                }
            
            entries = [f"{r.city}, {r.state} ({r.bedrooms_min}BR): ${r.max_revenue:,.0f}/yr" for r in results]
            
            return {
                "answer": "Highest revenue potential:\n\n" + "\n".join([f"• {e}" for e in entries]),
                "suggestions": [f"Search {results[0].city} for {results[0].bedrooms_min}BR properties"],
                "data": {"top_revenue": [{"city": r.city, "bedrooms": r.bedrooms_min, "revenue": float(r.max_revenue)} for r in results]}
            }
        
        return None
    
    def _handle_bedroom_query(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about specific bedroom counts."""
        match = re.search(r'(\d+)\s*(?:br|bed|bedroom)s?', question)
        if match:
            bedrooms = int(match.group(1))
            
            # Get listings and revenue data for this bedroom count
            listings = self.db.query(
                City.city,
                City.state,
                func.count(ZillowListing.id).label('count'),
                func.avg(ZillowListing.price).label('avg_rent')
            ).join(ZillowListing, City.id == ZillowListing.city_id)\
            .filter(
                ZillowListing.bedrooms == bedrooms,
                ZillowListing.status == 'active'
            ).group_by(City.id)\
            .order_by(desc('count'))\
            .limit(5)\
            .all()
            
            revenue = self.db.query(
                City.city,
                City.state,
                AirDNAData.average_annual_revenue
            ).join(AirDNAData, City.id == AirDNAData.city_id)\
            .filter(
                AirDNAData.bedrooms_min <= bedrooms,
                AirDNAData.bedrooms_max >= bedrooms
            ).order_by(desc(AirDNAData.average_annual_revenue))\
            .limit(3)\
            .all()
            
            response_parts = [f"**{bedrooms}-bedroom properties:**\n"]
            
            if listings:
                response_parts.append("Available listings:")
                for l in listings[:3]:
                    response_parts.append(f"• {l.city}, {l.state}: {l.count} listings, avg ${l.avg_rent:,.0f}/mo")
            
            if revenue:
                response_parts.append("\nTop revenue potential:")
                for r in revenue:
                    response_parts.append(f"• {r.city}, {r.state}: ${r.annual_revenue:,.0f}/yr")
            
            if not listings and not revenue:
                return {
                    "answer": f"I don't have data for {bedrooms}-bedroom properties yet.",
                    "suggestions": ["Try searching with the bedroom filter"]
                }
            
            return {
                "answer": "\n".join(response_parts),
                "suggestions": [f"Search for {bedrooms}BR in {listings[0].city}" if listings else "Add more markets"]
            }
        
        return None
    
    def _handle_amenity_query(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about amenities."""
        amenities = {
            'pool': ZillowListing.has_pool,
            'waterfront': ZillowListing.has_waterfront,
            'garage': ZillowListing.has_garage,
            'yard': ZillowListing.has_yard,
        }
        
        for amenity_name, amenity_col in amenities.items():
            if amenity_name in question:
                results = self.db.query(
                    City.city,
                    City.state,
                    func.count(ZillowListing.id).label('count'),
                    func.avg(ZillowListing.price).label('avg_rent')
                ).join(ZillowListing, City.id == ZillowListing.city_id)\
                .filter(
                    amenity_col == True,
                    ZillowListing.status == 'active'
                ).group_by(City.id)\
                .order_by(desc('count'))\
                .limit(5)\
                .all()
                
                if not results:
                    return {
                        "answer": f"I don't have any listings with {amenity_name}s in the database.",
                        "suggestions": ["Fetch more listings to find properties with amenities"]
                    }
                
                total = sum(r.count for r in results)
                cities = [f"{r.city}, {r.state}: {r.count} properties" for r in results]
                
                return {
                    "answer": f"Found {total} properties with {amenity_name}s:\n\n" + "\n".join([f"• {c}" for c in cities]),
                    "suggestions": [f"Search {results[0].city} with {amenity_name} filter"],
                    "data": {"amenity": amenity_name, "total": total}
                }
        
        return None
    
    def _handle_profit_query(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about profit."""
        if any(word in question for word in ['profit', 'margin', 'money', 'earn', 'make']):
            # Get cities with both listing and revenue data
            results = self.db.query(
                City.city,
                City.state,
                func.avg(ZillowListing.price).label('avg_rent'),
                func.avg(AirDNAData.average_annual_revenue).label('avg_revenue')
            ).join(ZillowListing, City.id == ZillowListing.city_id)\
            .join(AirDNAData, City.id == AirDNAData.city_id)\
            .filter(ZillowListing.status == 'active')\
            .group_by(City.id)\
            .all()
            
            if not results:
                return {
                    "answer": "I need both listing and revenue data to calculate profit potential. Make sure you have data for your target markets.",
                    "suggestions": ["Add revenue data", "Fetch listings"]
                }
            
            # Calculate estimated profit
            profits = []
            for r in results:
                annual_rent = float(r.avg_rent) * 12
                annual_revenue = float(r.avg_revenue)
                estimated_profit = annual_revenue * 0.7 - annual_rent  # 30% expenses
                profits.append({
                    "city": r.city,
                    "state": r.state,
                    "profit": estimated_profit,
                    "rent": r.avg_rent,
                    "revenue": r.avg_revenue
                })
            
            profits.sort(key=lambda x: x['profit'], reverse=True)
            
            response = ["Estimated annual profit (revenue × 70% - rent):\n"]
            for p in profits[:5]:
                sign = "+" if p['profit'] > 0 else ""
                response.append(f"• {p['city']}, {p['state']}: {sign}${p['profit']:,.0f}/yr")
            
            return {
                "answer": "\n".join(response),
                "suggestions": [f"Search {profits[0]['city']}" if profits[0]['profit'] > 0 else "Adjust your search criteria"],
                "data": {"profits": profits[:5]}
            }
        
        return None
    
    def _handle_occupancy_query(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about occupancy."""
        if 'occupancy' in question or 'break even' in question or 'breakeven' in question:
            return {
                "answer": "Break-even occupancy is calculated as:\n\n(Monthly Rent + Expenses) / (Monthly Revenue)\n\nLower is better - aim for properties under 60% break-even occupancy. This means you only need 60% of nights booked to cover costs.",
                "suggestions": ["Use the Profit filter to set max break-even"]
            }
        
        return None
    
    def _handle_listing_count(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle questions about listing counts."""
        if any(phrase in question for phrase in ['how many', 'total listings', 'listing count', 'number of']):
            results = self.db.query(
                City.city,
                City.state,
                func.count(ZillowListing.id).label('count')
            ).join(ZillowListing, City.id == ZillowListing.city_id)\
            .filter(ZillowListing.status == 'active')\
            .group_by(City.id)\
            .order_by(desc('count'))\
            .all()
            
            if not results:
                return {
                    "answer": "No listings in the database yet. Fetch listings for your target markets.",
                    "suggestions": ["Go to Data Management to fetch listings"]
                }
            
            total = sum(r.count for r in results)
            cities = [f"{r.city}, {r.state}: {r.count}" for r in results]
            
            return {
                "answer": f"Total active listings: {total:,}\n\nBy market:\n" + "\n".join([f"• {c}" for c in cities]),
                "suggestions": ["Fetch more listings to expand your search"],
                "data": {"total": total, "by_city": [{"city": r.city, "count": r.count} for r in results]}
            }
        
        return None
    
    def _handle_general_advice(self, question: str, context: Optional[Dict]) -> Optional[Dict]:
        """Handle general arbitrage advice questions."""
        advice_triggers = ['how do i', 'how to', 'what is', 'explain', 'help', 'advice', 'tips', 'strategy']
        
        if any(trigger in question for trigger in advice_triggers):
            if 'arbitrage' in question:
                return {
                    "answer": "**Rental arbitrage** is renting a property long-term and subletting it as a short-term rental (like Airbnb).\n\n**Key factors for success:**\n• Find markets where STR revenue > long-term rent + expenses\n• Aim for 50-60% break-even occupancy\n• Check local STR regulations before committing\n• Properties with amenities (pool, etc.) command higher nightly rates\n• 3-5 bedroom properties typically offer the best margins",
                    "suggestions": ["Search for opportunities", "Compare markets"]
                }
            
            if 'start' in question or 'begin' in question:
                return {
                    "answer": "**Getting started:**\n\n1. Add target markets (cities you're interested in)\n2. Add revenue data (from AirDNA or manual research)\n3. Fetch rental listings for those markets\n4. Use Rapid Search to find opportunities\n5. Filter by profit, bedrooms, and amenities",
                    "suggestions": ["Add a market", "Run Rapid Search"]
                }
        
        return None
