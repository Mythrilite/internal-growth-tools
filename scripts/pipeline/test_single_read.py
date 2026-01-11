"""Quick test of single search read endpoints."""

import sys
import time
import requests

if len(sys.argv) < 2:
    print("Usage: python test_single_read.py API_KEY")
    sys.exit(1)

API_KEY = sys.argv[1]
BASE_URL = 'https://app.icypeas.com/api'

headers = {
    'Authorization': API_KEY,
    'Content-Type': 'application/json'
}

# Step 1: Launch a single search
print("Launching single email search...")
response = requests.post(
    f'{BASE_URL}/email-search',
    headers=headers,
    json={
        'firstname': 'Sundar',
        'lastname': 'Pichai',
        'domainOrCompany': 'google.com'
    },
    timeout=30
)

print(f"Launch response: {response.status_code} - {response.text}")

if response.status_code != 200:
    sys.exit(1)

result = response.json()
item_id = result.get('item', {}).get('_id')
print(f"Item ID: {item_id}")

# Wait a bit
print("\nWaiting 3s...")
time.sleep(3)

# Step 2: Try bulk-single-searchs/read with the item ID
print("\n--- Testing bulk-single-searchs/read endpoint ---\n")

payloads = [
    {'id': item_id},
    {'mode': 'single', 'id': item_id},
    {'ids': [item_id]},
]

for payload in payloads:
    print(f"Payload: {payload}")
    r = requests.post(
        f'{BASE_URL}/bulk-single-searchs/read',
        headers=headers,
        json=payload,
        timeout=10
    )
    print(f"  Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"  Response: {r.text[:300]}...")
        if data.get('success'):
            print("  SUCCESS!")
            break
    print()
