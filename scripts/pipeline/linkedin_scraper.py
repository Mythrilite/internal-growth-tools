"""
LinkedIn Job Scraper module using Apify.
Scrapes job postings to extract company information.
"""

import time
from typing import List, Dict, Any, Optional
from apify_client import ApifyClient

from .config import (
    APIFY_API_KEY,
    LINKEDIN_SCRAPER_ACTOR,
    LINKEDIN_JOB_URL,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE
)
from .db_logger import PipelineRun


def scrape_linkedin_jobs(
    job_count: int,
    pipeline_run: PipelineRun,
    custom_url: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch LinkedIn job postings from the most recent Apify run.

    NOTE: This expects Apify to be running on its own schedule (e.g., 7am daily).
    This function fetches the results from the most recent SUCCEEDED run.

    Args:
        job_count: Expected number of jobs (used for logging only)
        pipeline_run: PipelineRun instance for logging
        custom_url: Not used (kept for compatibility)

    Returns:
        List of job posting dictionaries
    """
    stage_id = pipeline_run.start_stage('scrape', input_count=job_count)
    errors = []
    jobs = []

    try:
        # Initialize Apify client
        client = ApifyClient(APIFY_API_KEY)

        print('Fetching most recent Apify run...')

        # Get recent runs for the LinkedIn scraper actor
        actor_client = client.actor(LINKEDIN_SCRAPER_ACTOR)
        runs_client = actor_client.runs()

        runs_list = runs_client.list(limit=50)

        if not runs_list or not runs_list.items:
            raise Exception('No runs found for LinkedIn scraper actor')

        # Show all recent runs for transparency
        print(f'\nRecent runs (showing last {len(runs_list.items)}):')
        for i, run in enumerate(runs_list.items):
            status = run.get('status')
            run_id = run.get('id')
            started = run.get('startedAt', 'N/A')
            dataset_id = run.get('defaultDatasetId')

            # Get item count for successful runs
            item_count_str = ''
            if status == 'SUCCEEDED' and dataset_id:
                try:
                    dataset_info = client.dataset(dataset_id).get()
                    if dataset_info:
                        item_count = dataset_info.get('itemCount', 'unknown')
                        item_count_str = f' (Items: {item_count})'
                except:
                    pass

            print(f'  {i+1}. [{status}] {run_id} - Started: {started}{item_count_str}')

        # Find the most recent SUCCEEDED run (by startedAt timestamp)
        succeeded_runs = [run for run in runs_list.items if run.get('status') == 'SUCCEEDED']

        if not succeeded_runs:
            raise Exception('No successful runs found. Make sure Apify is scheduled to run before this pipeline.')

        # Sort by startedAt to get the newest (timestamps are ISO format, sortable as strings)
        latest_run = max(succeeded_runs, key=lambda r: r.get('startedAt', ''))

        run_id = latest_run.get('id')
        started_at = latest_run.get('startedAt')
        finished_at = latest_run.get('finishedAt')
        stats = latest_run.get('stats', {})

        print(f'\nUsing most recent successful run: {run_id}')
        print(f'  Started: {started_at}')
        print(f'  Finished: {finished_at}')
        if stats:
            print(f'  Run stats: {stats}')

        # Fetch results from the dataset
        dataset_id = latest_run.get('defaultDatasetId')
        if not dataset_id:
            raise Exception('No dataset ID in latest run')

        print(f'\nFetching results from dataset: {dataset_id}')

        # Check dataset info first
        dataset_info = client.dataset(dataset_id).get()
        if dataset_info:
            item_count = dataset_info.get('itemCount', 'unknown')
            print(f'Dataset reports {item_count} total items')

        # Iterate through all items in the dataset
        print('Fetching items...')
        for item in client.dataset(dataset_id).iterate_items():
            jobs.append(item)
            if len(jobs) % 100 == 0:
                print(f'  Fetched {len(jobs)} items so far...')

        print(f'\n✅ Successfully fetched {len(jobs)} job postings from dataset')
        if dataset_info and dataset_info.get('itemCount'):
            expected = dataset_info.get('itemCount')
            if len(jobs) != expected:
                print(f'⚠️  WARNING: Expected {expected} items but got {len(jobs)}')

        pipeline_run.complete_stage(
            stage_id,
            output_count=len(jobs),
            error_count=len(errors),
            error_details=errors if errors else None
        )

        return jobs

    except Exception as e:
        error_msg = str(e)
        errors.append({
            'error_type': 'API_ERROR',
            'message': error_msg
        })
        pipeline_run.log_error('scrape', 'API_ERROR', error_msg)
        pipeline_run.complete_stage(
            stage_id,
            output_count=len(jobs),
            error_count=1,
            error_details=errors
        )
        raise


def extract_job_data(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract relevant fields from a job posting.

    Args:
        job: Raw job posting from Apify

    Returns:
        Extracted job data dictionary
    """
    company_address = job.get('companyAddress', {})

    return {
        'job_id': job.get('id'),
        'job_title': job.get('title'),
        'job_link': job.get('link'),
        'company_name': job.get('companyName'),
        'company_linkedin_url': job.get('companyLinkedinUrl'),
        'company_website': job.get('companyWebsite'),
        'company_domain': extract_domain(job.get('companyWebsite', '')),
        'company_description': job.get('companyDescription'),
        'employee_count': job.get('companyEmployeesCount'),
        'location': job.get('location'),
        'country': company_address.get('addressCountry'),
        'state': company_address.get('addressRegion'),
        'city': company_address.get('addressLocality'),
        'posted_at': job.get('postedAt'),
        'employment_type': job.get('employmentType'),
        'seniority_level': job.get('seniorityLevel'),
        'industries': job.get('industries'),
    }


def extract_domain(url: str) -> str:
    """
    Extract domain from a URL.

    Args:
        url: Full URL string

    Returns:
        Domain without protocol or path
    """
    if not url:
        return ''

    # Remove protocol
    domain = url.replace('https://', '').replace('http://', '')

    # Remove www prefix
    if domain.startswith('www.'):
        domain = domain[4:]

    # Remove path
    domain = domain.split('/')[0]

    return domain.lower()
