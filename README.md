# Zillow Rental Arbitrage Tool

A web application for finding rental arbitrage opportunities by comparing Zillow rental prices with short-term rental revenue data from Airbtics and AirDNA.

## Features

- **Zillow Scraper**: Scrapes rental listings by city/zip code (1-8 bedrooms)
- **Airbtics API Integration**: Auto-fetches STR revenue data for all cities (primary method)
- **AirDNA Input**: Manual input or AI screenshot analysis (backup method)
- **Discrepancy Analysis**: Compares rental costs vs. potential STR revenue
- **AI-Powered Analysis**: Opportunity scoring, strengths/weaknesses, recommendations
- **Revenue Percentiles**: p25, p50, p75, p90 revenue data for flexible analysis

## Architecture

```
├── backend/           # Python FastAPI backend
│   ├── app/
│   │   ├── main.py       # API endpoints
│   │   ├── scraper.py    # Zillow scraper (ScraperAPI)
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Pydantic schemas
│   │   └── database.py   # Database config
│   └── requirements.txt
│
└── frontend/          # Next.js React frontend
    ├── src/
    │   ├── app/          # Next.js app router
    │   ├── components/   # React components
    │   └── lib/          # API client & utilities
    └── package.json
```

## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- ScraperAPI account (free tier: 5,000 credits/month)

### 1. Get a ScraperAPI Key

1. Sign up at [https://www.scraperapi.com](https://www.scraperapi.com)
2. Copy your API key from the dashboard

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env and add your SCRAPER_API_KEY

# Run the backend
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```

### 4. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## Usage

### 1. Add Zip Codes
Enter zip codes you want to analyze in the "Zip Codes" section.

### 2. Scrape Zillow
Click "Scrape" to fetch rental listings for each zip code. This uses ScraperAPI credits (~1 credit per page).

### 3. Enter AirDNA Data
Go to AirDNA, look up each zip code, and enter the average annual revenue for each bedroom count (3-8 BR).

### 4. Analyze Discrepancies
The "Arbitrage Opportunities" table shows:
- **AirDNA Annual Revenue**: Expected STR income
- **Avg Rent**: Average long-term rental price
- **Bottom 10% Rent**: Cheapest rentals (best arbitrage targets)
- **Profit vs Bottom**: Potential annual profit
- **ROI vs Bottom**: Return on investment percentage

Sort by "Profit vs Bottom" to find the best opportunities.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/zip-codes` | GET | List all zip codes |
| `/api/zip-codes` | POST | Add a zip code |
| `/api/scrape` | POST | Start scraping a zip code |
| `/api/scrape/{zip}/status` | GET | Get scrape job status |
| `/api/listings` | GET | Get scraped listings |
| `/api/airdna` | POST | Save AirDNA data |
| `/api/airdna/{zip}` | GET | Get AirDNA data |
| `/api/analysis/discrepancy` | GET | Get arbitrage analysis |

## Cost Considerations

### ScraperAPI
- Free tier: 5,000 API credits/month
- Each Zillow page = ~1 credit
- Typical zip code (6 bedroom counts × 5 pages) = ~30 credits
- Free tier supports ~160 zip codes/month

### Scaling Up
- Hobby: $49/month for 100,000 credits
- Startup: $149/month for 250,000 credits
- Business: $299/month for 3,000,000 credits

## Data Collected

For each Zillow listing:
- Address, city, state
- Bedroom & bathroom count
- Monthly rental price
- Property description
- Square footage
- Zillow URL

## Railway Deployment

This is a monorepo with separate backend and frontend services. Deploy each as a separate Railway service:

### Backend Service (Python/FastAPI)

1. Create a new Railway service from GitHub
2. **Set Root Directory to: `backend`**
3. Add environment variable: `SCRAPER_API_KEY=your_key`
4. Railway will auto-detect Python and use the Procfile

### Frontend Service (Next.js)

1. Create another Railway service from the same GitHub repo
2. **Set Root Directory to: `frontend`**
3. Add environment variable: `BACKEND_URL=https://your-backend.railway.app`
4. Railway will auto-detect Node.js and build Next.js

### Environment Variables

**Backend:**
- `SCRAPER_API_KEY` - Your ScraperAPI key for Zillow scraping
- `AIRBTICS_API_KEY` - Your Airbtics API key for STR revenue data (primary data source)
- `OPENAI_API_KEY` - Your OpenAI API key for AI screenshot analysis (optional)
- `PORT` - Set automatically by Railway

**Frontend:**
- `BACKEND_URL` - URL of the deployed backend service (include https://)
- `PORT` - Set automatically by Railway

### Airbtics API

Airbtics is the primary source for short-term rental revenue data:
- **Auto-sync on startup**: Fetches data for all cities that need refresh
- **6-month refresh**: Data is automatically refreshed every 6 months
- **Bedroom coverage**: Fetches revenue for 1-8 bedroom properties
- **Revenue percentiles**: p25, p50 (median), p75, p90 for flexible analysis

Get your API key at: https://airbtics.com/api-pricing

## Disclaimer

This tool is for educational and research purposes. Scraping websites may violate their Terms of Service. Use responsibly and respect rate limits. The accuracy of arbitrage calculations depends on the quality of AirDNA data entered.

## License

MIT
