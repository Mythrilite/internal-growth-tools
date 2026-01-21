"""
Email Enricher module using Icypeas API.
Uses bulk search for faster enrichment (single API call for all leads).
"""

import time
import requests
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from .config import (
    ICYPEAS_API_KEY,
    ICYPEAS_BASE_URL,
    ICYPEAS_USER_ID,
    ICYPEAS_POLL_INTERVAL,
    ICYPEAS_POLL_TIMEOUT,
    ICYPEAS_BATCH_SIZE,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    MAX_LEADS_PER_RUN
)
from .db_logger import PipelineRun


def enrich_with_emails(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Enrich leads with email addresses using Icypeas bulk search.

    Args:
        leads: List of lead dictionaries with name and domain
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of leads with email information added
    """
    # Apply cap to prevent runaway execution
    if len(leads) > MAX_LEADS_PER_RUN:
        print(f'Capping leads from {len(leads)} to {MAX_LEADS_PER_RUN}')
        leads = leads[:MAX_LEADS_PER_RUN]

    stage_id = pipeline_run.start_stage('enrich', input_count=len(leads))

    print(f'Enriching {len(leads)} leads with email addresses using bulk search...')

    # Prepare leads for bulk search
    valid_leads = []
    skipped_leads = []

    for lead in leads:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        if domain and (first_name or last_name):
            valid_leads.append(lead)
        else:
            # Skip leads missing required data
            lead['email'] = None
            lead['email_certainty'] = None
            lead['email_verified'] = False
            skipped_leads.append(lead)

    if skipped_leads:
        print(f'  Skipped {len(skipped_leads)} leads missing required data')

    if not valid_leads:
        print('No valid leads to enrich')
        pipeline_run.complete_stage(stage_id, output_count=0, error_count=len(skipped_leads))
        return leads

    # Run bulk search
    try:
        email_results = bulk_email_search(valid_leads, pipeline_run)
        errors = []
    except Exception as e:
        print(f'Bulk search failed: {e}')
        pipeline_run.log_error('enrich', 'BULK_SEARCH_ERROR', str(e))
        email_results = {}
        errors = [{'error': str(e), 'type': 'bulk_search_failure'}]

    # Match results back to leads
    success_count = 0
    for lead in valid_leads:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        # Create lookup key (lowercase for matching)
        key = (first_name.lower(), last_name.lower(), domain.lower())

        result = email_results.get(key)
        if result:
            lead['email'] = result.get('email')
            lead['email_certainty'] = result.get('certainty')
            lead['email_verified'] = True
            success_count += 1
        else:
            lead['email'] = None
            lead['email_certainty'] = None
            lead['email_verified'] = False

    print(f'Enrichment complete: {success_count}/{len(valid_leads)} leads with emails found')
    if success_count == 0 and email_results:
        print(f'  Debug: Got {len(email_results)} results but no matches found')
        print(f'  Sample result keys: {list(email_results.keys())[:3]}')
        print(f'  Sample lead key: {[(l.get("person_first_name", "").lower(), l.get("person_last_name", "").lower(), l.get("company_domain", "").lower()) for l in valid_leads[:1]]}')

    pipeline_run.complete_stage(
        stage_id,
        output_count=success_count,
        error_count=len(errors),
        error_details=errors if errors else None
    )

    return leads


def bulk_email_search(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    """
    Perform bulk email search using Icypeas bulk API.

    Args:
        leads: List of lead dictionaries
        pipeline_run: PipelineRun instance for logging

    Returns:
        Dictionary mapping (firstname, lastname, domain) -> {email, certainty}
    """
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    # Prepare bulk data: [[firstname, lastname, domain], ...]
    bulk_data = []
    lead_keys = []  # Track keys for result matching

    for lead in leads:
        first_name = lead.get('person_first_name', '')
        last_name = lead.get('person_last_name', '')
        domain = lead.get('company_domain', '')

        bulk_data.append([first_name, last_name, domain])
        lead_keys.append((first_name.lower(), last_name.lower(), domain.lower()))

    # Split into batches if needed (max 5000 per bulk search)
    all_results = {}
    batches = [bulk_data[i:i + ICYPEAS_BATCH_SIZE] for i in range(0, len(bulk_data), ICYPEAS_BATCH_SIZE)]
    key_batches = [lead_keys[i:i + ICYPEAS_BATCH_SIZE] for i in range(0, len(lead_keys), ICYPEAS_BATCH_SIZE)]

    for batch_num, (batch, keys) in enumerate(zip(batches, key_batches), 1):
        print(f'  Submitting bulk search batch {batch_num}/{len(batches)} ({len(batch)} leads)...')

        # Submit bulk search
        file_id = submit_bulk_search(batch, headers)
        if not file_id:
            print(f'    Failed to submit batch {batch_num}')
            continue

        print(f'    Bulk search submitted, file ID: {file_id}')

        # Poll for completion
        print(f'    Waiting for bulk search to complete...')
        completed = poll_bulk_completion(file_id, headers, len(batch))
        if not completed:
            print(f'    Bulk search polling timed out for batch {batch_num}, trying to fetch results anyway...')

        # Fetch results (try regardless of poll status, as results may be available)
        print(f'    Fetching results...')
        batch_results = fetch_bulk_results(file_id, headers, keys)
        
        if batch_results:
            all_results.update(batch_results)
            print(f'    Batch {batch_num} got {len(batch_results)} results despite timeout')
        elif not completed:
            print(f'    Batch {batch_num}: No results found')
            continue

        print(f'    Batch {batch_num} complete: {len(batch_results)} emails found')

    return all_results


def submit_bulk_search(data: List[List[str]], headers: Dict[str, str]) -> Optional[str]:
    """
    Submit a bulk email search request.

    Args:
        data: List of [firstname, lastname, domain] arrays
        headers: Request headers with auth

    Returns:
        File ID for the bulk search, or None on failure
    """
    payload = {
        'user': ICYPEAS_USER_ID,
        'name': f'pipeline_bulk_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
        'task': 'email-search',
        'data': data
    }

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-search',
                headers=headers,
                json=payload,
                timeout=60
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    return result.get('file')
                else:
                    print(f'    Bulk search submission failed: {result}')

            elif response.status_code == 429:
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                print(f'    Rate limited, waiting {wait_time}s...')
                time.sleep(wait_time)
                continue

            else:
                print(f'    Bulk search API error: {response.status_code} - {response.text}')

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE ** (attempt + 1))
            continue

        except Exception as e:
            print(f'    Bulk search request error: {e}')
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE ** (attempt + 1))
            else:
                raise

    return None


def poll_bulk_completion(
    file_id: str,
    headers: Dict[str, str],
    total_items: int
) -> bool:
    """
    Poll for bulk search completion.

    Args:
        file_id: The bulk search file ID
        headers: Request headers with auth
        total_items: Total number of items in the bulk search

    Returns:
        True if completed successfully, False on timeout
    """
    start_time = time.time()
    poll_interval = ICYPEAS_POLL_INTERVAL
    last_progress = 0
    poll_count = 0

    while time.time() - start_time < ICYPEAS_POLL_TIMEOUT:
        try:
            poll_count += 1
            response = requests.post(
                f'{ICYPEAS_BASE_URL}/search-files/read',
                headers=headers,
                json={'file': file_id},
                timeout=30
            )

            elapsed = int(time.time() - start_time)
            
            if response.status_code == 200:
                result = response.json()

                if result.get('success'):
                    # Try new format first: files array
                    files = result.get('files', [])
                    if files:
                        file_obj = files[0]
                        status = file_obj.get('status')
                        finished = file_obj.get('finished', False)
                        progress = file_obj.get('progress', 0)

                        # Log progress updates
                        if progress != last_progress:
                            print(f'      Progress: {progress}/{total_items} ({elapsed}s elapsed, poll #{poll_count})')
                            last_progress = progress

                        if status == 'done' or finished:
                            print(f'      Completed! Status={status}, Finished={finished}')
                            return True
                    # Fall back to items format
                    elif result.get('items'):
                        items = result['items']
                        if items:
                            item = items[0]
                            status = item.get('status')
                            finished = item.get('finished', False)
                            progress = item.get('progress', 0)

                            # Log progress updates
                            if progress != last_progress:
                                print(f'      Progress: {progress}/{total_items} ({elapsed}s elapsed, poll #{poll_count})')
                                last_progress = progress

                            if status == 'done' or finished:
                                print(f'      Completed! Status={status}, Finished={finished}')
                                return True
                    else:
                        # Log if we're not getting expected response structure
                        if poll_count % 5 == 1:  # Log every ~5 polls
                            print(f'      Poll #{poll_count} ({elapsed}s elapsed): files={len(files)}, items={bool(result.get("items"))}, keys={list(result.keys())}')
            else:
                print(f'      Poll #{poll_count} returned {response.status_code} after {elapsed}s: {response.text[:150]}')

            time.sleep(poll_interval)
            # Gradual backoff: 5s -> 7s -> 10s -> 15s -> 20s -> 30s -> 60s (capped)
            poll_interval = min(poll_interval * 1.4, 60)

        except Exception as e:
            elapsed = int(time.time() - start_time)
            print(f'      Poll #{poll_count} error after {elapsed}s: {e}')
            time.sleep(poll_interval)

    elapsed = int(time.time() - start_time)
    print(f'      TIMEOUT: Polling took {elapsed}s (limit is {ICYPEAS_POLL_TIMEOUT}s) after {poll_count} polls')
    return False


def fetch_bulk_results(
    file_id: str,
    headers: Dict[str, str],
    lead_keys: List[Tuple[str, str, str]]
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    """
    Fetch results from a completed bulk search.

    Args:
        file_id: The bulk search file ID
        headers: Request headers with auth
        lead_keys: List of (firstname, lastname, domain) keys for matching in order

    Returns:
        Dictionary mapping keys to email results
    """
    results = {}
    has_more = True
    sort_value = None
    page = 0
    MAX_PAGES = 100  # Safety limit: 100 pages * 100 items = 10,000 max results

    while has_more and page < MAX_PAGES:
        try:
            payload = {
                'mode': 'bulk',
                'file': file_id,
                'limit': 100  # Max per request
            }

            if sort_value:
                payload['sort'] = sort_value
                payload['next'] = True

            response = requests.post(
                f'{ICYPEAS_BASE_URL}/bulk-single-searchs/read',
                headers=headers,
                json=payload,
                timeout=60
            )

            if response.status_code == 200:
                result = response.json()

                if result.get('success') and result.get('items'):
                    items = result['items']
                    page += 1
                    
                    if page == 1:
                        print(f'      Fetching results: got {len(items)} items on page 1')
                        if items:
                            print(f'      First item keys: {list(items[0].keys())}')

                    for item in items:
                        # Use order field to match back to original lead
                        # order field tells us which row in the data array this result is for
                        order = item.get('order', -1)
                        
                        if order >= 0 and order < len(lead_keys):
                            # Get the original lead key by position
                            key = lead_keys[order]
                            
                            # Get email results from the results object
                            results_data = item.get('results', {})
                            emails = results_data.get('emails', [])

                            if emails:
                                # Get best email by certainty
                                best = max(emails, key=lambda e: certainty_score(e.get('certainty', '')))
                                results[key] = {
                                    'email': best.get('email'),
                                    'certainty': best.get('certainty')
                                }
                            
                            if page == 1 and len(results) <= 3:
                                # Debug: show what we're extracting
                                found_name = item.get('results', {}).get('fullname', 'N/A')
                                print(f'        Result #{order}: key={key}, found_name={found_name}, has_emails={bool(emails)}')

                    # Check for more pages
                    if len(items) < 100:
                        has_more = False
                    else:
                        # Get sort value for next page
                        last_item = items[-1]
                        sort_value = last_item.get('createdAt') or last_item.get('_id')
                        if not sort_value:
                            has_more = False

                    if page % 5 == 0 or len(items) < 100:
                        print(f'      Fetched {len(results)} results so far (page {page}, got {len(items)} items)...')

                else:
                    if page == 0:
                        print(f'      Fetch returned: success={result.get("success")}, items={bool(result.get("items"))}, keys={list(result.keys())}')
                    has_more = False

            elif response.status_code == 429:
                time.sleep(2)
                continue

            else:
                print(f'      Fetch results error: {response.status_code}: {response.text[:200]}')
                has_more = False

        except Exception as e:
            print(f'      Fetch error: {e}')
            import traceback
            traceback.print_exc()
            has_more = False

    if page >= MAX_PAGES:
        print(f'      WARNING: Hit maximum page limit ({MAX_PAGES} pages). Fetched {len(results)} results.')

    return results


def certainty_score(certainty: str) -> int:
    """Convert certainty string to numeric score."""
    scores = {
        'ultra_sure': 4,
        'sure': 3,
        'likely': 2,
        'maybe': 1,
    }
    return scores.get(certainty, 0)


# Keep single search as fallback (not used in main flow)
def single_email_search(
    first_name: str,
    last_name: str,
    domain: str
) -> Optional[Dict[str, Any]]:
    """
    Search for a single email using Icypeas (fallback method).

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
                        return poll_single_search_result(item_id)

            elif response.status_code == 429:
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
    """Poll for a single search result."""
    headers = {
        'Authorization': ICYPEAS_API_KEY,
        'Content-Type': 'application/json'
    }

    start_time = time.time()
    poll_interval = ICYPEAS_POLL_INTERVAL

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
                            results_data = item.get('results', {})
                            emails = results_data.get('emails', [])

                            if emails:
                                best = max(emails, key=lambda e: certainty_score(e.get('certainty', '')))
                                return {
                                    'email': best.get('email'),
                                    'certainty': best.get('certainty')
                                }
                            return None

            time.sleep(poll_interval)
            poll_interval = min(poll_interval * 1.5, 15)

        except Exception:
            time.sleep(poll_interval)

    return None
