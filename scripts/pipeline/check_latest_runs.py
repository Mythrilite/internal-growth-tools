#!/usr/bin/env python3
"""
Check the latest Apify runs to debug why we're not seeing the newest run.
"""

import sys
from pathlib import Path
from datetime import datetime
import os

# Add parent directory to path for imports
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir.parent.parent))

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv(script_dir.parent.parent / '.env')
except ImportError:
    pass

from apify_client import ApifyClient

APIFY_API_KEY = os.getenv('APIFY_API_KEY', '')
LINKEDIN_SCRAPER_ACTOR = 'curious_coder/linkedin-jobs-scraper'


def check_runs():
    """Check the latest Apify runs."""
    print('=' * 60)
    print('CHECKING LATEST APIFY RUNS')
    print('=' * 60)

    # Initialize client
    client = ApifyClient(APIFY_API_KEY)

    # Get recent runs
    print(f'\nActor: {LINKEDIN_SCRAPER_ACTOR}')
    print('Fetching last 20 runs...\n')

    actor_client = client.actor(LINKEDIN_SCRAPER_ACTOR)
    runs_client = actor_client.runs()

    # Fetch more runs to see if newer ones exist
    runs_list = runs_client.list(limit=20)

    if not runs_list or not runs_list.items:
        print('No runs found')
        return

    print(f'Found {len(runs_list.items)} recent runs:\n')

    for i, run in enumerate(runs_list.items):
        status = run.get('status', 'UNKNOWN')
        run_id = run.get('id', 'N/A')
        started = run.get('startedAt', 'N/A')
        finished = run.get('finishedAt', 'N/A')
        dataset_id = run.get('defaultDatasetId', 'N/A')

        # Parse start time
        if started != 'N/A':
            try:
                start_dt = datetime.fromisoformat(str(started).replace('+00:00', ''))
                started_display = start_dt.strftime('%Y-%m-%d %H:%M:%S')
            except:
                started_display = str(started)
        else:
            started_display = 'N/A'

        print(f'{i+1:2d}. [{status:10s}] {run_id}')
        print(f'    Started:  {started_display}')
        print(f'    Finished: {finished}')
        print(f'    Dataset:  {dataset_id}')

        # Get dataset info if available
        if status == 'SUCCEEDED' and dataset_id != 'N/A':
            try:
                dataset_info = client.dataset(dataset_id).get()
                if dataset_info:
                    item_count = dataset_info.get('itemCount', 'unknown')
                    print(f'    Items:    {item_count}')
            except:
                pass

        print()

    # Find latest SUCCEEDED run
    succeeded_runs = [run for run in runs_list.items if run.get('status') == 'SUCCEEDED']

    if succeeded_runs:
        latest_run = max(succeeded_runs, key=lambda r: r.get('startedAt', ''))
        print('=' * 60)
        print('LATEST SUCCESSFUL RUN:')
        print('=' * 60)
        print(f'Run ID: {latest_run.get("id")}')
        print(f'Started: {latest_run.get("startedAt")}')
        print(f'Dataset: {latest_run.get("defaultDatasetId")}')

        dataset_id = latest_run.get('defaultDatasetId')
        if dataset_id:
            dataset_info = client.dataset(dataset_id).get()
            if dataset_info:
                print(f'Items: {dataset_info.get("itemCount")}')


if __name__ == '__main__':
    check_runs()
