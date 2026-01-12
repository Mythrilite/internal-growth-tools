#!/usr/bin/env python3
"""
Test script to verify the bulk email enrichment fix works.
"""

import sys
import time
import json

# Add parent directory to path
sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
)
from pipeline.email_enricher import (
    submit_bulk_search,
    poll_bulk_completion,
    fetch_bulk_results,
)

# Test data - 5 sample leads
TEST_LEADS = [
    {
        'person_first_name': 'John',
        'person_last_name': 'Smith',
        'company_domain': 'google.com',
    },
    {
        'person_first_name': 'Jane',
        'person_last_name': 'Doe',
        'company_domain': 'microsoft.com',
    },
    {
        'person_first_name': 'Bob',
        'person_last_name': 'Johnson',
        'company_domain': 'amazon.com',
    },
    {
        'person_first_name': 'Alice',
        'person_last_name': 'Williams',
        'company_domain': 'apple.com',
    },
    {
        'person_first_name': 'Charlie',
        'person_last_name': 'Brown',
        'company_domain': 'meta.com',
    },
]

def test_bulk_enrichment():
    """Test the complete bulk enrichment flow."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('=' * 60)
    print('STEP 1: CHECK CONFIGURATION')
    print('=' * 60)

    from pipeline.config import ICYPEAS_USER_ID
    if not ICYPEAS_USER_ID:
        print('[FAILED] ICYPEAS_USER_ID not configured in .env')
        return False

    print(f'[OK] User ID configured: {ICYPEAS_USER_ID}')

    print('\n' + '=' * 60)
    print('STEP 2: SUBMIT BULK SEARCH')
    print('=' * 60)

    # Prepare data for bulk search
    bulk_data = []
    lead_keys = []
    for lead in TEST_LEADS:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')
        bulk_data.append([first_name, last_name, domain])
        lead_keys.append((first_name.lower(), last_name.lower(), domain.lower()))

    print(f'Submitting {len(bulk_data)} leads...')
    file_id = submit_bulk_search(bulk_data, headers)
    
    if not file_id:
        print('[FAILED] Could not submit bulk search')
        return False

    print(f'[OK] Bulk search submitted with file ID: {file_id}')

    print('\n' + '=' * 60)
    print('STEP 3: POLL FOR COMPLETION')
    print('=' * 60)

    print('Waiting for bulk search to complete (max 600 seconds)...')
    if not poll_bulk_completion(file_id, headers, len(bulk_data)):
        print('[FAILED] Bulk search timed out')
        return False

    print('[OK] Bulk search completed')

    print('\n' + '=' * 60)
    print('STEP 4: FETCH RESULTS')
    print('=' * 60)

    results = fetch_bulk_results(file_id, headers, lead_keys)
    print(f'[OK] Fetched {len(results)} results')

    if results:
        print('\nResults:')
        for key, result in list(results.items())[:3]:
            print(f'  {key}: {result}')
        if len(results) > 3:
            print(f'  ... and {len(results) - 3} more')
    else:
        print('[FAILED] No results found')

    return len(results) > 0

if __name__ == '__main__':
    success = test_bulk_enrichment()
    print('\n' + '=' * 60)
    if success:
        print('[PASS] Bulk enrichment is working!')
    else:
        print('[FAIL]')
    print('=' * 60)
    sys.exit(0 if success else 1)
