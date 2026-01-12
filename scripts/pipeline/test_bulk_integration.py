#!/usr/bin/env python3
"""
Integration test for bulk email enrichment with the fixed Icypeas API.
Tests the complete flow: submit -> poll -> fetch
"""

import sys
import time

# Add parent directory to path
sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import (
    ICYPEAS_API_KEY,
    ICYPEAS_USER_ID,
)
from pipeline.email_enricher import enrich_with_emails
from pipeline.db_logger import PipelineRun


# Mock pipeline run for testing
class MockPipelineRun:
    def __init__(self):
        self.stages = []

    def start_stage(self, name, **kwargs):
        stage_id = len(self.stages)
        self.stages.append({'name': name, 'id': stage_id, **kwargs})
        return stage_id

    def complete_stage(self, stage_id, **kwargs):
        self.stages[stage_id].update(kwargs)

    def log_error(self, stage, error_type, message, details=None):
        print(f'ERROR [{stage}] {error_type}: {message}')


def test_bulk_enrichment():
    """Test bulk email enrichment with real API."""
    
    print('=' * 60)
    print('ICYPEAS BULK ENRICHMENT INTEGRATION TEST')
    print('=' * 60)

    # Check configuration
    print('\n[CHECK] Configuration')
    if not ICYPEAS_API_KEY:
        print('[FAIL] ICYPEAS_API_KEY not set')
        return False
    if not ICYPEAS_USER_ID:
        print('[FAIL] ICYPEAS_USER_ID not set')
        return False
    print('[OK] API credentials configured')

    # Test data - 5 sample leads
    test_leads = [
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

    print(f'\n[TEST] Enriching {len(test_leads)} leads...')
    pipeline_run = MockPipelineRun()

    try:
        enriched_leads = enrich_with_emails(test_leads, pipeline_run)
        
        # Count results
        emails_found = sum(1 for lead in enriched_leads if lead.get('email'))
        print(f'\n[RESULT] Found {emails_found}/{len(test_leads)} emails')

        if emails_found > 0:
            print('\n[SAMPLE RESULTS]')
            for lead in enriched_leads[:3]:
                if lead.get('email'):
                    print(f"  {lead.get('person_first_name')} {lead.get('person_last_name')}: {lead.get('email')}")
            if len(enriched_leads) > 3:
                print(f'  ... and {sum(1 for l in enriched_leads[3:] if l.get("email"))} more')

        return emails_found > 0

    except Exception as e:
        print(f'\n[ERROR] {e}')
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    print('Starting integration test...\n')
    success = test_bulk_enrichment()
    
    print('\n' + '=' * 60)
    if success:
        print('[PASS] Bulk enrichment is working!')
    else:
        print('[FAIL] Bulk enrichment test failed')
        print('\nTroubleshooting:')
        print('1. Verify ICYPEAS_API_KEY is set in .env')
        print('2. Verify ICYPEAS_USER_ID is set in .env')
        print('3. Check that your Icypeas API key is valid')
        print('4. Check that your user ID matches your Icypeas account')
    print('=' * 60)
    
    sys.exit(0 if success else 1)
