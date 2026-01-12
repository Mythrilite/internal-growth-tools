#!/usr/bin/env python3
"""
Debug script to test the polling endpoint and understand why it times out.
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
    ICYPEAS_USER_ID,
)

def test_polling():
    """Test the polling mechanism."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    print('=' * 60)
    print('STEP 1: SUBMIT BULK SEARCH')
    print('=' * 60)

    payload = {
        'user': ICYPEAS_USER_ID,
        'task': 'email-search',
        'name': f'debug_poll_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
        'data': [
            ['John', 'Doe', 'google.com'],
            ['Jane', 'Smith', 'microsoft.com'],
        ]
    }

    response = requests.post(
        f'{ICYPEAS_BASE_URL}/bulk-search',
        headers=headers,
        json=payload,
        timeout=60
    )

    print(f'Status: {response.status_code}')
    print(f'Response: {response.text}')

    if response.status_code != 200:
        print('FAILED TO SUBMIT')
        return

    result = response.json()
    if not result.get('success'):
        print(f'API returned success=false: {result}')
        return

    file_id = result.get('file')
    print(f'[OK] File ID: {file_id}')

    print('\n' + '=' * 60)
    print('STEP 2: POLL STATUS IMMEDIATELY')
    print('=' * 60)

    for i in range(5):
        time.sleep(2)
        response = requests.post(
            f'{ICYPEAS_BASE_URL}/search-files/read',
            headers=headers,
            json={'file': file_id},
            timeout=30
        )

        print(f'\nPoll #{i+1} (after {(i+1)*2}s):')
        print(f'Status: {response.status_code}')
        
        if response.status_code == 200:
            result = response.json()
            print(f'Response success: {result.get("success")}')
            print(f'Full response: {json.dumps(result, indent=2)}')
            
            if result.get('success') and result.get('items'):
                items = result['items']
                if items:
                    item = items[0]
                    status = item.get('status')
                    finished = item.get('finished', False)
                    progress = item.get('progress', 0)
                    
                    print(f'\n  Item status: {status}')
                    print(f'  Item finished: {finished}')
                    print(f'  Item progress: {progress}')
                    print(f'  All fields: {list(item.keys())}')
                    
                    if status == 'done' or finished:
                        print(f'\n[OK] Search completed!')
                        break
        else:
            print(f'Response: {response.text[:200]}')

if __name__ == '__main__':
    test_polling()
