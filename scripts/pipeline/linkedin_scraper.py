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
    Scrape LinkedIn job postings using Apify.

    Args:
        job_count: Number of jobs to scrape
        pipeline_run: PipelineRun instance for logging
        custom_url: Optional custom LinkedIn jobs search URL

    Returns:
        List of job posting dictionaries
    """
    stage_id = pipeline_run.start_stage('scrape', input_count=job_count)
    errors = []
    jobs = []

    try:
        # Initialize Apify client
        client = ApifyClient(APIFY_API_KEY)

        # Prepare the Actor input
        run_input = {
            'urls': [custom_url or LINKEDIN_JOB_URL],
            'count': job_count,
        }

        print(f'Starting LinkedIn job scrape for {job_count} jobs...')

        # Start the Actor run (async)
        run = None
        for attempt in range(MAX_RETRIES):
            try:
                run = client.actor(LINKEDIN_SCRAPER_ACTOR).start(run_input=run_input)
                break
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                    print(f'Apify API error, retrying in {wait_time}s: {e}')
                    time.sleep(wait_time)
                else:
                    raise

        if not run:
            raise Exception('Failed to start Apify actor after retries')

        run_id = run.get('id')
        print(f'Actor run started: {run_id}')
        print(f'Waiting for run to complete (estimated ~7 minutes for {job_count} jobs)...')

        # Poll until run completes (with 60-second wait intervals)
        max_wait_time = 900  # 15 minutes max
        elapsed = 0
        poll_interval = 60  # Check every 60 seconds

        while elapsed < max_wait_time:
            run = client.run(run_id).get()
            status = run.get('status')

            if status == 'SUCCEEDED':
                print(f'Run completed successfully in ~{elapsed}s')
                break
            elif status in ['FAILED', 'ABORTED', 'TIMED-OUT']:
                raise Exception(f'Actor run {status}: {run.get("statusMessage", "Unknown error")}')

            # Still running
            time.sleep(poll_interval)
            elapsed += poll_interval
            print(f'  Still running... ({elapsed}s elapsed)')

        if elapsed >= max_wait_time:
            raise Exception(f'Actor run timed out after {max_wait_time}s')

        # Fetch results from the dataset
        dataset_id = run.get('defaultDatasetId')
        if not dataset_id:
            raise Exception('No dataset ID returned from Apify run')

        print(f'Fetching results from dataset: {dataset_id}')

        # Iterate through all items in the dataset
        for item in client.dataset(dataset_id).iterate_items():
            jobs.append(item)

        print(f'Successfully scraped {len(jobs)} job postings')

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
