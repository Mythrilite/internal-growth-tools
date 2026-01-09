"""
Company Filter module.
Filters job postings by country, employee count, and deduplicates by company.
"""

from typing import List, Dict, Any, Set
from .config import MIN_EMPLOYEES, MAX_EMPLOYEES, ALLOWED_COUNTRIES
from .db_logger import PipelineRun
from .linkedin_scraper import extract_job_data


def filter_companies(
    jobs: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Filter and deduplicate companies from job postings.

    Filters:
    - US-based companies only
    - 11-200 employees
    - Deduplicate by company domain

    Args:
        jobs: Raw job postings from scraper
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of unique, filtered company dictionaries
    """
    stage_id = pipeline_run.start_stage('filter', input_count=len(jobs))

    filtered_companies = []
    seen_domains: Set[str] = set()
    rejection_stats = {
        'no_country': 0,
        'wrong_country': 0,
        'no_employee_count': 0,
        'too_few_employees': 0,
        'too_many_employees': 0,
        'no_domain': 0,
        'duplicate': 0,
    }

    for job in jobs:
        extracted = extract_job_data(job)

        # Check country
        country = extracted.get('country')
        if not country:
            rejection_stats['no_country'] += 1
            continue

        if country not in ALLOWED_COUNTRIES:
            rejection_stats['wrong_country'] += 1
            continue

        # Check employee count
        employee_count = extracted.get('employee_count')
        if employee_count is None:
            rejection_stats['no_employee_count'] += 1
            continue

        if employee_count < MIN_EMPLOYEES:
            rejection_stats['too_few_employees'] += 1
            continue

        if employee_count > MAX_EMPLOYEES:
            rejection_stats['too_many_employees'] += 1
            continue

        # Check domain for deduplication
        domain = extracted.get('company_domain')
        if not domain:
            rejection_stats['no_domain'] += 1
            continue

        if domain in seen_domains:
            rejection_stats['duplicate'] += 1
            continue

        # Company passes all filters
        seen_domains.add(domain)
        filtered_companies.append(extracted)

    # Log filtering results
    print(f'Filtering complete:')
    print(f'  Input jobs: {len(jobs)}')
    print(f'  Unique companies passing filters: {len(filtered_companies)}')
    print(f'  Rejection breakdown:')
    for reason, count in rejection_stats.items():
        if count > 0:
            print(f'    - {reason}: {count}')

    error_details = [{'rejection_stats': rejection_stats}]

    pipeline_run.complete_stage(
        stage_id,
        output_count=len(filtered_companies),
        error_count=sum(rejection_stats.values()),
        error_details=error_details
    )

    return filtered_companies


def filter_software_companies(
    companies: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Additional filter for software/tech companies based on industry and description.

    Note: This is a soft filter that uses keyword matching.
    Most companies from SWE job postings will be software-related.

    Args:
        companies: List of company dictionaries
        pipeline_run: PipelineRun instance for logging

    Returns:
        Filtered list of software companies
    """
    SOFTWARE_KEYWORDS = [
        'software', 'technology', 'tech', 'saas', 'cloud', 'ai', 'ml',
        'machine learning', 'artificial intelligence', 'data', 'analytics',
        'platform', 'digital', 'internet', 'web', 'app', 'mobile',
        'automation', 'devops', 'engineering', 'developer', 'startup',
        'fintech', 'healthtech', 'edtech', 'proptech', 'insurtech',
        'cybersecurity', 'security', 'blockchain', 'crypto', 'api',
    ]

    filtered = []

    for company in companies:
        # Check industries field
        industries = (company.get('industries') or '').lower()
        description = (company.get('company_description') or '').lower()
        job_title = (company.get('job_title') or '').lower()

        # Software engineer jobs almost always indicate a software company
        if 'software' in job_title or 'engineer' in job_title:
            filtered.append(company)
            continue

        # Check for software keywords in industries or description
        is_software = any(
            keyword in industries or keyword in description
            for keyword in SOFTWARE_KEYWORDS
        )

        if is_software:
            filtered.append(company)

    print(f'Software filter: {len(companies)} -> {len(filtered)} companies')

    return filtered


def prepare_for_search(companies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Prepare company data for the decision maker search stage.

    Args:
        companies: Filtered company list

    Returns:
        List of companies with essential fields for searching
    """
    return [
        {
            'company_name': c.get('company_name'),
            'company_domain': c.get('company_domain'),
            'company_website': c.get('company_website'),
            'job_title': c.get('job_title'),  # The role they're hiring for
            'employee_count': c.get('employee_count'),
            'location': c.get('location'),
            'country': c.get('country'),
            'state': c.get('state'),
            'city': c.get('city'),
        }
        for c in companies
        if c.get('company_domain')  # Ensure we have a domain to search
    ]
