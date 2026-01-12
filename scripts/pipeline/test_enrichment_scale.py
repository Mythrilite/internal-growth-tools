#!/usr/bin/env python3
"""
Scale test for email enrichment: 100 vs 1000 leads
"""

import sys
import time
import random

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import ICYPEAS_API_KEY, ICYPEAS_USER_ID
from pipeline.email_enricher import enrich_with_emails
from pipeline.db_logger import PipelineRun


# Mock pipeline run for testing
class MockPipelineRun:
    def __init__(self):
        self.stages = []
        self.run_id = 'test-run'

    def start_stage(self, name, **kwargs):
        stage_id = len(self.stages)
        self.stages.append({'name': name, 'id': stage_id, **kwargs})
        return stage_id

    def complete_stage(self, stage_id, **kwargs):
        self.stages[stage_id].update(kwargs)

    def add_lead(self, lead):
        return f"lead-{len(self.stages)}"

    def log_error(self, stage, error_type, message, details=None):
        pass


def generate_test_leads(count):
    """Generate test leads with random names and domains."""
    domains = [
        'google.com', 'microsoft.com', 'amazon.com', 'apple.com', 'meta.com',
        'netflix.com', 'uber.com', 'airbnb.com', 'slack.com', 'stripe.com',
        'shopify.com', 'figma.com', 'notion.so', 'github.com', 'gitlab.com',
    ]
    
    first_names = [
        'John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana', 'Eve', 'Frank',
        'Grace', 'Henry', 'Iris', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah',
        'Olivia', 'Peter', 'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor'
    ]
    
    last_names = [
        'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
        'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
        'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'
    ]
    
    leads = []
    for i in range(count):
        leads.append({
            'person_first_name': random.choice(first_names),
            'person_last_name': random.choice(last_names),
            'company_domain': random.choice(domains),
        })
    
    return leads


def test_enrichment(count, label):
    """Test enrichment with given number of leads."""
    print(f'\n{"=" * 60}')
    print(f'TEST: Enriching {count} leads')
    print(f'{"=" * 60}')
    
    if not ICYPEAS_API_KEY:
        print('ERROR: ICYPEAS_API_KEY not set')
        return False
    
    if not ICYPEAS_USER_ID:
        print('ERROR: ICYPEAS_USER_ID not set')
        return False
    
    leads = generate_test_leads(count)
    pipeline_run = MockPipelineRun()
    
    start_time = time.time()
    enriched_leads = enrich_with_emails(leads, pipeline_run)
    elapsed = time.time() - start_time
    
    # Count results
    emails_found = sum(1 for lead in enriched_leads if lead.get('email'))
    success_rate = (emails_found / len(leads)) * 100 if leads else 0
    
    print(f'\nResults:')
    print(f'  Time: {elapsed:.1f}s')
    print(f'  Emails found: {emails_found}/{len(leads)} ({success_rate:.1f}%)')
    print(f'  Per-lead average: {elapsed/len(leads):.2f}s')
    
    return elapsed, emails_found, len(leads)


if __name__ == '__main__':
    print('\nBulk Enrichment Scale Test')
    
    # Get lead count from command line or default
    test_count = 1000
    if len(sys.argv) > 1:
        try:
            test_count = int(sys.argv[1])
        except ValueError:
            print(f'Usage: python test_enrichment_scale.py [lead_count]')
            sys.exit(1)
    
    print(f'Testing with {test_count} leads')
    
    results = {}
    result = test_enrichment(test_count, f'{test_count} leads')
    if result:
        results[str(test_count)] = result
    
    # Summary
    print(f'\n{"=" * 60}')
    print('SUMMARY')
    print(f'{"=" * 60}')
    
    for count_str, (t, e, c) in results.items():
        print(f'{count_str} leads:  {t:>7.1f}s, {e:>3} emails found, {(e/c)*100:.1f}% success rate')
