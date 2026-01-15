#!/usr/bin/env python3
"""
Fetch data from most recent Apify LinkedIn scraper run.
This allows analyzing/testing the pipeline without triggering new scrapes.
"""

import sys
import json
from pathlib import Path
from collections import Counter
from apify_client import ApifyClient

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.config import APIFY_API_KEY, LINKEDIN_SCRAPER_ACTOR, DATA_DIR


def fetch_latest_apify_run():
    """Fetch data from the most recent Apify run."""
    print('=' * 60)
    print('FETCHING LATEST APIFY RUN DATA')
    print('=' * 60)

    # Initialize Apify client
    client = ApifyClient(APIFY_API_KEY)
    actor_client = client.actor(LINKEDIN_SCRAPER_ACTOR)
    runs_client = actor_client.runs()

    # Get most recent runs
    print('\nFetching recent runs...')
    runs_list = runs_client.list(limit=10)

    if not runs_list or not runs_list.items:
        print('❌ No runs found for this actor')
        return None

    # Display recent runs
    print(f'\nFound {len(runs_list.items)} recent runs:')
    for i, run in enumerate(runs_list.items):
        status = run.get('status')
        started_at = run.get('startedAt', 'N/A')
        finished_at = run.get('finishedAt', 'N/A')
        run_id = run.get('id')
        dataset_id = run.get('defaultDatasetId')

        print(f'\n{i+1}. Run ID: {run_id}')
        print(f'   Status: {status}')
        print(f'   Started: {started_at}')
        print(f'   Finished: {finished_at}')
        print(f'   Dataset ID: {dataset_id}')

    # Use the most recent SUCCEEDED run
    latest_run = None
    for run in runs_list.items:
        if run.get('status') == 'SUCCEEDED':
            latest_run = run
            break

    if not latest_run:
        print('\n❌ No successful runs found')
        return None

    dataset_id = latest_run.get('defaultDatasetId')
    if not dataset_id:
        print('\n❌ No dataset ID in latest run')
        return None

    print(f'\n✅ Using run: {latest_run.get("id")}')
    print(f'   Dataset ID: {dataset_id}')

    # Fetch all items from the dataset
    print('\nFetching dataset items...')
    dataset_client = client.dataset(dataset_id)

    all_items = []
    offset = 0
    limit = 1000

    while True:
        items_page = dataset_client.list_items(offset=offset, limit=limit)
        if not items_page.items:
            break

        all_items.extend(items_page.items)
        offset += len(items_page.items)
        print(f'  Fetched {len(all_items)} items...')

        if len(items_page.items) < limit:
            break

    print(f'\n✅ Total items fetched: {len(all_items)}')

    # Save to file
    output_file = DATA_DIR / 'latest_apify_run.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_items, f, indent=2, ensure_ascii=False)

    print(f'💾 Saved to: {output_file}')

    return all_items


def analyze_employee_distribution(jobs):
    """Analyze employee count distribution in the jobs data."""
    print('\n' + '=' * 60)
    print('EMPLOYEE COUNT DISTRIBUTION ANALYSIS')
    print('=' * 60)

    employee_counts = []
    no_count = 0

    for job in jobs:
        count = job.get('companyEmployeesCount')
        if count is not None:
            employee_counts.append(count)
        else:
            no_count += 1

    if not employee_counts:
        print('\n❌ No employee count data found')
        return

    employee_counts.sort()
    total = len(employee_counts)

    print(f'\nTotal jobs: {len(jobs)}')
    print(f'Jobs with employee count: {total}')
    print(f'Jobs without employee count: {no_count}')

    # Statistics
    print(f'\nEmployee Count Statistics:')
    print(f'  Minimum: {min(employee_counts):,}')
    print(f'  Maximum: {max(employee_counts):,}')
    print(f'  Median: {employee_counts[total//2]:,}')
    print(f'  Average: {sum(employee_counts)//total:,}')

    # Distribution by ranges
    ranges = {
        '1-10': 0,
        '11-50': 0,
        '51-200': 0,
        '201-500': 0,
        '501-1000': 0,
        '1001-5000': 0,
        '5001-10000': 0,
        '10000+': 0,
    }

    for count in employee_counts:
        if count <= 10:
            ranges['1-10'] += 1
        elif count <= 50:
            ranges['11-50'] += 1
        elif count <= 200:
            ranges['51-200'] += 1
        elif count <= 500:
            ranges['201-500'] += 1
        elif count <= 1000:
            ranges['501-1000'] += 1
        elif count <= 5000:
            ranges['1001-5000'] += 1
        elif count <= 10000:
            ranges['5001-10000'] += 1
        else:
            ranges['10000+'] += 1

    print(f'\nDistribution by Employee Count Range:')
    for range_name, count in ranges.items():
        percentage = (count / total * 100) if total > 0 else 0
        bar = '█' * int(percentage / 2)
        print(f'  {range_name:>15}: {count:>4} ({percentage:>5.1f}%) {bar}')

    # Filter recommendations
    print('\n' + '=' * 60)
    print('FILTER RECOMMENDATIONS')
    print('=' * 60)

    current_min = 11
    current_max = 500

    under_current = sum(1 for c in employee_counts if c < current_min or c > current_max)
    within_current = total - under_current

    print(f'\nCurrent filter: {current_min}-{current_max} employees')
    print(f'  Would pass: {within_current} ({within_current/total*100:.1f}%)')
    print(f'  Would reject: {under_current} ({under_current/total*100:.1f}%)')

    # Test different max values
    test_maxes = [500, 1000, 2000, 5000, 10000, 50000]
    print('\nIf you changed MAX_EMPLOYEES:')
    for max_emp in test_maxes:
        passing = sum(1 for c in employee_counts if current_min <= c <= max_emp)
        print(f'  {current_min:>5}-{max_emp:>6} employees: {passing:>4} companies ({passing/total*100:>5.1f}%)')


def analyze_countries(jobs):
    """Analyze country distribution."""
    print('\n' + '=' * 60)
    print('COUNTRY DISTRIBUTION')
    print('=' * 60)

    countries = Counter()
    no_country = 0

    for job in jobs:
        country = job.get('companyAddress', {}).get('addressCountry')
        if country:
            countries[country] += 1
        else:
            no_country += 1

    print(f'\nTop countries:')
    for country, count in countries.most_common(10):
        print(f'  {country}: {count}')

    if no_country:
        print(f'\nNo country data: {no_country}')


def main():
    """Main entry point."""
    # Fetch data
    jobs = fetch_latest_apify_run()

    if not jobs:
        print('\n❌ Failed to fetch data')
        sys.exit(1)

    # Analyze distributions
    analyze_employee_distribution(jobs)
    analyze_countries(jobs)

    print('\n' + '=' * 60)
    print('✅ DONE')
    print('=' * 60)
    print(f'\nData saved to: {DATA_DIR / "latest_apify_run.json"}')
    print('You can now use this data to test the pipeline without re-scraping.')


if __name__ == '__main__':
    main()
