import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

// Database path
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

interface SummaryStats {
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  success_rate: number;
  total_leads: number;
  leads_by_status: Record<string, number>;
  avg_leads_per_run: number;
}

function getDatabase() {
  try {
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const db = getDatabase();

  if (!db) {
    return NextResponse.json({
      runs: [],
      summary: {
        total_runs: 0,
        successful_runs: 0,
        failed_runs: 0,
        success_rate: 0,
        total_leads: 0,
        leads_by_status: {},
        avg_leads_per_run: 0,
      },
      message: "No pipeline runs yet. Database not initialized.",
    });
  }

  try {
    // Get all runs
    const runs = db
      .prepare(
        `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?`
      )
      .all(limit) as PipelineRun[];

    // Get summary stats
    const totalRuns = db
      .prepare(`SELECT COUNT(*) as total FROM pipeline_runs`)
      .get() as { total: number };

    const successfulRuns = db
      .prepare(`SELECT COUNT(*) as total FROM pipeline_runs WHERE status = 'completed'`)
      .get() as { total: number };

    const totalLeads = db
      .prepare(`SELECT COUNT(*) as total FROM leads`)
      .get() as { total: number };

    const leadsByStatus = db
      .prepare(`SELECT status, COUNT(*) as count FROM leads GROUP BY status`)
      .all() as { status: string; count: number }[];

    const avgLeads = db
      .prepare(
        `SELECT AVG(lead_count) as avg_leads FROM (
          SELECT run_id, COUNT(*) as lead_count FROM leads GROUP BY run_id
        )`
      )
      .get() as { avg_leads: number | null };

    // Enrich runs with stage metrics
    const enrichedRuns = runs.map((run) => {
      const stages = db!
        .prepare(`SELECT * FROM stage_metrics WHERE run_id = ? ORDER BY started_at`)
        .all(run.id) as StageMetric[];

      const leadCounts = db!
        .prepare(`SELECT status, COUNT(*) as count FROM leads WHERE run_id = ? GROUP BY status`)
        .all(run.id) as { status: string; count: number }[];

      return {
        ...run,
        config: run.config_json ? JSON.parse(run.config_json) : null,
        stages: stages.map((s) => ({
          ...s,
          error_details: s.error_details ? JSON.parse(s.error_details) : null,
        })),
        lead_counts: Object.fromEntries(leadCounts.map((l) => [l.status, l.count])),
      };
    });

    const summary: SummaryStats = {
      total_runs: totalRuns.total,
      successful_runs: successfulRuns.total,
      failed_runs: totalRuns.total - successfulRuns.total,
      success_rate:
        totalRuns.total > 0
          ? Math.round((successfulRuns.total / totalRuns.total) * 100)
          : 0,
      total_leads: totalLeads.total,
      leads_by_status: Object.fromEntries(
        leadsByStatus.map((l) => [l.status, l.count])
      ),
      avg_leads_per_run: Math.round(avgLeads.avg_leads || 0),
    };

    db.close();

    return NextResponse.json({
      runs: enrichedRuns,
      summary,
    });
  } catch (error) {
    db.close();
    console.error("Error fetching pipeline data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch pipeline data" },
      { status: 500 }
    );
  }
}
