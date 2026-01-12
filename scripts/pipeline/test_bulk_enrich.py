#!/usr/bin/env python3
"""
Test script to debug bulk email enrichment.
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

def test_get_user_info():
    """Try to get user info from various endpoints."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('=' * 60)
    print('TRYING TO GET USER ID')
    print('=' * 60)

    # Try various endpoints that might return user info
    endpoints_to_try = [
        '/user',
        '/users/me',
        '/me',
        '/account',
        '/profile',
        '/bulk-single-searchs/read',  # Try fetching existing searches to see user in response
        '/search-files/read',
    ]

    for endpoint in endpoints_to_try:
        print(f'\n[TRY] GET {ICYPEAS_BASE_URL}{endpoint}')
        try:
            response = requests.get(
                f'{ICYPEAS_BASE_URL}{endpoint}',
                headers=headers,
                timeout=10
            )
            print(f'  Status: {response.status_code}')
            if response.status_code == 200:
                result = response.json()
                print(f'  Response: {json.dumps(result, indent=2)[:500]}')
            else:
                print(f'  Response: {response.text[:200]}')
        except Exception as e:
            print(f'  Error: {e}')

        print(f'\n[TRY] POST {ICYPEAS_BASE_URL}{endpoint}')
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}{endpoint}',
                headers=headers,
                json={},
                timeout=10
            )
            print(f'  Status: {response.status_code}')
            if response.status_code == 200:
                result = response.json()
                print(f'  Response: {json.dumps(result, indent=2)[:500]}')

                # Look for user ID in response
                if isinstance(result, dict):
                    if result.get('user'):
                        print(f'\n  FOUND USER ID: {result.get("user")}')
                    if result.get('items'):
                        for item in result['items'][:1]:
                            if item.get('user'):
                                print(f'\n  FOUND USER ID in item: {item.get("user")}')
            else:
                print(f'  Response: {response.text[:200]}')
        except Exception as e:
            print(f'  Error: {e}')


def test_single_search_for_user():
    """Do a single search and look for user ID in response."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('\n' + '=' * 60)
    print('SINGLE SEARCH TO FIND USER ID')
    print('=' * 60)

    payload = {
        'firstname': 'John',
        'lastname': 'Smith',
        'domainOrCompany': 'google.com'
    }

    print(f'\nPOST {ICYPEAS_BASE_URL}/email-search')

    response = requests.post(
        f'{ICYPEAS_BASE_URL}/email-search',
        headers=headers,
        json=payload,
        timeout=30
    )

    print(f'Status: {response.status_code}')
    if response.status_code == 200:
        result = response.json()
        print(f'Full response: {json.dumps(result, indent=2)}')

        # Look for user ID
        if result.get('user'):
            print(f'\nFOUND USER ID: {result.get("user")}')
        if result.get('item', {}).get('user'):
            print(f'\nFOUND USER ID in item: {result["item"]["user"]}')


def test_bulk_with_user(user_id: str = None):
    """Test bulk search with user parameter."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('\n' + '=' * 60)
    print('BULK SEARCH WITH USER PARAMETER')
    print('=' * 60)

    payload = {
        'name': f'debug_test_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
        'task': 'email-search',
        'data': TEST_DATA
    }

    if user_id:
        payload['user'] = user_id

    print(f'Payload: {json.dumps(payload, indent=2)}')

    response = requests.post(
        f'{ICYPEAS_BASE_URL}/bulk-search',
        headers=headers,
        json=payload,
        timeout=60
    )

    print(f'Status: {response.status_code}')
    print(f'Response: {response.text}')


if __name__ == '__main__':
    # First try to find user ID
    test_get_user_info()
    test_single_search_for_user()
