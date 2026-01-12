#!/usr/bin/env python3
"""
Debug script to test bulk search submission and polling in detail.
"""

import sys
import time
import requests
import json
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
    ICYPEAS_POLL_INTERVAL,
    ICYPEAS_POLL_TIMEOUT
)

# Test data - 3 sample leads
TEST_DATA = [
    ['John', 'Smith', 'google.com'],
    ['Jane', 'Doe', 'microsoft.com'],
    ['Bob', 'Johnson', 'amazon.com'],
]

def test_bulk_search():
    """Test bulk search submission and status polling."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('=' * 60)
    print('STEP 1: SUBMIT BULK SEARCH')
    print('=' * 60)

    payload = {
        'name': f'debug_test_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
        'task': 'email-search',
        'data': TEST_DATA
    }

    print(f'Submitting bulk search with {len(TEST_DATA)} leads...')
    print(f'Payload: {json.dumps(payload, indent=2)}')

    response = requests.post(
        f'{ICYPEAS_BASE_URL}/bulk-search',
        headers=headers,
        json=payload,
        timeout=60
    )

    print(f'\nStatus: {response.status_code}')
    print(f'Response: {response.text}')

    if response.status_code != 200:
        print('FAILED TO SUBMIT BULK SEARCH')
        return

    result = response.json()
    file_id = result.get('file')
    print(f'\n✓ File ID: {file_id}')

    # Wait a bit
    print('\nWaiting 2 seconds before polling...')
    time.sleep(2)

    print('\n' + '=' * 60)
    print('STEP 2: POLL FOR COMPLETION')
    print('=' * 60)

    # Try the current endpoint used in email_enricher.py
    print('\n[TRY 1] POST /search-files/read')
    response1 = requests.post(
        f'{ICYPEAS_BASE_URL}/search-files/read',
        headers=headers,
        json={'file': file_id},
        timeout=30
    )
    print(f'Status: {response1.status_code}')
    print(f'Response: {response1.text}')

    # Try alternative endpoints
    print('\n[TRY 2] POST /bulk-single-searchs/read with mode:bulk')
    response2 = requests.post(
        f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
        headers=headers,
        json={'mode': 'bulk', 'file': file_id, 'limit': 100},
        timeout=30
    )
    print(f'Status: {response2.status_code}')
    print(f'Response: {response2.text[:500]}')

    print('\n[TRY 3] POST /bulk-search/read')
    response3 = requests.post(
        f'{ICYPEAS_BASE_URL}/bulk-search/read',
        headers=headers,
        json={'file': file_id},
        timeout=30
    )
    print(f'Status: {response3.status_code}')
    print(f'Response: {response3.text}')

    print('\n[TRY 4] GET /search-files/{file_id}')
    response4 = requests.get(
        f'{ICYPEAS_BASE_URL}/search-files/{file_id}',
        headers=headers,
        timeout=30
    )
    print(f'Status: {response4.status_code}')
    print(f'Response: {response4.text}')

    print('\n[TRY 5] GET /bulk-search/{file_id}')
    response5 = requests.get(
        f'{ICYPEAS_BASE_URL}/bulk-search/{file_id}',
        headers=headers,
        timeout=30
    )
    print(f'Status: {response5.status_code}')
    print(f'Response: {response5.text}')

    print('\n' + '=' * 60)
    print('ANALYSIS')
    print('=' * 60)

    successful_responses = []
    if response1.status_code == 200:
        try:
            data = response1.json()
            if data.get('success'):
                successful_responses.append(('POST /search-files/read', data))
                print('✓ POST /search-files/read returned success')
        except:
            pass

    if response2.status_code == 200:
        try:
            data = response2.json()
            if data.get('success'):
                successful_responses.append(('POST /bulk-single-searchs/read', data))
                print('✓ POST /bulk-single-searchs/read returned success')
        except:
            pass

    if response3.status_code == 200:
        try:
            data = response3.json()
            if data.get('success'):
                successful_responses.append(('POST /bulk-search/read', data))
                print('✓ POST /bulk-search/read returned success')
        except:
            pass

    if response4.status_code == 200:
        try:
            data = response4.json()
            if data.get('success'):
                successful_responses.append(('GET /search-files/{file_id}', data))
                print('✓ GET /search-files/{file_id} returned success')
        except:
            pass

    if response5.status_code == 200:
        try:
            data = response5.json()
            if data.get('success'):
                successful_responses.append(('GET /bulk-search/{file_id}', data))
                print('✓ GET /bulk-search/{file_id} returned success')
        except:
            pass

    if not successful_responses:
        print('\n✗ NONE of the polling endpoints returned success!')
        print('The bulk search may have failed to submit properly.')
    else:
        print(f'\n✓ Found {len(successful_responses)} working endpoint(s)')
        for endpoint, data in successful_responses:
            print(f'\n  {endpoint}:')
            print(f'    {json.dumps(data, indent=6)}')

if __name__ == '__main__':
    test_bulk_search()
