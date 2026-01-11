"""Quick inline test."""
import sys
import time
import requests

API_KEY = sys.argv[1] if len(sys.argv) > 1 else ''
BASE_URL = 'https://app.icypeas.com/api'

headers = {
    'Authorization': API_KEY,
    'Content-Type': 'application/json'
}

print("1. Launching email search...")
r1 = requests.post(
    f'{BASE_URL}/email-search',
    headers=headers,
    json={'firstname': 'Sundar', 'lastname': 'Pichai', 'domainOrCompany': 'google.com'},
    timeout=30
)
print(f"   Status: {r1.status_code}")
print(f"   Response: {r1.text}")

if r1.status_code != 200:
    sys.exit(1)

item_id = r1.json().get('item', {}).get('_id')
print(f"   Item ID: {item_id}")

print("\n2. Waiting 2s...")
time.sleep(2)

print("\n3. Reading result...")
r2 = requests.post(
    f'{BASE_URL}/bulk-single-searchs/read',
    headers=headers,
    json={'id': item_id},
    timeout=30
)
print(f"   Status: {r2.status_code}")
print(f"   Response: {r2.text[:500]}...")

if r2.status_code == 200:
    data = r2.json()
    if data.get('success') and data.get('items'):
        item = data['items'][0]
        status = item.get('status')
        print(f"\n   Status: {status}")
        if status == 'DEBITED':
            emails = item.get('results', {}).get('emails', [])
            print(f"   Emails: {emails}")

print("\nDone!")
