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

# LinkedIn Job Scraper Configuration
LINKEDIN_SCRAPER_ACTOR = 'curious_coder/linkedin-jobs-scraper'
LINKEDIN_JOB_URL = (
    'https://www.linkedin.com/jobs/search/?'
    'currentJobId=4330874439&geoId=103644278&'
    'keywords=software%20engineer&'
    'origin=JOB_SEARCH_PAGE_KEYWORD_AUTOCOMPLETE&refresh=true'
)
DEFAULT_JOB_COUNT = 10000
TEST_JOB_COUNT = 100

# Company Filter Configuration
MIN_EMPLOYEES = 11
MAX_EMPLOYEES = 200
ALLOWED_COUNTRIES = ['US']

# Exa AI Configuration
EXA_SEARCH_LIMIT = 25  # Max results per company search

# Icypeas Configuration
ICYPEAS_BASE_URL = 'https://app.icypeas.com/api'
ICYPEAS_BATCH_SIZE = 5000  # Max items per bulk request
ICYPEAS_POLL_INTERVAL = 5  # Seconds between status checks
ICYPEAS_POLL_TIMEOUT = 600  # Max seconds to wait for results

# Campaign Configuration
INSTANTLY_CAMPAIGN_ID = '13c27967-c1d6-4a3a-9262-9bddb81745bc'
INSTANTLY_API_URL = 'https://api.instantly.ai/api/v2'

PROSP_LIST_ID = 'a2d17428-17d4-45e4-b33c-e7edec21fd58'
PROSP_CAMPAIGN_ID = '1c7017ab-2e26-4f2e-b89d-8f0d6fc428d5'
PROSP_API_URL = 'https://prosp.ai/api/v1'

# Rate Limiting
API_DELAY_SECONDS = 2.0  # Delay between individual API calls (increased from 0.5 for Exa stability)
BATCH_DELAY_SECONDS = 2  # Delay between batches

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
    return TEST_JOB_COUNT if test_mode else DEFAULT_JOB_COUNT
