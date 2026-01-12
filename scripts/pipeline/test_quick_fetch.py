#!/usr/bin/env python3
"""
Quick test to see if we can fetch results without waiting for polling.
Use an existing file ID if you have one from a recent run.
"""

import sys
import requests
import json

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
)

file_id = input('Enter a bulk search file ID to test: ').strip()
if not file_id:
    print('No file ID provided')
    sys.exit(1)

headers = {
    'Authorization': ICYPEAS_API_KEY,
    'Content-Type': 'application/json'
}

print(f'\nTesting with file ID: {file_id}')
print('=' * 60)

# Try polling first
print('\n1. Polling /search-files/read:')
response = requests.post(
    f'{ICYPEAS_BASE_URL}/search-files/read',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f'Status: {response.status_code}')
print(f'Response: {json.dumps(response.json(), indent=2)}')

# Try fetching results
print('\n2. Fetching /bulk-single-searchs/read:')
response = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
    headers=headers,
    json={'mode': 'bulk', 'file': file_id, 'limit': 10},
    timeout=30
)
print(f'Status: {response.status_code}')
result = response.json()
print(f'Success: {result.get("success")}')
print(f'Items count: {len(result.get("items", []))}')
if result.get('items'):
    print(f'First item: {json.dumps(result["items"][0], indent=2)}')
