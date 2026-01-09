import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "pipeline.db");

interface PipelineRun {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  error_message: string | null;
  config_json: string | null;
}

interface StageMetric {
  id: number;
  run_id: number;
  stage: string;
  started_at: string;
  completed_at: string | null;
  input_count: number;
  output_count: number;
  error_count: number;
  error_details: string | null;
}

interface ErrorLog {
  id: number;
  run_id: number;
  stage: string;
  error_type: string;
  error_message: string;
  context_json: string | null;
  created_at: string;
}

interface Lead {
  id: number;
  run_id: number;
  company_name: string | null;
  company_domain: string | null;
  job_title: string | null;
  employee_count: number | null;
  location: string | null;
  person_name: string | null;
  person_first_name: string | null;
  person_last_name: string | null;
  person_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_certainty: string | null;
  email_verified: boolean;
  status: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

function getDatabase() {
  try {
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const runIdNum = parseInt(runId, 10);

  if (isNaN(runIdNum)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }

  const db = getDatabase();

  if (!db) {
    return NextResponse.json(
      { error: "Database not found" },
      { status: 404 }
    );
  }

  try {
    // Get run info
    const run = db
      .prepare(`SELECT * FROM pipeline_runs WHERE id = ?`)
      .get(runIdNum) as PipelineRun | undefined;

    if (!run) {
      db.close();
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Get stage metrics
    const stages = db
      .prepare(`SELECT * FROM stage_metrics WHERE run_id = ? ORDER BY started_at`)
      .all(runIdNum) as StageMetric[];

    // Get lead counts by status
    const leadCounts = db
      .prepare(`SELECT status, COUNT(*) as count FROM leads WHERE run_id = ? GROUP BY status`)
      .all(runIdNum) as { status: string; count: number }[];

    // Get error logs
    const errors = db
      .prepare(`SELECT * FROM error_logs WHERE run_id = ? ORDER BY created_at`)
      .all(runIdNum) as ErrorLog[];

    // Get sample leads (first 100)
    const leads = db
      .prepare(`SELECT * FROM leads WHERE run_id = ? LIMIT 100`)
      .all(runIdNum) as Lead[];

    // Get lead stats
    const totalLeads = db
      .prepare(`SELECT COUNT(*) as total FROM leads WHERE run_id = ?`)
      .get(runIdNum) as { total: number };

    const leadsWithEmail = db
      .prepare(`SELECT COUNT(*) as total FROM leads WHERE run_id = ? AND email IS NOT NULL`)
      .get(runIdNum) as { total: number };

    const leadsWithLinkedIn = db
      .prepare(`SELECT COUNT(*) as total FROM leads WHERE run_id = ? AND linkedin_url IS NOT NULL`)
      .get(runIdNum) as { total: number };

    const verifiedEmails = db
      .prepare(`SELECT COUNT(*) as total FROM leads WHERE run_id = ? AND email_verified = 1`)
      .get(runIdNum) as { total: number };

    db.close();

    return NextResponse.json({
      run: {
        ...run,
        config: run.config_json ? JSON.parse(run.config_json) : null,
      },
      stages: stages.map((s) => ({
        ...s,
        error_details: s.error_details ? JSON.parse(s.error_details) : null,
        duration_seconds: s.completed_at
          ? Math.round(
              (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 1000
            )
          : null,
      })),
      lead_counts: Object.fromEntries(leadCounts.map((l) => [l.status, l.count])),
      lead_stats: {
        total: totalLeads.total,
        with_email: leadsWithEmail.total,
        with_linkedin: leadsWithLinkedIn.total,
        verified_emails: verifiedEmails.total,
      },
      errors: errors.map((e) => ({
        ...e,
        context: e.context_json ? JSON.parse(e.context_json) : null,
      })),
      sample_leads: leads,
      duration_seconds: run.completed_at
        ? Math.round(
            (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000
          )
        : null,
    });
  } catch (error) {
    db.close();
    console.error("Error fetching run details:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch run details" },
      { status: 500 }
    );
  }
}
