"""
Test script for Icypeas API to debug email enrichment.
Run with: python test_icypeas.py YOUR_API_KEY
"""

import sys
import time
import requests
import json

if len(sys.argv) < 2:
    print("Usage: python test_icypeas.py YOUR_ICYPEAS_API_KEY")
    sys.exit(1)

ICYPEAS_API_KEY = sys.argv[1]
ICYPEAS_BASE_URL = 'https://app.icypeas.com/api'

print(f"API Key (first 10 chars): {ICYPEAS_API_KEY[:10]}...")
print(f"Base URL: {ICYPEAS_BASE_URL}")
print()

headers = {
    'Authorization': ICYPEAS_API_KEY,
    'Content-Type': 'application/json'
}

# Step 1: Launch a bulk search
print("=" * 50)
print("STEP 1: Launch bulk search via /bulk-search")
print("=" * 50)

bulk_data = [
    ["Sundar", "Pichai", "google.com"],
    ["Satya", "Nadella", "microsoft.com"]
]

bulk_payload = {
    'task': 'email-search',
    'name': 'Test Bulk Search',
    'data': bulk_data
}

response1 = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-search',
    headers=headers,
    json=bulk_payload,
    timeout=60
)

print(f"Status Code: {response1.status_code}")
print(f"Response: {response1.text}")

if response1.status_code != 200:
    print("Bulk search failed!")
    sys.exit(1)

result = response1.json()
file_id = result.get('file')
print(f"File ID: {file_id}")
print()

# Wait for processing
print("Waiting 5s for processing...")
time.sleep(5)

# Step 2: Try different endpoints to read results
print("=" * 50)
print("STEP 2: Try reading results")
print("=" * 50)

# Try A: /bulk-single-searchs/read with mode: bulk
print("\nA) POST /bulk-single-searchs/read with mode:bulk, file:fileId")
responseA = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
    headers=headers,
    json={'mode': 'bulk', 'file': file_id, 'limit': 100},
    timeout=30
)
print(f"Status: {responseA.status_code}")
print(f"Response: {responseA.text[:500] if len(responseA.text) > 500 else responseA.text}")

# Try B: /bulk-search/read
print("\nB) POST /bulk-search/read")
responseB = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-search/read',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f"Status: {responseB.status_code}")
print(f"Response: {responseB.text[:500] if len(responseB.text) > 500 else responseB.text}")

# Try C: /bulk-searchs/read
print("\nC) POST /bulk-searchs/read")
responseC = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-searchs/read',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f"Status: {responseC.status_code}")
print(f"Response: {responseC.text[:500] if len(responseC.text) > 500 else responseC.text}")

# Try D: GET /bulk-search/{file_id}
print("\nD) GET /bulk-search/{file_id}")
responseD = requests.get(
    f'{ICYPEAS_BASE_URL}/bulk-search/{file_id}',
    headers=headers,
    timeout=30
)
print(f"Status: {responseD.status_code}")
print(f"Response: {responseD.text[:500] if len(responseD.text) > 500 else responseD.text}")

# Try E: /bulk-search/results
print("\nE) POST /bulk-search/results")
responseE = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-search/results',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f"Status: {responseE.status_code}")
print(f"Response: {responseE.text[:500] if len(responseE.text) > 500 else responseE.text}")

# Try F: /bulk/results
print("\nF) POST /bulk/results")
responseF = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk/results',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f"Status: {responseF.status_code}")
print(f"Response: {responseF.text[:500] if len(responseF.text) > 500 else responseF.text}")

# Try G: /bulk-search/status
print("\nG) POST /bulk-search/status")
responseG = requests.post(
    f'{ICYPEAS_BASE_URL}/bulk-search/status',
    headers=headers,
    json={'file': file_id},
    timeout=30
)
print(f"Status: {responseG.status_code}")
print(f"Response: {responseG.text[:500] if len(responseG.text) > 500 else responseG.text}")

print()
print("=" * 50)
print("TESTS COMPLETE")
print("=" * 50)
