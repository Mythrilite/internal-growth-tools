"""
End-to-end test for the email enricher module (single search).
"""

import sys
import os

# Add parent directory to path so we can import the module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set the API key from command line
if len(sys.argv) < 2:
    print("Usage: python test_enrichment_e2e.py YOUR_ICYPEAS_API_KEY")
    sys.exit(1)

os.environ['ICYPEAS_API_KEY'] = sys.argv[1]

# Now import the module (after setting env var)
from pipeline.email_enricher import single_email_search, single_email_verify

print("=" * 60)
print("SINGLE EMAIL SEARCH TEST")
print("=" * 60)

# Test 1: Search for known emails
test_cases = [
    ("Sundar", "Pichai", "google.com"),
    ("Satya", "Nadella", "microsoft.com"),
]

print("\nTesting email search...")
for first, last, domain in test_cases:
    print(f"\n  {first} {last} @ {domain}:")
    result = single_email_search(first, last, domain)
    if result:
        print(f"    Email: {result['email']}")
        print(f"    Certainty: {result['certainty']}")
    else:
        print(f"    No email found")

# Test 2: Verify an email
print("\n" + "=" * 60)
print("EMAIL VERIFICATION TEST")
print("=" * 60)

test_emails = ["sundar@google.com", "fake12345@notreal.xyz"]

for email in test_emails:
    print(f"\n  Verifying: {email}")
    is_valid = single_email_verify(email)
    print(f"    Valid: {is_valid}")

print("\n" + "=" * 60)
print("TESTS COMPLETE!")
print("=" * 60)
