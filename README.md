# Zillow Rental Arbitrage Tool

A web application for finding rental arbitrage opportunities by comparing Zillow rental prices with AirDNA short-term rental revenue data.

## Features

- **Zillow Scraper**: Scrapes rental listings by zip code (3-8 bedrooms)
- **AirDNA Input**: Manual input for AirDNA average revenue data
- **Discrepancy Analysis**: Compares rental costs vs. potential STR revenue
- **Sortable Dashboard**: Find the best arbitrage opportunities

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

## Disclaimer

This tool is for educational and research purposes. Scraping websites may violate their Terms of Service. Use responsibly and respect rate limits. The accuracy of arbitrage calculations depends on the quality of AirDNA data entered.

## License

MIT
