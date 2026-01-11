"""
Database logger module for tracking pipeline runs, metrics, and errors.
Uses SQLite for persistent storage.
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

from .config import DATABASE_PATH


def init_database():
    """Initialize the database with schema and optimizations."""
    schema_path = Path(__file__).parent / 'schema.sql'
    with open(schema_path, 'r') as f:
        schema = f.read()

    with get_connection() as conn:
        # Set up optimizations for concurrent access
        conn.execute('PRAGMA journal_mode=WAL')  # Write-Ahead Logging for better concurrency
        conn.execute('PRAGMA synchronous=NORMAL')  # Balance safety and speed
        conn.execute('PRAGMA cache_size=10000')  # Larger cache
        conn.execute('PRAGMA temp_store=MEMORY')  # Use memory for temp storage
        
        conn.executescript(schema)
        conn.commit()


@contextmanager
def get_connection():
    """Context manager for database connections with lock timeout."""
    conn = sqlite3.connect(str(DATABASE_PATH), timeout=30.0)  # 30 second timeout for locks
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


class PipelineRun:
    """Manages a single pipeline run and its associated logging."""

    def __init__(self, run_id: Optional[int] = None, config: Optional[Dict] = None):
        self.run_id = run_id
        self.config = config or {}

        if run_id is None:
            self._create_run()

    def _create_run(self):
        """Create a new pipeline run record."""
        with get_connection() as conn:
            cursor = conn.execute(
                '''INSERT INTO pipeline_runs (config_json) VALUES (?)''',
                (json.dumps(self.config),)
            )
            self.run_id = cursor.lastrowid
            conn.commit()

    def complete(self, status: str = 'completed', error_message: Optional[str] = None):
        """Mark the pipeline run as completed."""
        max_retries = 5
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                with get_connection() as conn:
                    conn.execute(
                        '''UPDATE pipeline_runs
                           SET completed_at = ?, status = ?, error_message = ?
                           WHERE id = ?''',
                        (datetime.utcnow().isoformat(), status, error_message, self.run_id)
                    )
                    conn.commit()
                return  # Success
            except Exception as e:
                retry_count += 1
                if retry_count < max_retries:
                    import time
                    wait_time = 2 ** retry_count
                    print(f"\nRetrying pipeline completion (attempt {retry_count}/{max_retries}, waiting {wait_time}s): {str(e)[:100]}")
                    time.sleep(wait_time)
                else:
                    raise Exception(f"Failed to complete pipeline after {max_retries} attempts: {str(e)}")

    def start_stage(self, stage: str, input_count: int = 0) -> int:
        """Start tracking a new stage."""
        with get_connection() as conn:
            cursor = conn.execute(
                '''INSERT INTO stage_metrics (run_id, stage, input_count)
                   VALUES (?, ?, ?)''',
                (self.run_id, stage, input_count)
            )
            stage_id = cursor.lastrowid
            conn.commit()
            return stage_id

    def complete_stage(
        self,
        stage_id: int,
        output_count: int = 0,
        error_count: int = 0,
        error_details: Optional[List[Dict]] = None
    ):
        """Mark a stage as completed with metrics."""
        max_retries = 5
        retry_count = 0
        last_error = None
        
        while retry_count < max_retries:
            try:
                with get_connection() as conn:
                    # Serialize error details first to catch any JSON errors
                    error_json = json.dumps(error_details) if error_details else None
                    
                    conn.execute(
                        '''UPDATE stage_metrics
                           SET completed_at = ?, output_count = ?, error_count = ?, error_details = ?
                           WHERE id = ?''',
                        (
                            datetime.utcnow().isoformat(),
                            output_count,
                            error_count,
                            error_json,
                            stage_id
                        )
                    )
                    conn.commit()
                return  # Success
            except Exception as e:
                last_error = e
                retry_count += 1
                if retry_count < max_retries:
                    import time
                    wait_time = 2 ** retry_count  # Exponential backoff
                    print(f"\nRetrying stage completion (attempt {retry_count}/{max_retries}, waiting {wait_time}s): {str(e)[:100]}")
                    time.sleep(wait_time)
                else:
                    raise Exception(f"Failed to complete stage after {max_retries} attempts: {str(last_error)}")

    def log_error(
        self,
        stage: str,
        error_type: str,
        error_message: str,
        context: Optional[Dict] = None
    ):
        """Log an error to the error_logs table."""
        with get_connection() as conn:
            conn.execute(
                '''INSERT INTO error_logs (run_id, stage, error_type, error_message, context_json)
                   VALUES (?, ?, ?, ?, ?)''',
                (
                    self.run_id,
                    stage,
                    error_type,
                    error_message,
                    json.dumps(context) if context else None
                )
            )
            conn.commit()

    def add_lead(self, lead_data: Dict[str, Any]) -> int:
        """Add a lead to the database."""
        with get_connection() as conn:
            cursor = conn.execute(
                '''INSERT INTO leads (
                    run_id, company_name, company_domain, job_title, employee_count,
                    location, person_name, person_first_name, person_last_name,
                    person_title, linkedin_url, email, email_certainty, email_verified,
                    status, failure_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    self.run_id,
                    lead_data.get('company_name'),
                    lead_data.get('company_domain'),
                    lead_data.get('job_title'),
                    lead_data.get('employee_count'),
                    lead_data.get('location'),
                    lead_data.get('person_name'),
                    lead_data.get('person_first_name'),
                    lead_data.get('person_last_name'),
                    lead_data.get('person_title'),
                    lead_data.get('linkedin_url'),
                    lead_data.get('email'),
                    lead_data.get('email_certainty'),
                    lead_data.get('email_verified', False),
                    lead_data.get('status', 'created'),
                    lead_data.get('failure_reason')
                )
            )
            lead_id = cursor.lastrowid
            conn.commit()
            return lead_id

    def update_lead(self, lead_id: int, updates: Dict[str, Any]):
        """Update a lead record."""
        # Build dynamic UPDATE query
        set_clauses = []
        values = []
        for key, value in updates.items():
            set_clauses.append(f'{key} = ?')
            values.append(value)

        set_clauses.append('updated_at = ?')
        values.append(datetime.utcnow().isoformat())
        values.append(lead_id)

        with get_connection() as conn:
            conn.execute(
                f'''UPDATE leads SET {', '.join(set_clauses)} WHERE id = ?''',
                values
            )
            conn.commit()

    def bulk_add_leads(self, leads: List[Dict[str, Any]]) -> List[int]:
        """Add multiple leads in a single transaction."""
        lead_ids = []
        with get_connection() as conn:
            for lead_data in leads:
                cursor = conn.execute(
                    '''INSERT INTO leads (
                        run_id, company_name, company_domain, job_title, employee_count,
                        location, person_name, person_first_name, person_last_name,
                        person_title, linkedin_url, email, email_certainty, email_verified,
                        status, failure_reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                    (
                        self.run_id,
                        lead_data.get('company_name'),
                        lead_data.get('company_domain'),
                        lead_data.get('job_title'),
                        lead_data.get('employee_count'),
                        lead_data.get('location'),
                        lead_data.get('person_name'),
                        lead_data.get('person_first_name'),
                        lead_data.get('person_last_name'),
                        lead_data.get('person_title'),
                        lead_data.get('linkedin_url'),
                        lead_data.get('email'),
                        lead_data.get('email_certainty'),
                        lead_data.get('email_verified', False),
                        lead_data.get('status', 'created'),
                        lead_data.get('failure_reason')
                    )
                )
                lead_ids.append(cursor.lastrowid)
            conn.commit()
        return lead_ids

    def get_leads_by_status(self, status: str) -> List[Dict]:
        """Get all leads with a specific status for this run."""
        with get_connection() as conn:
            cursor = conn.execute(
                '''SELECT * FROM leads WHERE run_id = ? AND status = ?''',
                (self.run_id, status)
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_all_leads(self) -> List[Dict]:
        """Get all leads for this run."""
        with get_connection() as conn:
            cursor = conn.execute(
                '''SELECT * FROM leads WHERE run_id = ?''',
                (self.run_id,)
            )
            return [dict(row) for row in cursor.fetchall()]


# Query functions for the monitoring dashboard

def get_all_runs(limit: int = 50) -> List[Dict]:
    """Get all pipeline runs, most recent first."""
    with get_connection() as conn:
        cursor = conn.execute(
            '''SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?''',
            (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]


def get_run_details(run_id: int) -> Optional[Dict]:
    """Get detailed information about a specific run."""
    with get_connection() as conn:
        # Get run info
        cursor = conn.execute(
            '''SELECT * FROM pipeline_runs WHERE id = ?''',
            (run_id,)
        )
        run = cursor.fetchone()
        if not run:
            return None

        run_dict = dict(run)

        # Get stage metrics
        cursor = conn.execute(
            '''SELECT * FROM stage_metrics WHERE run_id = ? ORDER BY started_at''',
            (run_id,)
        )
        run_dict['stages'] = [dict(row) for row in cursor.fetchall()]

        # Get lead counts by status
        cursor = conn.execute(
            '''SELECT status, COUNT(*) as count FROM leads
               WHERE run_id = ? GROUP BY status''',
            (run_id,)
        )
        run_dict['lead_counts'] = {row['status']: row['count'] for row in cursor.fetchall()}

        # Get error logs
        cursor = conn.execute(
            '''SELECT * FROM error_logs WHERE run_id = ? ORDER BY created_at''',
            (run_id,)
        )
        run_dict['errors'] = [dict(row) for row in cursor.fetchall()]

        return run_dict


def get_latest_run() -> Optional[Dict]:
    """Get the most recent pipeline run with details."""
    with get_connection() as conn:
        cursor = conn.execute(
            '''SELECT id FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'''
        )
        row = cursor.fetchone()
        if row:
            return get_run_details(row['id'])
        return None


def get_run_summary_stats() -> Dict:
    """Get summary statistics across all runs."""
    with get_connection() as conn:
        # Total runs
        cursor = conn.execute('''SELECT COUNT(*) as total FROM pipeline_runs''')
        total_runs = cursor.fetchone()['total']

        # Successful runs
        cursor = conn.execute(
            '''SELECT COUNT(*) as total FROM pipeline_runs WHERE status = 'completed' '''
        )
        successful_runs = cursor.fetchone()['total']

        # Total leads created
        cursor = conn.execute('''SELECT COUNT(*) as total FROM leads''')
        total_leads = cursor.fetchone()['total']

        # Leads by status
        cursor = conn.execute(
            '''SELECT status, COUNT(*) as count FROM leads GROUP BY status'''
        )
        leads_by_status = {row['status']: row['count'] for row in cursor.fetchall()}

        # Average leads per successful run
        cursor = conn.execute(
            '''SELECT AVG(lead_count) as avg_leads FROM (
                SELECT run_id, COUNT(*) as lead_count FROM leads
                GROUP BY run_id
            )'''
        )
        avg_row = cursor.fetchone()
        avg_leads_per_run = avg_row['avg_leads'] if avg_row['avg_leads'] else 0

        return {
            'total_runs': total_runs,
            'successful_runs': successful_runs,
            'failed_runs': total_runs - successful_runs,
            'success_rate': (successful_runs / total_runs * 100) if total_runs > 0 else 0,
            'total_leads': total_leads,
            'leads_by_status': leads_by_status,
            'avg_leads_per_run': round(avg_leads_per_run, 1)
        }
