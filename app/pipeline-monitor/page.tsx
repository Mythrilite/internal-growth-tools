"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowLeft,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Building2,
  Mail,
  Linkedin,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface StageMetric {
  id: number;
  stage: string;
  started_at: string;
  completed_at: string | null;
  input_count: number;
  output_count: number;
  error_count: number;
  error_details: any[] | null;
  duration_seconds: number | null;
}

interface PipelineRun {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  error_message: string | null;
  config: { test_mode?: boolean; job_count?: number } | null;
  stages: StageMetric[];
  lead_counts: Record<string, number>;
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

interface RunDetails {
  run: PipelineRun;
  stages: StageMetric[];
  lead_counts: Record<string, number>;
  lead_stats: {
    total: number;
    with_email: number;
    with_linkedin: number;
    verified_emails: number;
  };
  errors: Array<{
    id: number;
    stage: string;
    error_type: string;
    error_message: string;
    context: any;
    created_at: string;
  }>;
  sample_leads: any[];
  duration_seconds: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  scrape: "LinkedIn Scrape",
  filter: "Company Filter",
  search: "Decision Maker Search",
  enrich: "Email Enrichment",
  validate: "Lead Validation",
  push_email: "Email Campaign",
  push_linkedin: "LinkedIn Campaign",
};

const STAGE_ICONS: Record<string, React.ReactNode> = {
  scrape: <Building2 className="h-4 w-4" />,
  filter: <Users className="h-4 w-4" />,
  search: <Users className="h-4 w-4" />,
  enrich: <Mail className="h-4 w-4" />,
  validate: <CheckCircle2 className="h-4 w-4" />,
  push_email: <Mail className="h-4 w-4" />,
  push_linkedin: <Linkedin className="h-4 w-4" />,
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PipelineMonitorPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [runDetails, setRunDetails] = useState<Record<number, RunDetails>>({});
  const [loadingDetails, setLoadingDetails] = useState<number | null>(null);

  useEffect(() => {
    fetchPipelineData();
  }, []);

  const fetchPipelineData = async () => {
    try {
      const response = await fetch("/api/pipeline-monitor?limit=20");
      if (!response.ok) throw new Error("Failed to fetch pipeline data");

      const data = await response.json();
      setRuns(data.runs || []);
      setSummary(data.summary || null);

      // Auto-expand the first run if it exists
      if (data.runs?.length > 0 && expandedRun === null) {
        setExpandedRun(data.runs[0].id);
        fetchRunDetails(data.runs[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  const fetchRunDetails = async (runId: number) => {
    if (runDetails[runId]) return;

    setLoadingDetails(runId);
    try {
      const response = await fetch(`/api/pipeline-monitor/${runId}`);
      if (!response.ok) throw new Error("Failed to fetch run details");

      const data = await response.json();
      setRunDetails((prev) => ({ ...prev, [runId]: data }));
    } catch (err) {
      console.error("Failed to fetch run details:", err);
    } finally {
      setLoadingDetails(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPipelineData();
    setRefreshing(false);
  };

  const toggleExpand = (runId: number) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      fetchRunDetails(runId);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Pipeline Monitor</h1>
          <p className="text-muted-foreground">
            Track your daily LinkedIn job lead generation pipeline runs
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Runs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.total_runs}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Success Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {summary.success_rate}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {summary.successful_runs} of {summary.total_runs}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Leads
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {summary.total_leads.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg per Run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.avg_leads_per_run}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Failed Runs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{summary.failed_runs}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Pipeline Runs */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Recent Runs</h2>

            {runs.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No pipeline runs yet</p>
                  <p className="text-sm">
                    Run the pipeline with:{" "}
                    <code className="bg-muted px-2 py-1 rounded">
                      python scripts/pipeline/daily_lead_pipeline.py
                    </code>
                  </p>
                </CardContent>
              </Card>
            ) : (
              runs.map((run) => (
                <Card key={run.id} className={run.status === "failed" ? "border-red-200" : ""}>
                  <CardHeader
                    className="cursor-pointer"
                    onClick={() => toggleExpand(run.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2">
                            Run #{run.id}
                            {run.config?.test_mode && (
                              <Badge variant="outline" className="text-xs">
                                TEST
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(run.started_at)}
                            {run.completed_at && (
                              <span className="text-muted-foreground">
                                ({formatDuration(
                                  Math.round(
                                    (new Date(run.completed_at).getTime() -
                                      new Date(run.started_at).getTime()) /
                                      1000
                                  )
                                )})
                              </span>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {getStatusBadge(run.status)}
                        <div className="text-sm text-muted-foreground">
                          {Object.values(run.lead_counts || {}).reduce((a, b) => a + b, 0)} leads
                        </div>
                        {expandedRun === run.id ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {expandedRun === run.id && (
                    <CardContent className="border-t">
                      {loadingDetails === run.id ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      ) : runDetails[run.id] ? (
                        <div className="space-y-6 pt-4">
                          {/* Stage Progress */}
                          <div>
                            <h3 className="text-sm font-semibold mb-3">Pipeline Stages</h3>
                            <div className="space-y-2">
                              {runDetails[run.id].stages.map((stage) => (
                                <div
                                  key={stage.id}
                                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                                >
                                  <div className="flex items-center gap-3">
                                    {STAGE_ICONS[stage.stage] || <Play className="h-4 w-4" />}
                                    <span className="font-medium">
                                      {STAGE_LABELS[stage.stage] || stage.stage}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-6 text-sm">
                                    <div className="text-muted-foreground">
                                      {stage.input_count} in
                                    </div>
                                    <div className="font-medium text-green-600">
                                      {stage.output_count} out
                                    </div>
                                    {stage.error_count > 0 && (
                                      <div className="font-medium text-red-600">
                                        {stage.error_count} errors
                                      </div>
                                    )}
                                    <div className="text-muted-foreground w-16 text-right">
                                      {formatDuration(stage.duration_seconds)}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Lead Stats */}
                          <div>
                            <h3 className="text-sm font-semibold mb-3">Lead Statistics</h3>
                            <div className="grid grid-cols-4 gap-4">
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold">
                                  {runDetails[run.id].lead_stats.total}
                                </div>
                                <div className="text-xs text-muted-foreground">Total Leads</div>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold text-blue-600">
                                  {runDetails[run.id].lead_stats.with_email}
                                </div>
                                <div className="text-xs text-muted-foreground">With Email</div>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold text-green-600">
                                  {runDetails[run.id].lead_stats.verified_emails}
                                </div>
                                <div className="text-xs text-muted-foreground">Verified</div>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold text-purple-600">
                                  {runDetails[run.id].lead_stats.with_linkedin}
                                </div>
                                <div className="text-xs text-muted-foreground">With LinkedIn</div>
                              </div>
                            </div>
                          </div>

                          {/* Errors */}
                          {runDetails[run.id].errors.length > 0 && (
                            <div>
                              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                                Errors ({runDetails[run.id].errors.length})
                              </h3>
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {runDetails[run.id].errors.map((error) => (
                                  <div
                                    key={error.id}
                                    className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm"
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge variant="outline" className="text-xs">
                                        {error.stage}
                                      </Badge>
                                      <Badge variant="destructive" className="text-xs">
                                        {error.error_type}
                                      </Badge>
                                    </div>
                                    <p className="text-red-800">{error.error_message}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Run error message */}
                          {run.error_message && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                <XCircle className="h-5 w-5 text-red-500" />
                                <span className="font-semibold text-red-800">Pipeline Failed</span>
                              </div>
                              <p className="text-red-700">{run.error_message}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-4 text-center text-muted-foreground">
                          Failed to load details
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
