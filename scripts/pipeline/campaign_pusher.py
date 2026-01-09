"""
Campaign Pusher module.
Adds validated leads to Instantly (email) and Prosp (LinkedIn) campaigns.
"""

import time
import requests
from typing import List, Dict, Any, Tuple

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
    BATCH_DELAY_SECONDS
)
from .db_logger import PipelineRun


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

    Args:
        leads: List of validated leads
        pipeline_run: PipelineRun instance for logging

    Returns:
        Push results summary
    """
    stage_id = pipeline_run.start_stage('push_email', input_count=len(leads))

    if not leads:
        pipeline_run.complete_stage(stage_id, output_count=0)
        return {'uploaded': 0, 'failed': 0}

    headers = {
        'Authorization': f'Bearer {INSTANTLY_API_KEY}',
        'Content-Type': 'application/json'
    }

    # Prepare lead data for Instantly
    instantly_leads = []
    for lead in leads:
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

    # Instantly accepts up to 1000 leads per request
    batch_size = 1000
    batches = [instantly_leads[i:i + batch_size] for i in range(0, len(instantly_leads), batch_size)]

    total_uploaded = 0
    total_failed = 0
    errors = []

    print(f'Pushing {len(instantly_leads)} leads to Instantly in {len(batches)} batch(es)...')

    for batch_num, batch in enumerate(batches, 1):
        payload = {
            'leads': batch,
            'campaign_id': INSTANTLY_CAMPAIGN_ID,
            'skip_if_in_workspace': True,  # Don't add duplicates
        }

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

        time.sleep(BATCH_DELAY_SECONDS)

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
        'errors': errors
    }


def push_to_prosp(
    leads: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> Dict[str, Any]:
    """
    Push leads to Prosp LinkedIn campaign.

    Args:
        leads: List of validated leads
        pipeline_run: PipelineRun instance for logging

    Returns:
        Push results summary
    """
    stage_id = pipeline_run.start_stage('push_linkedin', input_count=len(leads))

    if not leads:
        pipeline_run.complete_stage(stage_id, output_count=0)
        return {'uploaded': 0, 'failed': 0}

    total_uploaded = 0
    total_failed = 0
    errors = []

    print(f'Pushing {len(leads)} leads to Prosp...')

    # Prosp adds one lead at a time
    for i, lead in enumerate(leads):
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

        for attempt in range(MAX_RETRIES):
            try:
                response = requests.post(
                    f'{PROSP_API_URL}/leads',
                    headers={'Content-Type': 'application/json'},
                    json=payload,
                    timeout=30
                )

                if response.status_code in [200, 201]:
                    total_uploaded += 1
                    break
                else:
                    if attempt < MAX_RETRIES - 1:
                        wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                        time.sleep(wait_time)
                    else:
                        error_msg = f'Prosp API error: {response.status_code}'
                        errors.append({
                            'lead_index': i,
                            'linkedin_url': lead.get('linkedin_url'),
                            'error': error_msg
                        })
                        total_failed += 1

            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                    time.sleep(wait_time)
                else:
                    errors.append({
                        'lead_index': i,
                        'linkedin_url': lead.get('linkedin_url'),
                        'error': str(e)
                    })
                    total_failed += 1

        # Progress logging
        if (i + 1) % 100 == 0:
            print(f'  Processed {i + 1}/{len(leads)} leads')

        # Small delay to avoid rate limiting
        time.sleep(0.2)

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
