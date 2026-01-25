"""
Rent Estimator - Estimates monthly rent for for-sale properties.

Uses multiple methods in order of preference:
1. Zestimate rent (if available from Zillow API)
2. Comparable rentals in the same area
3. Mortgage-based estimation
4. AI estimation (fallback)
"""

import os
import logging
from typing import Optional, Tuple, List
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from .models import ZillowListing, City

logger = logging.getLogger(__name__)


def estimate_rent(
    listing: ZillowListing,
    db: Session,
    use_ai_fallback: bool = True
) -> Tuple[float, str]:
    """
    Estimate monthly rent for a for-sale property.
    
    Args:
        listing: The for-sale listing to estimate rent for
        db: Database session
        use_ai_fallback: Whether to use AI as a final fallback
    
    Returns:
        Tuple of (estimated_monthly_rent, estimation_method)
    """
    
    # Method 1: Use Zillow Zestimate rent if available
    if listing.zestimate_rent and listing.zestimate_rent > 0:
        logger.info(f"Using Zestimate rent: ${listing.zestimate_rent}/mo for {listing.address}")
        return listing.zestimate_rent, 'zestimate'
    
    # Method 2: Find comparable rentals in the same area
    comparable_rent = find_comparable_rentals(listing, db)
    if comparable_rent:
        logger.info(f"Using comparable rentals: ${comparable_rent}/mo for {listing.address}")
        return comparable_rent, 'comparable'
    
    # Method 3: Mortgage-based estimation
    if listing.sale_price and listing.sale_price > 0:
        mortgage_rent = estimate_from_mortgage(listing.sale_price)
        logger.info(f"Using mortgage estimate: ${mortgage_rent}/mo for {listing.address}")
        return mortgage_rent, 'mortgage'
    
    # Method 4: AI estimation (if enabled and configured)
    if use_ai_fallback:
        ai_rent = estimate_with_ai(listing, db)
        if ai_rent:
            logger.info(f"Using AI estimate: ${ai_rent}/mo for {listing.address}")
            return ai_rent, 'ai'
    
    # Fallback: Use a rough estimate based on bedrooms
    fallback_rent = estimate_fallback(listing)
    logger.warning(f"Using fallback estimate: ${fallback_rent}/mo for {listing.address}")
    return fallback_rent, 'fallback'


def find_comparable_rentals(
    listing: ZillowListing,
    db: Session,
    radius_sqft: int = 300,
    max_results: int = 10
) -> Optional[float]:
    """
    Find comparable rental listings in the same city with similar characteristics.
    
    Args:
        listing: The for-sale listing to find comparables for
        db: Database session
        radius_sqft: Acceptable sqft variance
        max_results: Maximum comparables to consider
    
    Returns:
        Average rent of comparable properties, or None if not enough data
    """
    try:
        # Build query for comparable rentals
        query = db.query(ZillowListing.price).filter(
            ZillowListing.city_id == listing.city_id,
            ZillowListing.listing_type == 'rental',
            ZillowListing.status == 'active',
            ZillowListing.bedrooms == listing.bedrooms
        )
        
        # Add sqft filter if available
        if listing.sqft:
            query = query.filter(
                ZillowListing.sqft.between(
                    listing.sqft - radius_sqft,
                    listing.sqft + radius_sqft
                )
            )
        
        # Add bathroom filter if available
        if listing.bathrooms:
            query = query.filter(
                ZillowListing.bathrooms.between(
                    listing.bathrooms - 0.5,
                    listing.bathrooms + 0.5
                )
            )
        
        comparables = query.limit(max_results).all()
        
        if len(comparables) >= 3:  # Need at least 3 comparables for reliability
            prices = [c.price for c in comparables if c.price]
            if prices:
                # Use median to avoid outlier influence
                prices.sort()
                mid = len(prices) // 2
                if len(prices) % 2 == 0:
                    return (prices[mid - 1] + prices[mid]) / 2
                return prices[mid]
        
        return None
        
    except Exception as e:
        logger.error(f"Error finding comparable rentals: {e}")
        return None


def estimate_from_mortgage(
    sale_price: float,
    down_payment_pct: float = 0.20,
    interest_rate: float = 0.07,
    loan_term_years: int = 30,
    additional_costs_pct: float = 0.30
) -> float:
    """
    Estimate monthly rent based on mortgage payment calculation.
    
    The logic: Rent should cover mortgage + ~30% for taxes, insurance, maintenance, vacancy.
    
    Args:
        sale_price: Property sale price
        down_payment_pct: Down payment percentage (default 20%)
        interest_rate: Annual interest rate (default 7%)
        loan_term_years: Loan term in years (default 30)
        additional_costs_pct: Additional costs as % of mortgage (default 30%)
    
    Returns:
        Estimated monthly rent
    """
    loan_amount = sale_price * (1 - down_payment_pct)
    monthly_rate = interest_rate / 12
    num_payments = loan_term_years * 12
    
    # Monthly mortgage payment formula
    if monthly_rate > 0:
        mortgage_payment = loan_amount * (
            monthly_rate * (1 + monthly_rate) ** num_payments
        ) / (
            (1 + monthly_rate) ** num_payments - 1
        )
    else:
        mortgage_payment = loan_amount / num_payments
    
    # Add additional costs (taxes, insurance, maintenance, vacancy buffer)
    total_monthly = mortgage_payment * (1 + additional_costs_pct)
    
    return round(total_monthly, 0)


def estimate_with_ai(listing: ZillowListing, db: Session) -> Optional[float]:
    """
    Use OpenAI to estimate rent based on property characteristics and market data.
    
    Returns:
        Estimated monthly rent, or None if AI is not available
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return None
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_key)
        
        # Get some context about the market
        city = db.query(City).filter(City.id == listing.city_id).first()
        city_name = f"{city.city}, {city.state}" if city else "Unknown"
        
        # Get average rent in the area for context
        avg_rent = db.query(func.avg(ZillowListing.price)).filter(
            ZillowListing.city_id == listing.city_id,
            ZillowListing.listing_type == 'rental',
            ZillowListing.status == 'active'
        ).scalar()
        
        avg_rent_context = f"Average rent in {city_name}: ${avg_rent:.0f}/mo" if avg_rent else ""
        
        prompt = f"""Estimate the monthly rent for this property in {city_name}:
        
- Bedrooms: {listing.bedrooms}
- Bathrooms: {listing.bathrooms or 'Unknown'}
- Sqft: {listing.sqft or 'Unknown'}
- Sale Price: ${listing.sale_price:,.0f}
- Property Type: {listing.property_type or 'Unknown'}
- Has Pool: {listing.has_pool}
- Has Garage: {listing.has_garage}

{avg_rent_context}

Respond with ONLY a number representing the estimated monthly rent in dollars. No explanation, just the number."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a real estate rent estimation expert. Provide accurate rent estimates based on property characteristics and market data."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=50,
            temperature=0.3
        )
        
        # Parse the response
        rent_str = response.choices[0].message.content.strip()
        rent_str = ''.join(c for c in rent_str if c.isdigit() or c == '.')
        rent = float(rent_str)
        
        if rent > 0:
            return round(rent, 0)
        
    except Exception as e:
        logger.error(f"AI rent estimation failed: {e}")
    
    return None


def estimate_fallback(listing: ZillowListing) -> float:
    """
    Fallback estimation based on typical rent-to-bedroom ratios.
    Uses conservative national averages.
    
    Returns:
        Estimated monthly rent
    """
    # Rough national averages by bedroom count
    bedroom_base_rents = {
        1: 1200,
        2: 1500,
        3: 2000,
        4: 2500,
        5: 3000,
        6: 3500,
        7: 4000,
        8: 4500
    }
    
    base_rent = bedroom_base_rents.get(listing.bedrooms, 2000)
    
    # Adjust for amenities
    if listing.has_pool:
        base_rent *= 1.15
    if listing.has_garage:
        base_rent *= 1.05
    if listing.has_waterfront:
        base_rent *= 1.20
    
    return round(base_rent, 0)


def update_listing_rent_estimate(listing: ZillowListing, db: Session) -> ZillowListing:
    """
    Update a for-sale listing with an estimated rent value.
    
    Args:
        listing: The listing to update
        db: Database session
    
    Returns:
        Updated listing
    """
    if listing.listing_type != 'for_sale':
        return listing
    
    estimated_rent, method = estimate_rent(listing, db)
    listing.estimated_rent = estimated_rent
    listing.rent_estimation_method = method
    
    return listing
