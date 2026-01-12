"""
Decision Maker Search module using Exa AI.
Finds CTOs, Heads of Engineering, and similar roles at target companies.
Uses parallel processing for faster execution.
"""

import re
import time
from typing import List, Dict, Any, Optional, Tuple
from exa_py import Exa
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import requests
import json

from .config import (
    EXA_API_KEY,
    EXA_SEARCH_LIMIT,
    EXA_API_DELAY,
    EXA_WORKERS,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE,
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
    LLM_MODEL,
    LLM_VALIDATION_ENABLED,
    MAX_COMPANIES_PER_RUN
)
from .db_logger import PipelineRun


# Patterns to identify decision makers from search results (expanded for more coverage)
TITLE_PATTERNS = [
    # C-Level
    r'\bCTO\b',
    r'\bChief Technology Officer\b',
    r'\bChief Technical Officer\b',
    r'\bCPO\b',
    r'\bChief Product Officer\b',
    # VP Level
    r'\bVP of Engineering\b',
    r'\bVP Engineering\b',
    r'\bVice President.*Engineering\b',
    r'\bVP.*Technology\b',
    r'\bVP of Product\b',
    r'\bVP Product\b',
    # Head/Director Level
    r'\bHead of Engineering\b',
    r'\bHead of Technology\b',
    r'\bHead of Product\b',
    r'\bDirector of Engineering\b',
    r'\bEngineering Director\b',
    r'\bDirector.*Engineering\b',
    r'\bSr\.? Director.*Engineering\b',
    r'\bSenior Director.*Engineering\b',
    # Manager Level (decision makers at smaller companies)
    r'\bEngineering Manager\b',
    r'\bSr\.? Engineering Manager\b',
    r'\bSenior Engineering Manager\b',
    r'\bEngineering Lead\b',
    r'\bLead Engineer\b',
    r'\bPrincipal Engineer\b',
    r'\bStaff Engineer\b',
    r'\bDistinguished Engineer\b',
    # Founders
    r'\bCo-Founder.*CTO\b',
    r'\bFounder.*CTO\b',
    r'\bTechnical Co-Founder\b',
    r'\bFounding Engineer\b',
    r'\bCo-Founder\b',
    r'\bFounder\b',
]

LINKEDIN_URL_PATTERN = re.compile(r'linkedin\.com/in/([a-zA-Z0-9_-]+)')


# Thread-safe counter for progress tracking
class SearchProgressCounter:
    def __init__(self, total: int):
        self.total = total
        self.completed = 0
        self.with_results = 0
        self.people_found = 0
        self.lock = threading.Lock()

    def increment(self, found_count: int = 0):
        with self.lock:
            self.completed += 1
            if found_count > 0:
                self.with_results += 1
                self.people_found += found_count
            return self.completed

    def get_stats(self):
        with self.lock:
            return self.completed, self.with_results, self.people_found


LLM_VALIDATION_PROMPT = """You are validating if a person from a search result is a valid lead for B2B outreach.

TARGET COMPANY: {company_name}
TARGET COMPANY DOMAIN: {company_domain}

SEARCH RESULT:
- Name: {person_name}
- Title: {person_title}
- LinkedIn URL: {linkedin_url}
- Source Title: {source_title}

VALIDATION CRITERIA:
1. Person MUST work at the target company (company name appears in their profile)
2. Person MUST have a decision-maker title: CTO, VP of Engineering, Head of Engineering, Director of Engineering, Technical Co-Founder, Founding Engineer
3. Person MUST have a valid LinkedIn profile URL

Respond with JSON only:
{{"valid": true/false, "reason": "brief explanation"}}"""


def validate_leads_with_llm(
    leads: List[Dict[str, Any]],
    company: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Validate leads using LLM to filter out false positives.

    Args:
        leads: List of lead dictionaries from Exa search
        company: Company dictionary for context

    Returns:
        List of validated leads
    """
    if not LLM_VALIDATION_ENABLED or not OPENROUTER_API_KEY:
        return leads

    if not leads:
        return leads

    validated = []

    for lead in leads:
        prompt = LLM_VALIDATION_PROMPT.format(
            company_name=company.get('company_name', ''),
            company_domain=company.get('company_domain', ''),
            person_name=lead.get('person_name', ''),
            person_title=lead.get('person_title', ''),
            linkedin_url=lead.get('linkedin_url', ''),
            source_title=lead.get('source_title', '')
        )

        try:
            response = requests.post(
                f'{OPENROUTER_BASE_URL}/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': LLM_MODEL,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0,
                    'max_tokens': 100
                },
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                content = result.get('choices', [{}])[0].get('message', {}).get('content', '')

                # Parse JSON response
                try:
                    # Handle markdown code blocks
                    if '```json' in content:
                        content = content.split('```json')[1].split('```')[0]
                    elif '```' in content:
                        content = content.split('```')[1].split('```')[0]

                    validation = json.loads(content.strip())
                    if validation.get('valid', False):
                        validated.append(lead)
                except json.JSONDecodeError:
                    # If we can't parse, include the lead (fail open)
                    validated.append(lead)
        except Exception:
            # On error, include the lead (fail open)
            validated.append(lead)

    return validated


def search_decision_makers(
    companies: List[Dict[str, Any]],
    pipeline_run: PipelineRun
) -> List[Dict[str, Any]]:
    """
    Search for CTOs and engineering leaders at each company using Exa AI.
    Uses parallel processing for faster execution.

    Args:
        companies: List of company dictionaries with domain info
        pipeline_run: PipelineRun instance for logging

    Returns:
        List of decision maker dictionaries with company and person info
    """
    # Apply cap to prevent runaway execution
    if len(companies) > MAX_COMPANIES_PER_RUN:
        print(f'Capping companies from {len(companies)} to {MAX_COMPANIES_PER_RUN}')
        companies = companies[:MAX_COMPANIES_PER_RUN]

    stage_id = pipeline_run.start_stage('search', input_count=len(companies))

    all_decision_makers = []
    all_errors = []
    results_lock = threading.Lock()
    progress = SearchProgressCounter(len(companies))

    print(f'Searching for decision makers at {len(companies)} companies using {EXA_WORKERS} workers...')

    def search_single_company(company: Dict[str, Any], index: int) -> None:
        """Search for decision makers at a single company (runs in thread pool)."""
        # Each thread gets its own Exa client
        exa = Exa(api_key=EXA_API_KEY)

        domain = company.get('company_domain')
        company_name = company.get('company_name')

        if not domain:
            progress.increment(0)
            return

        try:
            # Use people category search with expanded query for better coverage
            query = f'(CTO OR "VP Engineering" OR "Head of Engineering" OR "Director of Engineering" OR "Engineering Manager" OR Founder) at {company_name}'

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
                        time.sleep(wait_time)
                    else:
                        raise

            found_people = []
            if results and results.results:
                found_people = parse_people_search_results(results.results, company)

                if found_people:
                    # Validate with LLM before adding (if enabled)
                    if LLM_VALIDATION_ENABLED and OPENROUTER_API_KEY:
                        found_people = validate_leads_with_llm(found_people, company)

            # Thread-safe append results
            with results_lock:
                if found_people:
                    all_decision_makers.extend(found_people)

            count = progress.increment(len(found_people))

            # Progress logging every 20 companies
            if count % 20 == 0 or count == len(companies):
                completed, with_results, total_people = progress.get_stats()
                print(f'  Progress: {completed}/{len(companies)} companies searched, {total_people} people found')

            # Small delay to avoid rate limiting
            time.sleep(EXA_API_DELAY)

        except Exception as e:
            with results_lock:
                all_errors.append({
                    'company': company_name,
                    'domain': domain,
                    'error': str(e)
                })
            progress.increment(0)
            pipeline_run.log_error(
                'search',
                'API_ERROR',
                f'Error searching {domain}: {str(e)}',
                {'company': company_name, 'domain': domain}
            )

    # Process companies in parallel
    with ThreadPoolExecutor(max_workers=EXA_WORKERS) as executor:
        futures = {executor.submit(search_single_company, company, i): company
                   for i, company in enumerate(companies)}

        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                pass  # Errors already tracked in search_single_company

    completed, with_results, total_people = progress.get_stats()
    print(f'\nSearch complete:')
    print(f'  Companies searched: {completed}')
    print(f'  Companies with results: {with_results}')
    print(f'  Decision makers found: {len(all_decision_makers)}')
    print(f'  Errors: {len(all_errors)}')

    pipeline_run.complete_stage(
        stage_id,
        output_count=len(all_decision_makers),
        error_count=len(all_errors),
        error_details=all_errors if all_errors else None
    )

    return all_decision_makers


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
