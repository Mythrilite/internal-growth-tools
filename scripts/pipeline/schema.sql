-- Pipeline Database Schema
-- Tracks pipeline runs, stage metrics, and individual leads

-- Pipeline runs table
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT DEFAULT 'running',  -- 'running', 'completed', 'failed'
    error_message TEXT,
    config_json TEXT  -- Store run configuration (job count, etc.)
);

-- Stage metrics table
CREATE TABLE IF NOT EXISTS stage_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    stage TEXT NOT NULL,  -- 'scrape', 'filter', 'search', 'enrich', 'validate', 'push_email', 'push_linkedin'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    input_count INTEGER DEFAULT 0,
    output_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    error_details TEXT,  -- JSON array of error objects
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);

-- Individual lead tracking
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    -- Company info (from job posting)
    company_name TEXT,
    company_domain TEXT,
    job_title TEXT,  -- The job being hired for
    employee_count INTEGER,
    location TEXT,
    -- Person info (from Exa search)
    person_name TEXT,
    person_first_name TEXT,
    person_last_name TEXT,
    person_title TEXT,  -- CTO, Head of Engineering, etc.
    linkedin_url TEXT,
    -- Enrichment info (from Icypeas)
    email TEXT,
    email_certainty TEXT,  -- 'ultra_sure', 'sure', 'likely', etc.
    email_verified BOOLEAN DEFAULT FALSE,
    -- Status tracking
    status TEXT DEFAULT 'created',  -- 'created', 'enriched', 'validated', 'pushed_email', 'pushed_linkedin', 'failed'
    failure_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);

-- Error logs table (detailed error tracking)
CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    error_type TEXT,  -- 'API_ERROR', 'RATE_LIMIT', 'VALIDATION', 'NETWORK', etc.
    error_message TEXT,
    context_json TEXT,  -- Additional context as JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_stage_metrics_run_id ON stage_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_leads_run_id ON leads(run_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_error_logs_run_id ON error_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at);
