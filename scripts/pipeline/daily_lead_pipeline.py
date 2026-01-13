#!/usr/bin/env python3
"""
Daily Lead Generation Pipeline

Autonomous pipeline that runs daily at 7am ET to:
1. Scrape LinkedIn job postings for SWE roles
2. Filter to US software companies with 11-200 employees
3. Find CTOs and engineering leaders at those companies
4. Enrich with verified emails
5. Push to Instantly (email) and Prosp (LinkedIn) campaigns

Usage:
    python daily_lead_pipeline.py [--test]

Options:
    --test    Run in test mode with 100 jobs instead of 10,000
"""

import sys
import time
import argparse
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.config import validate_config, get_job_count
from pipeline.db_logger import init_database, PipelineRun, get_unpushed_leads
from pipeline.linkedin_scraper import scrape_linkedin_jobs
from pipeline.company_filter import filter_companies, filter_software_companies, prepare_for_search
from pipeline.decision_maker_search import search_decision_makers
from pipeline.email_enricher import enrich_with_emails
from pipeline.campaign_pusher import push_to_campaigns


def run_pipeline(test_mode: bool = False) -> dict:
    """
    Execute the full lead generation pipeline.

    Args:
        test_mode: If True, scrape only 100 jobs for testing

    Returns:
        Dictionary with pipeline results and metrics
    """
    print('=' * 60)
    print('DAILY LEAD GENERATION PIPELINE')
    print(f'Started at: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'Mode: {"TEST" if test_mode else "PRODUCTION"}')
    print('=' * 60)

    # Initialize database
    init_database()

    # Validate configuration
    try:
        validate_config()
    except ValueError as e:
        print(f'Configuration error: {e}')
        return {'success': False, 'error': str(e)}

    # Create pipeline run
    config = {
        'test_mode': test_mode,
        'job_count': get_job_count(test_mode),
        'started_at': datetime.utcnow().isoformat()
    }
    pipeline_run = PipelineRun(config=config)

    stage_times = {}
    unpushed_from_previous = []  # Initialize for summary

    try:
        # Stage 1: Scrape LinkedIn jobs
        print('\n' + '=' * 40)
        print('STAGE 1: Scraping LinkedIn Jobs')
        print('=' * 40)

        stage_start = time.time()
        job_count = get_job_count(test_mode)
        jobs = scrape_linkedin_jobs(job_count, pipeline_run)
        stage_times['1_scrape'] = time.time() - stage_start
        print(f'⏱️  Stage 1 completed in {stage_times["1_scrape"]:.1f}s')

        if not jobs:
            raise Exception('No jobs scraped from LinkedIn')

        # Stage 2: Filter companies
        print('\n' + '=' * 40)
        print('STAGE 2: Filtering Companies')
        print('=' * 40)

        stage_start = time.time()
        filtered_companies = filter_companies(jobs, pipeline_run)

        if not filtered_companies:
            raise Exception('No companies passed filtering')

        # Optional: Additional software company filter
        software_companies = filter_software_companies(filtered_companies, pipeline_run)

        # Prepare for search
        companies_to_search = prepare_for_search(software_companies)
        stage_times['2_filter'] = time.time() - stage_start
        print(f'⏱️  Stage 2 completed in {stage_times["2_filter"]:.1f}s')

        print(f'\nCompanies ready for search: {len(companies_to_search)}')

        # Stage 3: Search for decision makers
        print('\n' + '=' * 40)
        print('STAGE 3: Searching for Decision Makers')
        print('=' * 40)

        stage_start = time.time()
        decision_makers = search_decision_makers(companies_to_search, pipeline_run)
        stage_times['3_search'] = time.time() - stage_start
        print(f'⏱️  Stage 3 completed in {stage_times["3_search"]:.1f}s')

        if not decision_makers:
            raise Exception('No decision makers found')

        # Stage 4: Enrich with emails
        print('\n' + '=' * 40)
        print('STAGE 4: Enriching with Emails')
        print('=' * 40)

        stage_start = time.time()
        enriched_leads = enrich_with_emails(decision_makers, pipeline_run)
        stage_times['4_enrich'] = time.time() - stage_start
        print(f'⏱️  Stage 4 completed in {stage_times["4_enrich"]:.1f}s')

        # Stage 5: Validate leads
        print('\n' + '=' * 40)
        print('STAGE 5: Validating Leads')
        print('=' * 40)

        stage_start = time.time()
        stage_id = pipeline_run.start_stage('validate', input_count=len(enriched_leads))

        valid_leads = []
        invalid_count = 0

        for lead in enriched_leads:
            # Check required fields
            has_company = bool(lead.get('company_name'))
            has_name = bool(lead.get('person_first_name') or lead.get('person_name'))
            has_email = bool(lead.get('email'))
            has_linkedin = bool(lead.get('linkedin_url'))

            if has_company and has_name and (has_email or has_linkedin):
                # Store lead in database
                lead_id = pipeline_run.add_lead({
                    **lead,
                    'status': 'validated'
                })
                lead['db_id'] = lead_id
                valid_leads.append(lead)
            else:
                invalid_count += 1
                pipeline_run.add_lead({
                    **lead,
                    'status': 'failed',
                    'failure_reason': 'Missing required fields'
                })

        print(f'Validated: {len(valid_leads)} leads')
        print(f'Invalid: {invalid_count} leads')

        pipeline_run.complete_stage(
            stage_id,
            output_count=len(valid_leads),
            error_count=invalid_count
        )
        stage_times['5_validate'] = time.time() - stage_start
        print(f'⏱️  Stage 5 completed in {stage_times["5_validate"]:.1f}s')

        # Stage 6: Push to campaigns
        print('\n' + '=' * 40)
        print('STAGE 6: Pushing to Campaigns')
        print('=' * 40)

        stage_start = time.time()

        # RESUME CAPABILITY: Check for unpushed leads from previous runs
        unpushed_from_previous = get_unpushed_leads('pushed_prosp')
        if unpushed_from_previous:
            print(f'\n📥 Found {len(unpushed_from_previous)} unpushed leads from previous runs')
            # Convert DB format to lead format and merge with current run's leads
            for lead in unpushed_from_previous:
                lead['db_id'] = lead['id']  # Ensure db_id is set for status updates
            # Combine: current run's validated leads + previous unpushed leads
            all_leads_to_push = valid_leads + unpushed_from_previous
            print(f'   Total leads to push: {len(all_leads_to_push)} ({len(valid_leads)} new + {len(unpushed_from_previous)} from previous)')
        else:
            all_leads_to_push = valid_leads

        push_results = push_to_campaigns(all_leads_to_push, pipeline_run)
        stage_times['6_push'] = time.time() - stage_start
        print(f'⏱️  Stage 6 completed in {stage_times["6_push"]:.1f}s')

        # Complete pipeline run
        pipeline_run.complete('completed')

        # Print timing summary
        total_time = sum(stage_times.values())
        print('\n' + '=' * 60)
        print('TIMING SUMMARY')
        print('=' * 60)
        print(f'Stage 1 (Scrape):   {stage_times.get("1_scrape", 0):>7.1f}s')
        print(f'Stage 2 (Filter):   {stage_times.get("2_filter", 0):>7.1f}s')
        print(f'Stage 3 (Search):   {stage_times.get("3_search", 0):>7.1f}s')
        print(f'Stage 4 (Enrich):   {stage_times.get("4_enrich", 0):>7.1f}s')
        print(f'Stage 5 (Validate): {stage_times.get("5_validate", 0):>7.1f}s')
        print(f'Stage 6 (Push):     {stage_times.get("6_push", 0):>7.1f}s')
        print('-' * 30)
        print(f'TOTAL:              {total_time:>7.1f}s')

        # Print summary
        print('\n' + '=' * 60)
        print('PIPELINE COMPLETE')
        print('=' * 60)
        print(f'Jobs scraped: {len(jobs)}')
        print(f'Companies filtered: {len(filtered_companies)}')
        print(f'Decision makers found: {len(decision_makers)}')
        print(f'Leads enriched: {len(enriched_leads)}')
        print(f'Leads validated: {len(valid_leads)}')
        if unpushed_from_previous:
            print(f'Leads recovered from previous runs: {len(unpushed_from_previous)}')
        print(f'Email campaign: {push_results["email"]["uploaded"]} uploaded')
        print(f'LinkedIn campaign: {push_results["linkedin"]["uploaded"]} uploaded')
        if push_results["linkedin"].get("permanently_failed", 0) > 0:
            print(f'LinkedIn permanently failed: {push_results["linkedin"]["permanently_failed"]} (will retry next run)')
        print(f'Completed at: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
        print('=' * 60)

        return {
            'success': True,
            'run_id': pipeline_run.run_id,
            'metrics': {
                'jobs_scraped': len(jobs),
                'companies_filtered': len(filtered_companies),
                'decision_makers_found': len(decision_makers),
                'leads_enriched': len(enriched_leads),
                'leads_validated': len(valid_leads),
                'email_uploaded': push_results['email']['uploaded'],
                'linkedin_uploaded': push_results['linkedin']['uploaded'],
            }
        }

    except Exception as e:
        error_msg = str(e)
        print(f'\nPIPELINE FAILED: {error_msg}')

        pipeline_run.log_error('pipeline', 'FATAL_ERROR', error_msg)
        pipeline_run.complete('failed', error_msg)

        return {
            'success': False,
            'run_id': pipeline_run.run_id,
            'error': error_msg
        }


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Daily Lead Generation Pipeline'
    )
    parser.add_argument(
        '--test',
        action='store_true',
        help='Run in test mode with 100 jobs instead of 10,000'
    )

    args = parser.parse_args()

    result = run_pipeline(test_mode=args.test)

    if result['success']:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
