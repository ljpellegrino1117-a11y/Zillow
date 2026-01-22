from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
import asyncio
import logging

from .database import engine, get_db, Base
from .models import ZipCode, ZillowListing, AirDNAData
from .schemas import (
    ZipCodeCreate, ZipCodeResponse,
    ZillowListingResponse,
    AirDNAInput, AirDNADataResponse,
    DiscrepancyResult,
    ScrapeRequest, ScrapeStatus
)
from .scraper import scrape_zillow

# Create tables
Base.metadata.create_all(bind=engine)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Zillow Arbitrage API",
    description="API for scraping Zillow rentals and analyzing arbitrage opportunities",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track scraping jobs
scrape_jobs = {}


# ==================== Zip Code Endpoints ====================

@app.get("/api/zip-codes", response_model=List[ZipCodeResponse])
def get_zip_codes(db: Session = Depends(get_db)):
    """Get all zip codes in the database."""
    return db.query(ZipCode).all()


@app.post("/api/zip-codes", response_model=ZipCodeResponse)
def create_zip_code(zip_code_data: ZipCodeCreate, db: Session = Depends(get_db)):
    """Add a new zip code to track."""
    existing = db.query(ZipCode).filter(ZipCode.zip_code == zip_code_data.zip_code).first()
    if existing:
        return existing
    
    zip_code = ZipCode(**zip_code_data.model_dump())
    db.add(zip_code)
    db.commit()
    db.refresh(zip_code)
    return zip_code


@app.delete("/api/zip-codes/{zip_code}")
def delete_zip_code(zip_code: str, db: Session = Depends(get_db)):
    """Delete a zip code and all associated data."""
    zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
    if not zip_obj:
        raise HTTPException(status_code=404, detail="Zip code not found")
    
    # Delete associated data
    db.query(ZillowListing).filter(ZillowListing.zip_code_id == zip_obj.id).delete()
    db.query(AirDNAData).filter(AirDNAData.zip_code_id == zip_obj.id).delete()
    db.delete(zip_obj)
    db.commit()
    return {"message": f"Deleted zip code {zip_code} and all associated data"}


# ==================== Scraping Endpoints ====================

async def run_scrape_job(zip_code: str, min_bedrooms: int, max_bedrooms: int, db_session_factory):
    """Background task to run scraping job."""
    scrape_jobs[zip_code] = {"status": "running", "listings_found": 0, "message": "Scraping in progress..."}
    
    try:
        listings = await scrape_zillow(zip_code, min_bedrooms, max_bedrooms)
        
        # Save to database
        db = db_session_factory()
        try:
            # Get or create zip code
            zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
            if not zip_obj:
                zip_obj = ZipCode(zip_code=zip_code)
                db.add(zip_obj)
                db.commit()
                db.refresh(zip_obj)
            
            # Clear old listings for this zip code
            db.query(ZillowListing).filter(ZillowListing.zip_code_id == zip_obj.id).delete()
            
            # Add new listings
            for listing_data in listings:
                listing = ZillowListing(
                    zillow_id=listing_data['zillow_id'],
                    zip_code_id=zip_obj.id,
                    address=listing_data['address'],
                    city=listing_data.get('city'),
                    state=listing_data.get('state'),
                    bedrooms=listing_data['bedrooms'],
                    bathrooms=listing_data.get('bathrooms'),
                    price=listing_data['price'],
                    description=listing_data.get('description'),
                    property_type=listing_data.get('property_type'),
                    sqft=listing_data.get('sqft'),
                    url=listing_data.get('url'),
                )
                db.add(listing)
            
            # Update last scraped time
            zip_obj.last_scraped = datetime.utcnow()
            db.commit()
            
            scrape_jobs[zip_code] = {
                "status": "completed",
                "listings_found": len(listings),
                "message": f"Successfully scraped {len(listings)} listings"
            }
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Scraping error for {zip_code}: {e}")
        scrape_jobs[zip_code] = {
            "status": "failed",
            "listings_found": 0,
            "message": str(e)
        }


@app.post("/api/scrape", response_model=ScrapeStatus)
async def start_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Start a scraping job for a zip code."""
    from .database import SessionLocal
    
    if request.zip_code in scrape_jobs and scrape_jobs[request.zip_code]["status"] == "running":
        return ScrapeStatus(
            zip_code=request.zip_code,
            status="running",
            message="Scrape already in progress for this zip code"
        )
    
    # Start background task
    background_tasks.add_task(
        run_scrape_job,
        request.zip_code,
        request.min_bedrooms,
        request.max_bedrooms,
        SessionLocal
    )
    
    scrape_jobs[request.zip_code] = {"status": "running", "listings_found": 0, "message": "Starting scrape..."}
    
    return ScrapeStatus(
        zip_code=request.zip_code,
        status="running",
        message="Scrape job started"
    )


@app.get("/api/scrape/{zip_code}/status", response_model=ScrapeStatus)
def get_scrape_status(zip_code: str):
    """Get the status of a scraping job."""
    if zip_code not in scrape_jobs:
        return ScrapeStatus(
            zip_code=zip_code,
            status="not_started",
            message="No scrape job found for this zip code"
        )
    
    job = scrape_jobs[zip_code]
    return ScrapeStatus(
        zip_code=zip_code,
        status=job["status"],
        listings_found=job.get("listings_found", 0),
        message=job.get("message", "")
    )


# ==================== Listings Endpoints ====================

@app.get("/api/listings", response_model=List[ZillowListingResponse])
def get_listings(
    zip_code: Optional[str] = None,
    bedrooms: Optional[int] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get listings with optional filters."""
    query = db.query(ZillowListing)
    
    if zip_code:
        zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
        if zip_obj:
            query = query.filter(ZillowListing.zip_code_id == zip_obj.id)
        else:
            return []
    
    if bedrooms is not None:
        query = query.filter(ZillowListing.bedrooms == bedrooms)
    
    if min_price is not None:
        query = query.filter(ZillowListing.price >= min_price)
    
    if max_price is not None:
        query = query.filter(ZillowListing.price <= max_price)
    
    return query.offset(offset).limit(limit).all()


@app.get("/api/listings/stats")
def get_listing_stats(zip_code: Optional[str] = None, db: Session = Depends(get_db)):
    """Get aggregate statistics for listings."""
    query = db.query(ZillowListing)
    
    if zip_code:
        zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
        if zip_obj:
            query = query.filter(ZillowListing.zip_code_id == zip_obj.id)
        else:
            return {"error": "Zip code not found"}
    
    # Get stats by bedroom count
    stats = db.query(
        ZillowListing.bedrooms,
        func.count(ZillowListing.id).label('count'),
        func.avg(ZillowListing.price).label('avg_price'),
        func.min(ZillowListing.price).label('min_price'),
        func.max(ZillowListing.price).label('max_price')
    )
    
    if zip_code:
        zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
        if zip_obj:
            stats = stats.filter(ZillowListing.zip_code_id == zip_obj.id)
    
    stats = stats.group_by(ZillowListing.bedrooms).all()
    
    return [
        {
            "bedrooms": s.bedrooms,
            "count": s.count,
            "avg_price": round(s.avg_price, 2) if s.avg_price else None,
            "min_price": s.min_price,
            "max_price": s.max_price,
        }
        for s in stats
    ]


# ==================== AirDNA Endpoints ====================

@app.post("/api/airdna", response_model=List[AirDNADataResponse])
def save_airdna_data(data: AirDNAInput, db: Session = Depends(get_db)):
    """Save AirDNA data for a zip code."""
    # Get or create zip code
    zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == data.zip_code).first()
    if not zip_obj:
        zip_obj = ZipCode(zip_code=data.zip_code)
        db.add(zip_obj)
        db.commit()
        db.refresh(zip_obj)
    
    results = []
    for item in data.data:
        # Update or create AirDNA data
        existing = db.query(AirDNAData).filter(
            AirDNAData.zip_code_id == zip_obj.id,
            AirDNAData.bedrooms == item.bedrooms
        ).first()
        
        if existing:
            existing.average_annual_revenue = item.average_annual_revenue
            existing.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(existing)
            results.append(existing)
        else:
            airdna = AirDNAData(
                zip_code_id=zip_obj.id,
                bedrooms=item.bedrooms,
                average_annual_revenue=item.average_annual_revenue
            )
            db.add(airdna)
            db.commit()
            db.refresh(airdna)
            results.append(airdna)
    
    return results


@app.get("/api/airdna/{zip_code}", response_model=List[AirDNADataResponse])
def get_airdna_data(zip_code: str, db: Session = Depends(get_db)):
    """Get AirDNA data for a zip code."""
    zip_obj = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).first()
    if not zip_obj:
        return []
    
    return db.query(AirDNAData).filter(AirDNAData.zip_code_id == zip_obj.id).all()


# ==================== Analysis Endpoints ====================

@app.get("/api/analysis/discrepancy", response_model=List[DiscrepancyResult])
def get_discrepancy_analysis(
    zip_code: Optional[str] = None,
    min_bedrooms: int = 3,
    max_bedrooms: int = 8,
    db: Session = Depends(get_db)
):
    """
    Analyze discrepancy between AirDNA revenue and rental prices.
    Returns opportunities sorted by potential profit.
    """
    results = []
    
    # Get zip codes to analyze
    if zip_code:
        zip_codes = db.query(ZipCode).filter(ZipCode.zip_code == zip_code).all()
    else:
        zip_codes = db.query(ZipCode).all()
    
    for zip_obj in zip_codes:
        # Get AirDNA data for this zip code
        airdna_data = {
            d.bedrooms: d.average_annual_revenue 
            for d in db.query(AirDNAData).filter(AirDNAData.zip_code_id == zip_obj.id).all()
        }
        
        if not airdna_data:
            continue
        
        for bedrooms in range(min_bedrooms, max_bedrooms + 1):
            if bedrooms not in airdna_data:
                continue
            
            # Get listings for this bedroom count
            listings = db.query(ZillowListing).filter(
                ZillowListing.zip_code_id == zip_obj.id,
                ZillowListing.bedrooms == bedrooms
            ).order_by(ZillowListing.price).all()
            
            if not listings:
                continue
            
            # Calculate statistics
            prices = [l.price for l in listings]
            avg_price = sum(prices) / len(prices)
            
            # Bottom 10% average
            bottom_count = max(1, len(prices) // 10)
            bottom_prices = sorted(prices)[:bottom_count]
            bottom_avg = sum(bottom_prices) / len(bottom_prices)
            
            airdna_annual = airdna_data[bedrooms]
            airdna_monthly = airdna_annual / 12
            
            # Calculate profits
            annual_rent_avg = avg_price * 12
            annual_rent_bottom = bottom_avg * 12
            
            profit_vs_avg = airdna_annual - annual_rent_avg
            profit_vs_bottom = airdna_annual - annual_rent_bottom
            
            roi_vs_avg = (profit_vs_avg / annual_rent_avg * 100) if annual_rent_avg > 0 else 0
            roi_vs_bottom = (profit_vs_bottom / annual_rent_bottom * 100) if annual_rent_bottom > 0 else 0
            
            results.append(DiscrepancyResult(
                zip_code=zip_obj.zip_code,
                city=zip_obj.city,
                state=zip_obj.state,
                bedrooms=bedrooms,
                airdna_annual_revenue=airdna_annual,
                airdna_monthly_revenue=round(airdna_monthly, 2),
                avg_rental_price=round(avg_price, 2),
                bottom_10_avg_rental_price=round(bottom_avg, 2),
                listing_count=len(listings),
                annual_profit_vs_avg=round(profit_vs_avg, 2),
                annual_profit_vs_bottom=round(profit_vs_bottom, 2),
                roi_vs_avg=round(roi_vs_avg, 2),
                roi_vs_bottom=round(roi_vs_bottom, 2),
            ))
    
    # Sort by profit vs bottom 10% (best opportunities first)
    results.sort(key=lambda x: x.annual_profit_vs_bottom, reverse=True)
    
    return results


@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
