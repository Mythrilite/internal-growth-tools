"""
Decision Maker Search module using Exa AI.
Finds CTOs, Heads of Engineering, and similar roles at target companies.
"""

import re
import time
from typing import List, Dict, Any, Optional, Tuple
from exa_py import Exa

from .config import (
    EXA_API_KEY,
    EXA_SEARCH_LIMIT,
    API_DELAY_SECONDS,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE
)
from .db_logger import PipelineRun


# Patterns to identify decision makers from search results
TITLE_PATTERNS = [
    r'\bCTO\b',
    r'\bChief Technology Officer\b',
    r'\bChief Technical Officer\b',
    r'\bVP of Engineering\b',
    r'\bVice President.*Engineering\b',
    r'\bHead of Engineering\b',
    r'\bDirector of Engineering\b',
    r'\bEngineering Director\b',
    r'\bVP.*Technology\b',
    r'\bHead of Technology\b',
    r'\bCo-Founder.*CTO\b',
    r'\bFounder.*CTO\b',
    r'\bTechnical Co-Founder\b',
    r'\bFounding Engineer\b',
]

LINKEDIN_URL_PATTERN = re.compile(r'linkedin\.com/in/([a-zA-Z0-9_-]+)')


def search_decision_makers(
    companies: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Search for CTOs and engineering leaders at each company using Exa AI.

    Args:
        companies: List of company dictionaries with domain info
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of decision maker dictionaries with company and person info
    """
    stage_id = pipeline_run.start_stage('search', input_count=len(companies))

    exa = Exa(api_key=EXA_API_KEY)
    decision_makers = []
    errors = []
    companies_with_results = 0

    print(f'Searching for decision makers at {len(companies)} companies...')
    import sys
    sys.stdout.flush()

    for i, company in enumerate(companies):
        domain = company.get('company_domain')
        company_name = company.get('company_name')

        if not domain:
            continue

        print(f'  [{i+1}/{len(companies)}] Searching {company_name}...', end=' ')
        sys.stdout.flush()

        try:
            # Use people category search for better results
            query = f"CTO OR Head of Engineering at {company_name}"

            # Search with retry logic
            results = None
            for attempt in range(MAX_RETRIES):
                try:
                    results = exa.search(
                        query,
                        category="people",
                        num_results=EXA_SEARCH_LIMIT
                    )
                    break
                except Exception as e:
                    if attempt < MAX_RETRIES - 1:
                        wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                        print(f'retry in {wait_time}s ({e})', end=' ')
                        sys.stdout.flush()
                        time.sleep(wait_time)
                    else:
                        raise

            if results and results.results:
                found_people = parse_people_search_results(results.results, company)

                if found_people:
                    companies_with_results += 1
                    decision_makers.extend(found_people)
                    print(f'found {len(found_people)} people')
                else:
                    print('no matches')
            else:
                print('no results')

            sys.stdout.flush()

            # Rate limiting
            time.sleep(API_DELAY_SECONDS)

        except Exception as e:
            print(f'ERROR: {e}')
            error_msg = f'Error searching {domain}: {str(e)}'
            errors.append({
                'company': company_name,
                'domain': domain,
                'error': str(e)
            })
            pipeline_run.log_error(
                'search',
                'API_ERROR',
                error_msg,
                {'company': company_name, 'domain': domain}
            )

    print(f'\nSearch complete:')
    print(f'  Companies searched: {len(companies)}')
    print(f'  Companies with results: {companies_with_results}')
    print(f'  Decision makers found: {len(decision_makers)}')
    print(f'  Errors: {len(errors)}')
    sys.stdout.flush()

    print('Completing search stage...')
    sys.stdout.flush()

    pipeline_run.complete_stage(
        stage_id,
        output_count=len(decision_makers),
        error_count=len(errors),
        error_details=errors if errors else None
    )

    return decision_makers


def parse_people_search_results(
    results: List[Any],
    company: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Parse Exa people category search results.

    The people category returns structured data like:
    {
        "title": "Genevieve Eddison | Chief Technology Officer at ShipperHQ",
        "url": "https://linkedin.com/in/genevieve-eddison-31761122",
        "author": "Genevieve Eddison"
    }

    Args:
        results: List of Exa search results
        company: Company dictionary for context

    Returns:
        List of decision maker dictionaries
    """
    found_people = []
    seen_linkedin_urls = set()
    company_name_lower = company.get('company_name', '').lower()

    for result in results:
        url = getattr(result, 'url', '')
        title = getattr(result, 'title', '')
        author = getattr(result, 'author', '')

        # Only process LinkedIn URLs
        if 'linkedin.com/in/' not in url:
            continue

        # Extract LinkedIn URL
        linkedin_match = LINKEDIN_URL_PATTERN.search(url)
        if not linkedin_match:
            continue

        linkedin_url = f"https://www.linkedin.com/in/{linkedin_match.group(1)}"

        # Skip duplicates
        if linkedin_url in seen_linkedin_urls:
            continue
        seen_linkedin_urls.add(linkedin_url)

        # Parse title format: "Name | Title at Company"
        person_name = author if author else None
        person_title = None

        if ' | ' in title:
            parts = title.split(' | ', 1)
            if not person_name:
                person_name = parts[0].strip()
            if len(parts) > 1:
                title_part = parts[1]
                if ' at ' in title_part:
                    person_title = title_part.split(' at ')[0].strip()
                else:
                    person_title = title_part.strip()

        # Check if this person is at the right company
        title_lower = title.lower()
        if company_name_lower and company_name_lower not in title_lower:
            # Person not at this company, skip
            continue

        # Check if this is a decision maker title
        if not is_decision_maker_title(title) and not is_decision_maker_title(person_title or ''):
            continue

        # Skip if no name
        if not person_name:
            continue

        first_name, last_name = split_name(person_name)

        found_people.append({
            # Company info
            'company_name': company.get('company_name'),
            'company_domain': company.get('company_domain'),
            'company_website': company.get('company_website'),
            'job_title': company.get('job_title'),
            'employee_count': company.get('employee_count'),
            'location': company.get('location'),
            # Person info
            'person_name': person_name,
            'person_first_name': first_name,
            'person_last_name': last_name,
            'person_title': person_title or extract_title_from_text(title),
            'linkedin_url': linkedin_url,
            'source_url': url,
            'source_title': title,
        })

    return found_people


def parse_search_results(
    results: List[Any],
    company: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Parse Exa search results to extract decision maker information (legacy).

    Args:
        results: List of Exa search results
        company: Company dictionary for context

    Returns:
        List of decision maker dictionaries
    """
    found_people = []
    seen_linkedin_urls = set()

    for result in results:
        url = getattr(result, 'url', '')
        title = getattr(result, 'title', '')

        # Check if this is a LinkedIn profile
        linkedin_match = LINKEDIN_URL_PATTERN.search(url)
        linkedin_url = None

        if linkedin_match:
            linkedin_url = f"https://www.linkedin.com/in/{linkedin_match.group(1)}"

            # Skip duplicates
            if linkedin_url in seen_linkedin_urls:
                continue
            seen_linkedin_urls.add(linkedin_url)

        # Try to extract name and title from the result
        person_name, person_title = extract_person_info(title, url)

        # Only include if we found a relevant title
        if not is_decision_maker_title(title) and not is_decision_maker_title(person_title):
            continue

        # Skip if no name could be extracted
        if not person_name:
            continue

        first_name, last_name = split_name(person_name)

        found_people.append({
            # Company info
            'company_name': company.get('company_name'),
            'company_domain': company.get('company_domain'),
            'company_website': company.get('company_website'),
            'job_title': company.get('job_title'),  # The role the company is hiring for
            'employee_count': company.get('employee_count'),
            'location': company.get('location'),
            # Person info
            'person_name': person_name,
            'person_first_name': first_name,
            'person_last_name': last_name,
            'person_title': person_title or extract_title_from_text(title),
            'linkedin_url': linkedin_url,
            'source_url': url,
            'source_title': title,
        })

    return found_people


def is_decision_maker_title(text: str) -> bool:
    """Check if text contains a decision maker title."""
    if not text:
        return False

    text_upper = text.upper()
    for pattern in TITLE_PATTERNS:
        if re.search(pattern, text_upper, re.IGNORECASE):
            return True
    return False


def extract_person_info(title: str, url: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract person name and title from search result.

    Args:
        title: Search result title
        url: Search result URL

    Returns:
        Tuple of (name, title) or (None, None)
    """
    person_name = None
    person_title = None

    # Common LinkedIn title format: "Name - Title at Company"
    if ' - ' in title:
        parts = title.split(' - ', 1)
        person_name = parts[0].strip()

        if len(parts) > 1:
            # Extract title (before "at Company")
            title_part = parts[1]
            if ' at ' in title_part:
                person_title = title_part.split(' at ')[0].strip()
            elif '|' in title_part:
                person_title = title_part.split('|')[0].strip()
            else:
                person_title = title_part.strip()

    # Try extracting from URL if it's LinkedIn
    if not person_name and 'linkedin.com/in/' in url:
        match = LINKEDIN_URL_PATTERN.search(url)
        if match:
            # Convert URL slug to name (e.g., "john-doe" -> "John Doe")
            slug = match.group(1)
            name_parts = slug.replace('-', ' ').replace('_', ' ').split()
            person_name = ' '.join(word.capitalize() for word in name_parts if not word.isdigit())

    return person_name, person_title


def extract_title_from_text(text: str) -> str:
    """Extract a clean title from text."""
    for pattern in TITLE_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return 'Engineering Leader'


def split_name(full_name: str) -> Tuple[str, str]:
    """
    Split a full name into first and last name.

    Args:
        full_name: Full name string

    Returns:
        Tuple of (first_name, last_name)
    """
    if not full_name:
        return '', ''

    parts = full_name.strip().split()

    if len(parts) == 1:
        return parts[0], ''
    elif len(parts) == 2:
        return parts[0], parts[1]
    else:
        # First name is first part, last name is everything else
        return parts[0], ' '.join(parts[1:])
