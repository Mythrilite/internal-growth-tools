"""
Email Enricher module using Icypeas API.
Uses parallel processing for faster enrichment.
"""

import time
import requests
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from .config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
    ICYPEAS_POLL_INTERVAL,
    ICYPEAS_POLL_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    ENRICHMENT_WORKERS
)
from .db_logger import PipelineRun


# Thread-safe counter for progress tracking
class ProgressCounter:
    def __init__(self):
        self.count = 0
        self.emails_found = 0
        self.lock = threading.Lock()

    def increment(self, found_email: bool = False):
        with self.lock:
            self.count += 1
            if found_email:
                self.emails_found += 1
            return self.count, self.emails_found


def enrich_with_emails(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Enrich leads with email addresses using Icypeas with parallel processing.

    Args:
        leads: List of lead dictionaries with name and domain
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of leads with email information added
    """
    stage_id = pipeline_run.start_stage('enrich', input_count=len(leads))

    errors = []
    progress = ProgressCounter()

    print(f'Enriching {len(leads)} leads with email addresses using {ENRICHMENT_WORKERS} workers...')

    def enrich_single_lead(lead: Dict[str, Any]) -> Dict[str, Any]:
        """Enrich a single lead (runs in thread pool)."""
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        # Skip if missing required data
        if not domain or (not first_name and not last_name):
            lead['email'] = None
            lead['email_certainty'] = None
            progress.increment(False)
            return lead

        try:
            # Search for email
            email_result = single_email_search(first_name, last_name, domain)

            if email_result:
                lead['email'] = email_result.get('email')
                lead['email_certainty'] = email_result.get('certainty')
                found = bool(lead['email'])
            else:
                lead['email'] = None
                lead['email_certainty'] = None
                found = False

            count, emails_found = progress.increment(found)

            # Progress logging every 10 leads
            if count % 10 == 0 or count == len(leads):
                print(f'  Processed {count}/{len(leads)} leads, found {emails_found} emails')

        except Exception as e:
            lead['email'] = None
            lead['email_certainty'] = None
            errors.append({
                'lead': lead.get('person_name'),
                'domain': domain,
                'error': str(e)
            })
            progress.increment(False)

        return lead

    # Process leads in parallel
    with ThreadPoolExecutor(max_workers=ENRICHMENT_WORKERS) as executor:
        # Submit all tasks
        future_to_lead = {executor.submit(enrich_single_lead, lead): lead for lead in leads}

        # Wait for all to complete
        for future in as_completed(future_to_lead):
            try:
                future.result()
            except Exception as e:
                lead = future_to_lead[future]
                errors.append({
                    'lead': lead.get('person_name'),
                    'error': str(e)
                })

    # Mark all found emails as verified (skip verification step)
    for lead in leads:
        if lead.get('email'):
            lead['email_verified'] = True
        else:
            lead['email_verified'] = False

    success_count = sum(1 for l in leads if l.get('email'))
    print(f'Enrichment complete: {success_count}/{len(leads)} leads with emails found')

    # Log errors to pipeline
    for error in errors:
        pipeline_run.log_error(
            'enrich',
            'SEARCH_ERROR',
            f"Failed to enrich {error.get('lead')}: {error.get('error')}",
            {'domain': error.get('domain')}
        )

    pipeline_run.complete_stage(
        stage_id,
        output_count=success_count,
        error_count=len(errors),
        error_details=errors if errors else None
    )

    return leads


def single_email_search(
    first_name: str,
    last_name: str,
    domain: str
) -> Optional[Dict[str, Any]]:
    """
    Search for a single email using Icypeas.

    Args:
        first_name: Person's first name
        last_name: Person's last name
        domain: Company domain

    Returns:
        Dict with email and certainty, or None
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'firstname': first_name,
        'lastname': last_name,
        'domainOrCompany': domain
    }

    for attempt in range(MAX_RETRIES):
        try:
            # Launch the search
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/email-search',
                headers=headers,
                json=payload,
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    item_id = result.get('item', {}).get('_id')
                    if item_id:
                        # Poll for result
                        return poll_single_search_result(item_id)

            elif response.status_code == 429:
                # Rate limited, wait and retry with backoff
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                time.sleep(wait_time)
                continue

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE ** (attempt + 1))
            continue
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE ** (attempt + 1))
            else:
                raise

    return None


def poll_single_search_result(item_id: str) -> Optional[Dict[str, Any]]:
    """
    Poll for a single search result with exponential backoff.

    Args:
        item_id: The search item ID

    Returns:
        Dict with email and certainty, or None
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    start_time = time.time()
    poll_interval = ICYPEAS_POLL_INTERVAL  # Start at 5s

    while time.time() - start_time < ICYPEAS_POLL_TIMEOUT:
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
                headers=headers,
                json={'id': item_id},
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()

                if result.get('success') and result.get('items'):
                    items = result['items']
                    if items:
                        item = items[0]
                        status = item.get('status')

                        if status in ['DEBITED', 'FOUND', 'NO_RESULT', 'ERROR']:
                            # Search complete
                            results_data = item.get('results', {})
                            emails = results_data.get('emails', [])

                            if emails:
                                # Return best email
                                best = max(emails, key=lambda e: certainty_score(e.get('certainty', '')))
                                return {
                                    'email': best.get('email'),
                                    'certainty': best.get('certainty')
                                }
                            return None

            time.sleep(poll_interval)
            # Exponential backoff: 5s -> 7s -> 10s -> 15s (capped)
            poll_interval = min(poll_interval * 1.5, 15)

        except Exception:
            time.sleep(poll_interval)

    return None


def certainty_score(certainty: str) -> int:
    """Convert certainty string to numeric score."""
    scores = {
        'ultra_sure': 4,
        'sure': 3,
        'likely': 2,
        'maybe': 1,
    }
    return scores.get(certainty, 0)
