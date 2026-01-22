#!/usr/bin/env python3
"""
Test script to verify we're fetching all data from Apify.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.config import APIFY_API_KEY, LINKEDIN_SCRAPER_ACTOR
from apify_client import ApifyClient


def test_fetch():
    """Test fetching from latest Apify run."""
    print('=' * 60)
    print('TESTING APIFY DATA FETCH')
    print('=' * 60)

    # Initialize client
    client = ApifyClient(APIFY_API_KEY)

    # Get recent runs
    print('\nFetching recent runs...')
    actor_client = client.actor(LINKEDIN_SCRAPER_ACTOR)
    runs_client = actor_client.runs()
    runs_list = runs_client.list(limit=5)

    if not runs_list or not runs_list.items:
        print('No runs found')
        return

    # Find latest successful run
    latest_run = None
    for run in runs_list.items:
        if run.get('status') == 'SUCCEEDED':
            latest_run = run
            break

    if not latest_run:
        print('No successful runs found')
        return

    run_id = latest_run.get('id')
    dataset_id = latest_run.get('defaultDatasetId')

    print(f'\nLatest successful run: {run_id}')
    print(f'Dataset ID: {dataset_id}')
    print(f'Started: {latest_run.get("startedAt")}')
    print(f'Finished: {latest_run.get("finishedAt")}')

    # Method 1: Using iterate_items (current method)
    print('\n--- Method 1: iterate_items() ---')
    jobs_method1 = []
    for item in client.dataset(dataset_id).iterate_items():
        jobs_method1.append(item)
    print(f'Items fetched with iterate_items(): {len(jobs_method1)}')

    # Method 2: Using list_items with explicit pagination
    print('\n--- Method 2: list_items() with pagination ---')
    jobs_method2 = []
    offset = 0
    limit = 1000  # Max per page

    while True:
        print(f'Fetching offset={offset}, limit={limit}...')
        items_page = client.dataset(dataset_id).list_items(offset=offset, limit=limit)

        if not items_page.items:
            break

        jobs_method2.extend(items_page.items)
        print(f'  Got {len(items_page.items)} items (total so far: {len(jobs_method2)})')

        if len(items_page.items) < limit:
            break

        offset += len(items_page.items)

    print(f'\nTotal items with list_items(): {len(jobs_method2)}')

    # Method 3: Check dataset info
    print('\n--- Method 3: Dataset info ---')
    dataset_info = client.dataset(dataset_id).get()
    if dataset_info:
        print(f'Dataset item count: {dataset_info.get("itemCount")}')
        print(f'Dataset clean item count: {dataset_info.get("cleanItemCount")}')

    # Summary
    print('\n' + '=' * 60)
    print('SUMMARY')
    print('=' * 60)
    print(f'iterate_items() fetched: {len(jobs_method1)} items')
    print(f'list_items() fetched: {len(jobs_method2)} items')
    if dataset_info:
        print(f'Dataset reports: {dataset_info.get("itemCount")} items')

    if len(jobs_method1) != len(jobs_method2):
        print('\n⚠️  WARNING: Different counts! iterate_items() may be limited.')
        print(f'   Missing {len(jobs_method2) - len(jobs_method1)} items')
    else:
        print('\n✅ Both methods fetched the same count')


if __name__ == '__main__':
    test_fetch()
