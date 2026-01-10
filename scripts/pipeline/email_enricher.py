"""
Email Enricher module using Icypeas API.
Uses single email search for reliability (bulk API was unreliable).
"""

import time
import requests
from typing import List, Dict, Any, Optional

from .config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
    ICYPEAS_POLL_INTERVAL,
    ICYPEAS_POLL_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    API_DELAY_SECONDS
)
from .db_logger import PipelineRun


def enrich_with_emails(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Enrich leads with email addresses using Icypeas single search.

    Args:
        leads: List of lead dictionaries with name and domain
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of leads with email information added
    """
    stage_id = pipeline_run.start_stage('enrich', input_count=len(leads))

    errors = []
    emails_found = 0

    print(f'Enriching {len(leads)} leads with email addresses...')

    for i, lead in enumerate(leads):
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        # Skip if missing required data
        if not domain or (not first_name and not last_name):
            lead['email'] = None
            lead['email_certainty'] = None
            continue

        try:
            # Search for email
            email_result = single_email_search(first_name, last_name, domain)

            if email_result:
                lead['email'] = email_result.get('email')
                lead['email_certainty'] = email_result.get('certainty')
                if lead['email']:
                    emails_found += 1
            else:
                lead['email'] = None
                lead['email_certainty'] = None

        except Exception as e:
            lead['email'] = None
            lead['email_certainty'] = None
            errors.append({
                'lead': lead.get('person_name'),
                'domain': domain,
                'error': str(e)
            })
            pipeline_run.log_error(
                'enrich',
                'SEARCH_ERROR',
                f"Failed to enrich {lead.get('person_name')}: {e}",
                {'domain': domain}
            )

        # Progress logging
        if (i + 1) % 10 == 0 or (i + 1) == len(leads):
            print(f'  Processed {i + 1}/{len(leads)} leads, found {emails_found} emails')

        # Rate limiting between requests
        if i < len(leads) - 1:
            time.sleep(API_DELAY_SECONDS)

    # Now verify the emails we found
    print('Verifying email addresses...')
    verified_leads = verify_emails(leads, pipeline_run)

    success_count = sum(1 for l in verified_leads if l.get('email_verified'))
    print(f'Enrichment complete: {success_count}/{len(leads)} leads with verified emails')

    pipeline_run.complete_stage(
        stage_id,
        output_count=success_count,
        error_count=len(errors),
        error_details=errors if errors else None
    )

    return verified_leads


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
                # Rate limited, wait and retry
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                time.sleep(wait_time)
                continue
            else:
                print(f'    Icypeas API error: {response.status_code}')

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
    Poll for a single search result.

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

    while time.time() - start_time < ICYPEAS_POLL_TIMEOUT:
        try:
            # Use bulk-single-searchs/read endpoint (works for both single and bulk)
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
                headers=headers,
                json={'id': item_id},
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()

                # Response returns items array
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

            time.sleep(ICYPEAS_POLL_INTERVAL)

        except Exception:
            time.sleep(ICYPEAS_POLL_INTERVAL)

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


def verify_emails(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Verify email addresses using Icypeas single verification.

    Args:
        leads: List of leads with email addresses
        pipeline_run: PipelineRun instance for logging

    Returns:
        Leads with verification status added
    """
    leads_with_emails = [l for l in leads if l.get('email')]

    if not leads_with_emails:
        return leads

    print(f'  Verifying {len(leads_with_emails)} emails...')

    for i, lead in enumerate(leads_with_emails):
        try:
            is_valid = single_email_verify(lead['email'])
            lead['email_verified'] = is_valid
        except Exception as e:
            lead['email_verified'] = False
            pipeline_run.log_error(
                'enrich',
                'VERIFY_ERROR',
                f"Failed to verify {lead['email']}: {e}"
            )

        # Rate limiting
        if i < len(leads_with_emails) - 1:
            time.sleep(API_DELAY_SECONDS)

    return leads


def single_email_verify(email: str) -> bool:
    """
    Verify a single email address.

    Args:
        email: Email address to verify

    Returns:
        True if valid, False otherwise
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'email': email
    }

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/email-verification',
                headers=headers,
                json=payload,
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    item_id = result.get('item', {}).get('_id')
                    if item_id:
                        return poll_single_verify_result(item_id)

        except Exception:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE ** (attempt + 1))
            continue

    return False


def poll_single_verify_result(item_id: str) -> bool:
    """
    Poll for a single verification result.

    Args:
        item_id: The verification item ID

    Returns:
        True if email is valid, False otherwise
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    start_time = time.time()

    while time.time() - start_time < ICYPEAS_POLL_TIMEOUT:
        try:
            # Use bulk-single-searchs/read endpoint (works for both single and bulk)
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
                headers=headers,
                json={'id': item_id},
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()

                # Response returns items array
                if result.get('success') and result.get('items'):
                    items = result['items']
                    if items:
                        item = items[0]
                        status = item.get('status')

                        if status in ['DEBITED', 'FOUND', 'NO_RESULT', 'ERROR']:
                            results_data = item.get('results', {})
                            return results_data.get('valid', False)

            time.sleep(ICYPEAS_POLL_INTERVAL)

        except Exception:
            time.sleep(ICYPEAS_POLL_INTERVAL)

    return False
