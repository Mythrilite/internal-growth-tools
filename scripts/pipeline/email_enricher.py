"""
Email Enricher module using Icypeas API.
Searches for and verifies email addresses for leads.
"""

import time
import requests
from typing import List, Dict, Any, Optional

from .config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
    ICYPEAS_BATCH_SIZE,
    ICYPEAS_POLL_INTERVAL,
    ICYPEAS_POLL_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE
)
from .db_logger import PipelineRun


def enrich_with_emails(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Enrich leads with email addresses using Icypeas.

    Args:
        leads: List of lead dictionaries with name and domain
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of leads with email information added
    """
    stage_id = pipeline_run.start_stage('enrich', input_count=len(leads))

    enriched_leads = []
    errors = []

    # Split into batches
    batches = [leads[i:i + ICYPEAS_BATCH_SIZE] for i in range(0, len(leads), ICYPEAS_BATCH_SIZE)]

    print(f'Enriching {len(leads)} leads in {len(batches)} batch(es)...')

    for batch_num, batch in enumerate(batches, 1):
        print(f'  Processing batch {batch_num}/{len(batches)} ({len(batch)} leads)...')

        try:
            # Prepare batch data for email search
            search_data = prepare_email_search_batch(batch)

            # Launch bulk email search
            search_id = launch_bulk_search(search_data, f'Pipeline batch {batch_num}')

            if not search_id:
                raise Exception('Failed to launch bulk search')

            # Poll for results
            results = poll_for_results(search_id)

            if results:
                # Match results back to leads
                batch_enriched = match_results_to_leads(batch, results)
                enriched_leads.extend(batch_enriched)

                # Count successes
                success_count = sum(1 for l in batch_enriched if l.get('email'))
                print(f'    Found {success_count}/{len(batch)} emails')

        except Exception as e:
            error_msg = f'Batch {batch_num} failed: {str(e)}'
            errors.append({
                'batch': batch_num,
                'error': str(e),
                'lead_count': len(batch)
            })
            pipeline_run.log_error(
                'enrich',
                'BATCH_ERROR',
                error_msg,
                {'batch_num': batch_num, 'lead_count': len(batch)}
            )
            # Add batch leads without enrichment
            for lead in batch:
                lead['email'] = None
                lead['email_certainty'] = None
                lead['enrichment_failed'] = True
            enriched_leads.extend(batch)

    # Now verify the emails we found
    print('Verifying email addresses...')
    verified_leads = verify_emails(enriched_leads, pipeline_run)

    success_count = sum(1 for l in verified_leads if l.get('email_verified'))
    print(f'Enrichment complete: {success_count}/{len(leads)} leads with verified emails')

    pipeline_run.complete_stage(
        stage_id,
        output_count=success_count,
        error_count=len(errors),
        error_details=errors if errors else None
    )

    return verified_leads


def prepare_email_search_batch(leads: List[Dict[str, Any]]) -> List[List[str]]:
    """
    Prepare leads for Icypeas bulk email search.

    Args:
        leads: List of lead dictionaries

    Returns:
        List of [firstname, lastname, domain] arrays
    """
    batch_data = []

    for lead in leads:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        # Skip if missing required data
        if not domain or (not first_name and not last_name):
            continue

        batch_data.append([first_name, last_name, domain])

    return batch_data


def launch_bulk_search(data: List[List[str]], name: str) -> Optional[str]:
    """
    Launch a bulk email search on Icypeas.

    Args:
        data: List of [firstname, lastname, domain] arrays
        name: Name for the bulk search

    Returns:
        Bulk search ID or None
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'task': 'email-search',
        'name': name,
        'data': data
    }

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk',
                headers=headers,
                json=payload,
                timeout=60
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    return result.get('item', {}).get('_id')
            else:
                print(f'    Icypeas API error: {response.status_code} - {response.text}')

        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                print(f'    Icypeas request failed, retrying in {wait_time}s: {e}')
                time.sleep(wait_time)
            else:
                raise

    return None


def poll_for_results(search_id: str) -> Optional[List[Dict]]:
    """
    Poll Icypeas for bulk search results.

    Args:
        search_id: The bulk search ID

    Returns:
        List of result dictionaries or None
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    start_time = time.time()

    while time.time() - start_time < ICYPEAS_POLL_TIMEOUT:
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
                headers=headers,
                json={'id': search_id},
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()

                if result.get('success') and result.get('items'):
                    items = result['items']

                    # Check if all items are complete
                    statuses = [item.get('status') for item in items]

                    if all(s in ['DEBITED', 'NO_RESULT', 'ERROR'] for s in statuses):
                        return items

            time.sleep(ICYPEAS_POLL_INTERVAL)

        except Exception as e:
            print(f'    Poll error: {e}')
            time.sleep(ICYPEAS_POLL_INTERVAL)

    print('    Warning: Poll timeout reached')
    return None


def match_results_to_leads(
    leads: List[Dict[str, Any]],
    results: List[Dict]
) -> List[Dict[str, Any]]:
    """
    Match Icypeas results back to the original leads.

    Args:
        leads: Original lead list
        results: Icypeas search results

    Returns:
        Leads with email information added
    """
    # Build a lookup by order (Icypeas returns results in same order as input)
    result_index = 0

    for lead in leads:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        # Skip leads that weren't included in the search
        if not domain or (not first_name and not last_name):
            continue

        if result_index < len(results):
            result = results[result_index]
            result_data = result.get('results', {})

            emails = result_data.get('emails', [])
            if emails:
                # Take the best email (highest certainty)
                best_email = max(emails, key=lambda e: certainty_score(e.get('certainty', '')))
                lead['email'] = best_email.get('email')
                lead['email_certainty'] = best_email.get('certainty')
            else:
                lead['email'] = None
                lead['email_certainty'] = None

            result_index += 1

    return leads


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
    Verify email addresses using Icypeas.

    Args:
        leads: List of leads with email addresses
        pipeline_run: PipelineRun instance for logging

    Returns:
        Leads with verification status added
    """
    # Get leads that have emails to verify
    leads_with_emails = [l for l in leads if l.get('email')]

    if not leads_with_emails:
        return leads

    # Prepare verification batch
    verify_data = [[l['email']] for l in leads_with_emails]

    try:
        # Launch bulk verification
        search_id = launch_bulk_verification(verify_data, 'Email verification')

        if search_id:
            results = poll_for_results(search_id)

            if results:
                # Update leads with verification status
                for i, lead in enumerate(leads_with_emails):
                    if i < len(results):
                        result = results[i]
                        result_data = result.get('results', {})
                        # Icypeas verification returns validity info
                        lead['email_verified'] = result_data.get('valid', False)
                    else:
                        lead['email_verified'] = False

    except Exception as e:
        print(f'    Email verification failed: {e}')
        pipeline_run.log_error(
            'enrich',
            'VERIFICATION_ERROR',
            str(e)
        )
        # Mark all as unverified
        for lead in leads_with_emails:
            lead['email_verified'] = False

    return leads


def launch_bulk_verification(data: List[List[str]], name: str) -> Optional[str]:
    """
    Launch a bulk email verification on Icypeas.

    Args:
        data: List of [email] arrays
        name: Name for the bulk verification

    Returns:
        Bulk search ID or None
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'task': 'email-verification',
        'name': name,
        'data': data
    }

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk',
                headers=headers,
                json=payload,
                timeout=60
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    return result.get('item', {}).get('_id')

        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                time.sleep(wait_time)
            else:
                raise

    return None
