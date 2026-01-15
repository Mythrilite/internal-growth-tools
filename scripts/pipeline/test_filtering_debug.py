#!/usr/bin/env python3
"""
Debug script to test the filtering stage with sample Apify data.
This helps diagnose why companies are being filtered out.
"""

import sys
import json
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.company_filter import filter_companies, filter_software_companies
from pipeline.linkedin_scraper import extract_job_data
from pipeline.db_logger import init_database, PipelineRun

# Sample job data from the user's example
SAMPLE_JOBS = [
    {
        "id": "4295123743",
        "title": "Software Engineer, University Grad",
        "companyName": "Glean",
        "companyLinkedinUrl": "https://www.linkedin.com/company/gleanwork",
        "companyWebsite": "https://glean-it.com/glean",
        "companyDescription": "Work AI for all...",
        "companyEmployeesCount": 1387,
        "location": "Palo Alto, CA",
        "industries": "Software Development",
        "companyAddress": {
            "type": "PostalAddress",
            "addressLocality": "Palo Alto",
            "addressRegion": "CA",
            "postalCode": "94306",
            "addressCountry": "US"
        }
    },
    {
        "id": "4358765684",
        "title": "Software Engineer, Primitive Foundations",
        "companyName": "Notion",
        "companyLinkedinUrl": "https://www.linkedin.com/company/notionhq",
        "companyWebsite": "https://notion.com",
        "companyDescription": "Notion blends your everyday work tools into one...",
        "companyEmployeesCount": 5268,
        "location": "San Francisco, CA",
        "industries": "Software Development",
        "companyAddress": {
            "type": "PostalAddress",
            "addressLocality": "San Francisco",
            "addressRegion": "California",
            "postalCode": "94110",
            "addressCountry": "US"
        }
    },
    {
        "id": "4344847178",
        "title": "Software Engineer",
        "companyName": "Twitch",
        "companyLinkedinUrl": "https://www.linkedin.com/company/twitch-tv",
        "companyWebsite": "http://www.twitch.tv",
        "companyDescription": "Twitch is where thousands of communities come together...",
        "companyEmployeesCount": 17250,
        "location": "San Francisco, CA",
        "industries": "Technology, Information and Internet",
        "companyAddress": {
            "type": "PostalAddress",
            "streetAddress": "350 Bush St",
            "addressLocality": "San Francisco",
            "addressRegion": "California",
            "postalCode": "94101",
            "addressCountry": "US"
        }
    },
    {
        "id": "4344498083",
        "title": "Web Software Engineer",
        "companyName": "Wing",
        "companyLinkedinUrl": "https://www.linkedin.com/company/wing",
        "companyWebsite": "http://wing.com",
        "companyDescription": "Wing offers drone delivery...",
        "companyEmployeesCount": 763,
        "location": "Palo Alto, CA",
        "industries": "Technology, Information and Internet",
        "companyAddress": {
            "type": "PostalAddress",
            "addressLocality": "Palo Alto",
            "addressRegion": "California",
            "postalCode": "94304",
            "addressCountry": "US"
        }
    }
]


def test_filtering():
    """Test filtering with sample job data."""
    print('=' * 60)
    print('FILTERING DEBUG TEST')
    print('=' * 60)

    # Initialize database
    init_database()

    # Create a test pipeline run
    pipeline_run = PipelineRun(config={'test': True})

    print(f'\nTesting with {len(SAMPLE_JOBS)} sample jobs')
    print('\nJob details:')
    for job in SAMPLE_JOBS:
        extracted = extract_job_data(job)
        print(f'\n{extracted["company_name"]}:')
        print(f'  Employees: {extracted["employee_count"]}')
        print(f'  Country: {extracted["country"]}')
        print(f'  Domain: {extracted["company_domain"]}')

    # Test filtering
    print('\n' + '=' * 60)
    print('RUNNING FILTER')
    print('=' * 60)

    filtered_companies = filter_companies(SAMPLE_JOBS, pipeline_run)

    print(f'\n\nRESULTS:')
    print(f'Input: {len(SAMPLE_JOBS)} jobs')
    print(f'Output: {len(filtered_companies)} companies')

    if filtered_companies:
        print('\nCompanies that passed:')
        for company in filtered_companies:
            print(f'  - {company["company_name"]} ({company["employee_count"]} employees)')
    else:
        print('\nNO COMPANIES PASSED THE FILTER!')
        print('\nThis is likely why nothing appears in subsequent stages.')
        print('Check the rejection breakdown above to see why companies were filtered out.')

    # Test software filter
    if filtered_companies:
        print('\n' + '=' * 60)
        print('RUNNING SOFTWARE FILTER')
        print('=' * 60)

        software_companies = filter_software_companies(filtered_companies, pipeline_run)
        print(f'\nSoftware companies: {len(software_companies)}')


if __name__ == '__main__':
    test_filtering()
