"""
Configuration module for the daily lead generation pipeline.
Loads environment variables and provides configuration constants.
"""

import os
from pathlib import Path

# Try to load .env file (for local development)
# In GitHub Actions, env vars are set directly
try:
    from dotenv import load_dotenv
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    load_dotenv(PROJECT_ROOT / '.env')
except ImportError:
    # dotenv not installed (e.g., in GitHub Actions)
    PROJECT_ROOT = Path(__file__).parent.parent.parent

# Database configuration
DATA_DIR = PROJECT_ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)
DATABASE_PATH = DATA_DIR / 'pipeline.db'

# API Keys
APIFY_API_KEY = os.getenv('APIFY_API_KEY', '')
EXA_API_KEY = os.getenv('EXA_API_KEY', '')
ICYPEAS_API_KEY = os.getenv('ICYPEAS_API_KEY', '')
INSTANTLY_API_KEY = os.getenv('INSTANTLY_API_KEY', '')
PROSP_API_KEY = os.getenv('PROSP_API_KEY', '')
OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '')

# LinkedIn Job Scraper Configuration
LINKEDIN_SCRAPER_ACTOR = 'curious_coder/linkedin-jobs-scraper'
LINKEDIN_JOB_URL = (
    'https://www.linkedin.com/jobs/search/?'
    'currentJobId=4330874439&geoId=103644278&'
    'keywords=software%20engineer&'
    'origin=JOB_SEARCH_PAGE_KEYWORD_AUTOCOMPLETE&refresh=true'
)
DEFAULT_JOB_COUNT = 2000  # Reduced from 10000 for faster pipeline runs
TEST_JOB_COUNT = 100

# Pipeline Caps (prevent runaway execution time)
MAX_COMPANIES_PER_RUN = 200  # Max companies to search in Stage 3
MAX_LEADS_PER_RUN = 500  # Max leads to enrich in Stage 4

# Company Filter Configuration
MIN_EMPLOYEES = 11
MAX_EMPLOYEES = 500  # Expanded from 200 to capture more mid-market companies
ALLOWED_COUNTRIES = ['US', 'CA', 'GB', 'AU']  # Added Canada, UK, Australia

# Exa AI Configuration
EXA_SEARCH_LIMIT = 25  # Increased from 10 for more results per company
EXA_API_DELAY = 0.1  # Minimal delay - rate limiting handled by parallel workers
EXA_WORKERS = 10  # Number of parallel workers for Exa search

# LLM Validation Configuration
OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
LLM_MODEL = 'google/gemini-2.0-flash-001'  # Fast and cheap for validation
LLM_VALIDATION_ENABLED = False  # Disabled by default - adds significant overhead

# Icypeas Configuration
ICYPEAS_BASE_URL = 'https://app.icypeas.com/api'
ICYPEAS_USER_ID = os.getenv('ICYPEAS_USER_ID', '')  # User ID for bulk search API
ICYPEAS_BATCH_SIZE = 5000  # Max items per bulk request
ICYPEAS_POLL_INTERVAL = 5  # Seconds between status checks
ICYPEAS_POLL_TIMEOUT = 1800  # Max seconds to wait for results (30 minutes for bulk searches with many items)

# Campaign Configuration
INSTANTLY_CAMPAIGN_ID = '13c27967-c1d6-4a3a-9262-9bddb81745bc'
INSTANTLY_API_URL = 'https://api.instantly.ai/api/v2'

PROSP_LIST_ID = 'a2d17428-17d4-45e4-b33c-e7edec21fd58'
PROSP_CAMPAIGN_ID = '1c7017ab-2e26-4f2e-b89d-8f0d6fc428d5'
PROSP_API_URL = 'https://prosp.ai/api/v1'

# Rate Limiting
API_DELAY_SECONDS = 0.5  # Reduced from 2.0 - only used for Icypeas now
BATCH_DELAY_SECONDS = 0.5  # Reduced from 2 - minimal delay between batches

# Parallel Processing Configuration
ENRICHMENT_WORKERS = 10  # Number of parallel workers for email enrichment
PROSP_WORKERS = 5  # Number of parallel workers for Prosp push

# Retry Configuration
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # Exponential backoff base (seconds)


def validate_config():
    """Validate that all required API keys are set."""
    missing = []

    if not APIFY_API_KEY:
        missing.append('APIFY_API_KEY')
    if not EXA_API_KEY:
        missing.append('EXA_API_KEY')
    if not ICYPEAS_API_KEY:
        missing.append('ICYPEAS_API_KEY')
    if not INSTANTLY_API_KEY:
        missing.append('INSTANTLY_API_KEY')
    if not PROSP_API_KEY:
        missing.append('PROSP_API_KEY')

    if missing:
        raise ValueError(f"Missing required API keys: {', '.join(missing)}")

    return True


def get_job_count(test_mode: bool = False) -> int:
    """Get the number of jobs to scrape based on mode."""
    if test_mode:
        return TEST_JOB_COUNT
    
    # Check if custom job count is set via environment
    custom_count = os.getenv('CUSTOM_JOB_COUNT')
    if custom_count:
        try:
            return int(custom_count)
        except ValueError:
            pass
    
    return DEFAULT_JOB_COUNT
