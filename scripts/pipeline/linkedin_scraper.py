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

        runs_list = runs_client.list(limit=10)

        if not runs_list or not runs_list.items:
            raise Exception('No runs found for LinkedIn scraper actor')

        # Find the most recent SUCCEEDED run
        latest_run = None
        for run in runs_list.items:
            if run.get('status') == 'SUCCEEDED':
                latest_run = run
                break

        if not latest_run:
            raise Exception('No successful runs found. Make sure Apify is scheduled to run before this pipeline.')

        run_id = latest_run.get('id')
        started_at = latest_run.get('startedAt')
        finished_at = latest_run.get('finishedAt')

        print(f'Found successful run: {run_id}')
        print(f'  Started: {started_at}')
        print(f'  Finished: {finished_at}')

        # Fetch results from the dataset
        dataset_id = latest_run.get('defaultDatasetId')
        if not dataset_id:
            raise Exception('No dataset ID in latest run')

        print(f'Fetching results from dataset: {dataset_id}')

        # Iterate through all items in the dataset
        for item in client.dataset(dataset_id).iterate_items():
            jobs.append(item)

        print(f'Successfully fetched {len(jobs)} job postings from latest run')

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
