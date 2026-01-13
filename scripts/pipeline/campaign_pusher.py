"""
Campaign Pusher module.
Adds validated leads to Instantly (email) and Prosp (LinkedIn) campaigns.

Features:
- Immediate status tracking: Each successful push updates DB immediately
- Resume capability: Skips already-pushed leads on restart
- Retry queue: Failed leads are retried at the end with longer delays
"""

import time
import requests
from typing import List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from .config import (
    INSTANTLY_API_KEY,
    INSTANTLY_API_URL,
    INSTANTLY_CAMPAIGN_ID,
    PROSP_API_KEY,
    PROSP_API_URL,
    PROSP_LIST_ID,
    PROSP_CAMPAIGN_ID,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    PROSP_WORKERS
)
from .db_logger import PipelineRun, bulk_update_lead_status


# Thread-safe counter for Prosp progress
class ProspProgressCounter:
    def __init__(self):
        self.uploaded = 0
        self.failed = 0
        self.lock = threading.Lock()

    def increment_success(self):
        with self.lock:
            self.uploaded += 1
            return self.uploaded

    def increment_failure(self):
        with self.lock:
            self.failed += 1
            return self.failed

    def get_stats(self):
        with self.lock:
            return self.uploaded, self.failed


def validate_leads(leads: List[Dict[str, Any]]) -> Tuple[List[Dict], List[Dict]]:
    """
    Validate leads have required fields for campaigns.

    Required fields:
    - company_name
    - person_first_name (or person_name)
    - email (for Instantly)
    - linkedin_url (for Prosp)

    Args:
        leads: List of lead dictionaries

    Returns:
        Tuple of (valid_for_email, valid_for_linkedin) lead lists
    """
    valid_for_email = []
    valid_for_linkedin = []

    for lead in leads:
        has_company = bool(lead.get('company_name'))
        has_name = bool(lead.get('person_first_name') or lead.get('person_name'))
        has_email = bool(lead.get('email'))
        has_linkedin = bool(lead.get('linkedin_url'))

        # For email campaigns: need company, name, and email
        if has_company and has_name and has_email:
            valid_for_email.append(lead)

        # For LinkedIn campaigns: need LinkedIn URL
        if has_linkedin:
            valid_for_linkedin.append(lead)

    return valid_for_email, valid_for_linkedin


def push_to_campaigns(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> Dict[str, Any]:
    """
    Push validated leads to both Instantly and Prosp campaigns.

    Args:
        leads: List of lead dictionaries
        pipeline_run: PipelineRun instance for logging

    Returns:
        Summary of push results
    """
    # Validate leads
    valid_for_email, valid_for_linkedin = validate_leads(leads)

    print(f'Validated leads:')
    print(f'  Valid for email campaign: {len(valid_for_email)}')
    print(f'  Valid for LinkedIn campaign: {len(valid_for_linkedin)}')

    # Push to Instantly
    email_results = push_to_instantly(valid_for_email, pipeline_run)

    # Push to Prosp
    linkedin_results = push_to_prosp(valid_for_linkedin, pipeline_run)

    return {
        'email': email_results,
        'linkedin': linkedin_results,
        'total_leads': len(leads),
        'valid_for_email': len(valid_for_email),
        'valid_for_linkedin': len(valid_for_linkedin)
    }


def push_to_instantly(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> Dict[str, Any]:
    """
    Push leads to Instantly email campaign.

    Features:
    - Batch push (up to 1000 per request)
    - Immediate status update after successful batch
    - Resume capability: filters out already-pushed leads

    Args:
        leads: List of validated leads
        pipeline_run: PipelineRun instance for logging

    Returns:
        Push results summary
    """
    # Filter out leads already pushed to Instantly (for resume capability)
    leads_to_push = [l for l in leads if l.get('status') != 'pushed_instantly']
    skipped_already_pushed = len(leads) - len(leads_to_push)

    if skipped_already_pushed > 0:
        print(f'  Skipping {skipped_already_pushed} leads already pushed to Instantly')

    stage_id = pipeline_run.start_stage('push_email', input_count=len(leads_to_push))

    if not leads_to_push:
        pipeline_run.complete_stage(stage_id, output_count=0)
        return {'uploaded': 0, 'failed': 0, 'skipped_already_pushed': skipped_already_pushed}

    headers = {
        'Authorization': f'Bearer {INSTANTLY_API_KEY}',
        'Content-Type': 'application/json'
    }

    # Prepare lead data for Instantly, keeping track of db_ids for status updates
    instantly_leads = []
    lead_db_ids = []  # Track db_ids in same order as instantly_leads
    for lead in leads_to_push:
        instantly_lead = {
            'email': lead.get('email'),
            'first_name': lead.get('person_first_name') or lead.get('person_name', '').split()[0],
            'last_name': lead.get('person_last_name', ''),
            'company_name': lead.get('company_name'),
            'website': lead.get('company_website') or f"https://{lead.get('company_domain', '')}",
            'custom_variables': {
                'person_title': lead.get('person_title', ''),
                'hiring_role': lead.get('job_title', ''),
                'employee_count': str(lead.get('employee_count', '')),
                'linkedin_url': lead.get('linkedin_url', ''),
                'location': lead.get('location', ''),
            }
        }
        instantly_leads.append(instantly_lead)
        # Use 'id' for leads from DB, 'db_id' for leads from current run
        lead_db_ids.append(lead.get('id') or lead.get('db_id'))

    # Instantly accepts up to 1000 leads per request
    batch_size = 1000
    batches = [instantly_leads[i:i + batch_size] for i in range(0, len(instantly_leads), batch_size)]
    batch_db_ids = [lead_db_ids[i:i + batch_size] for i in range(0, len(lead_db_ids), batch_size)]

    total_uploaded = 0
    total_failed = 0
    errors = []

    print(f'Pushing {len(instantly_leads)} leads to Instantly in {len(batches)} batch(es)...')

    for batch_num, (batch, db_ids) in enumerate(zip(batches, batch_db_ids), 1):
        payload = {
            'leads': batch,
            'campaign_id': INSTANTLY_CAMPAIGN_ID,
            'skip_if_in_workspace': True,  # Don't add duplicates
        }

        batch_success = False
        for attempt in range(MAX_RETRIES):
            try:
                response = requests.post(
                    f'{INSTANTLY_API_URL}/leads/add',
                    headers=headers,
                    json=payload,
                    timeout=120
                )

                if response.status_code == 200:
                    result = response.json()
                    uploaded = result.get('leads_uploaded', 0)
                    total_uploaded += uploaded
                    skipped = result.get('skipped_count', 0) + result.get('duplicated_leads', 0)

                    print(f'  Batch {batch_num}: {uploaded} uploaded, {skipped} skipped')
                    batch_success = True
                    break
                else:
                    error_msg = f'Instantly API error: {response.status_code} - {response.text}'
                    if attempt < MAX_RETRIES - 1:
                        wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                        print(f'    {error_msg}, retrying in {wait_time}s...')
                        time.sleep(wait_time)
                    else:
                        errors.append({'batch': batch_num, 'error': error_msg})
                        total_failed += len(batch)
                        pipeline_run.log_error('push_email', 'API_ERROR', error_msg)

            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                    time.sleep(wait_time)
                else:
                    errors.append({'batch': batch_num, 'error': str(e)})
                    total_failed += len(batch)
                    pipeline_run.log_error('push_email', 'REQUEST_ERROR', str(e))

        # IMMEDIATE STATUS UPDATE: Mark leads as pushed after successful batch
        if batch_success:
            valid_db_ids = [db_id for db_id in db_ids if db_id is not None]
            if valid_db_ids:
                bulk_update_lead_status(valid_db_ids, 'pushed_instantly')

    print(f'Instantly push complete: {total_uploaded} uploaded, {total_failed} failed')

    pipeline_run.complete_stage(
        stage_id,
        output_count=total_uploaded,
        error_count=total_failed,
        error_details=errors if errors else None
    )

    return {
        'uploaded': total_uploaded,
        'failed': total_failed,
        'skipped_already_pushed': skipped_already_pushed,
        'errors': errors
    }


def push_to_prosp(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> Dict[str, Any]:
    """
    Push leads to Prosp LinkedIn campaign using parallel processing.

    Features:
    - Immediate status update: Each successful push updates DB right away
    - Resume capability: Skips leads already pushed (status='pushed_prosp')
    - Retry queue: Failed leads are retried at the end with longer delays

    Args:
        leads: List of validated leads
        pipeline_run: PipelineRun instance for logging

    Returns:
        Push results summary
    """
    # Filter out leads already pushed to Prosp (for resume capability)
    leads_to_push = [l for l in leads if l.get('status') != 'pushed_prosp']
    skipped_already_pushed = len(leads) - len(leads_to_push)

    if skipped_already_pushed > 0:
        print(f'  Skipping {skipped_already_pushed} leads already pushed to Prosp')

    stage_id = pipeline_run.start_stage('push_linkedin', input_count=len(leads_to_push))

    if not leads_to_push:
        pipeline_run.complete_stage(stage_id, output_count=0)
        return {'uploaded': 0, 'failed': 0, 'skipped_already_pushed': skipped_already_pushed}

    progress = ProspProgressCounter()
    errors = []
    errors_lock = threading.Lock()
    failed_leads = []  # Collect failed leads for retry
    failed_leads_lock = threading.Lock()

    print(f'Pushing {len(leads_to_push)} leads to Prosp using {PROSP_WORKERS} workers...')

    def push_single_lead(lead: Dict[str, Any], index: int, is_retry: bool = False) -> bool:
        """Push a single lead to Prosp (runs in thread pool)."""
        # Get db_id - could be 'id' (from DB) or 'db_id' (from current run)
        db_id = lead.get('id') or lead.get('db_id')

        payload = {
            'api_key': PROSP_API_KEY,
            'linkedin_url': lead.get('linkedin_url'),
            'list_id': PROSP_LIST_ID,
            'campaign_id': PROSP_CAMPAIGN_ID,
            'data': [
                {'property': 'first_name', 'value': lead.get('person_first_name', '')},
                {'property': 'last_name', 'value': lead.get('person_last_name', '')},
                {'property': 'company', 'value': lead.get('company_name', '')},
                {'property': 'title', 'value': lead.get('person_title', '')},
                {'property': 'email', 'value': lead.get('email', '')},
                {'property': 'hiring_role', 'value': lead.get('job_title', '')},
                {'property': 'company_website', 'value': lead.get('company_website', '')},
            ]
        }

        # Use more retries for retry pass
        max_attempts = MAX_RETRIES * 2 if is_retry else MAX_RETRIES
        backoff_multiplier = 2 if is_retry else 1

        for attempt in range(max_attempts):
            try:
                response = requests.post(
                    f'{PROSP_API_URL}/leads',
                    headers={'Content-Type': 'application/json'},
                    json=payload,
                    timeout=30
                )

                if response.status_code in [200, 201]:
                    # IMMEDIATE STATUS UPDATE: Mark as pushed right after success
                    if db_id:
                        try:
                            pipeline_run.update_lead(db_id, {'status': 'pushed_prosp'})
                        except Exception:
                            pass  # Don't fail the push if DB update fails

                    count = progress.increment_success()
                    if count % 50 == 0:
                        print(f'  Uploaded {count}/{len(leads_to_push)} leads to Prosp')
                    return True
                else:
                    if attempt < max_attempts - 1:
                        wait_time = (RETRY_BACKOFF_BASE ** (attempt + 1)) * backoff_multiplier
                        time.sleep(wait_time)
                    else:
                        # Final attempt failed
                        if not is_retry:
                            # Add to retry queue for later
                            with failed_leads_lock:
                                failed_leads.append(lead)
                        else:
                            # Already in retry pass, log error
                            with errors_lock:
                                errors.append({
                                    'lead_index': index,
                                    'linkedin_url': lead.get('linkedin_url'),
                                    'db_id': db_id,
                                    'error': f'Prosp API error: {response.status_code}'
                                })
                        progress.increment_failure()
                        return False

            except Exception as e:
                if attempt < max_attempts - 1:
                    wait_time = (RETRY_BACKOFF_BASE ** (attempt + 1)) * backoff_multiplier
                    time.sleep(wait_time)
                else:
                    if not is_retry:
                        with failed_leads_lock:
                            failed_leads.append(lead)
                    else:
                        with errors_lock:
                            errors.append({
                                'lead_index': index,
                                'linkedin_url': lead.get('linkedin_url'),
                                'db_id': db_id,
                                'error': str(e)
                            })
                    progress.increment_failure()
                    return False

        return False

    # Process leads in parallel
    with ThreadPoolExecutor(max_workers=PROSP_WORKERS) as executor:
        futures = {executor.submit(push_single_lead, lead, i): lead for i, lead in enumerate(leads_to_push)}

        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                pass  # Errors already tracked in push_single_lead

    # RETRY PASS: Try failed leads again with longer delays
    if failed_leads:
        print(f'\n  Retrying {len(failed_leads)} failed leads with longer delays...')
        # Reset failure counter for retry pass
        retry_progress = ProspProgressCounter()

        # Process retries sequentially with longer delays to avoid rate limiting
        for i, lead in enumerate(failed_leads):
            time.sleep(1)  # 1 second delay between retries
            success = push_single_lead(lead, i, is_retry=True)
            if success:
                retry_progress.increment_success()
            else:
                retry_progress.increment_failure()

        retry_success, retry_failed = retry_progress.get_stats()
        print(f'  Retry complete: {retry_success} recovered, {retry_failed} permanently failed')

    total_uploaded, total_failed = progress.get_stats()
    print(f'Prosp push complete: {total_uploaded} uploaded, {total_failed} failed')

    pipeline_run.complete_stage(
        stage_id,
        output_count=total_uploaded,
        error_count=total_failed,
        error_details=errors[:50] if errors else None  # Limit error details
    )

    return {
        'uploaded': total_uploaded,
        'failed': total_failed,
        'skipped_already_pushed': skipped_already_pushed,
        'permanently_failed': len(errors),
        'error_count': len(errors)
    }


def update_lead_statuses(
    leads: List[Dict[str, Any]],
    push_results: Dict[str, Any],
    pipeline_run: PipelineRun
):
    """
    Update lead statuses in the database after pushing.

    Args:
        leads: List of leads
        push_results: Results from push_to_campaigns
        pipeline_run: PipelineRun instance
    """
    valid_for_email, valid_for_linkedin = validate_leads(leads)

    # Update status for leads pushed to email
    for lead in valid_for_email:
        if lead.get('db_id'):
            pipeline_run.update_lead(lead['db_id'], {'status': 'pushed_email'})

    # Update status for leads pushed to LinkedIn
    for lead in valid_for_linkedin:
        if lead.get('db_id'):
            current_status = 'pushed_email' if lead in valid_for_email else 'validated'
            new_status = 'pushed_linkedin' if current_status == 'pushed_email' else 'pushed_linkedin'
            pipeline_run.update_lead(lead['db_id'], {'status': new_status})
