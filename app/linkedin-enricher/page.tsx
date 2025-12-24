"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { convertToCSV, type EnrichedLead } from "@/lib/linkedin-enricher";
import { Download, Loader2, CheckCircle2, AlertCircle, Mail, Users, ArrowLeft } from "lucide-react";

type ProcessingStage = "idle" | "fetching" | "filtering" | "enriching" | "complete";

export default function LinkedInEnricherPage() {
  const [postUrl, setPostUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [results, setResults] = useState<EnrichedLead[]>([]);
  const [stats, setStats] = useState<{
    total_reactions: number;
    reactions_fetched: number;
    icp_qualified: number;
    enriched: number;
    failed_enrichments: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    stage: string;
    current: number;
    total: number;
  } | null>(null);

  const handleSubmit = async () => {
    if (!postUrl.trim()) return;

    console.log("[Frontend] Starting processing for URL:", postUrl);
    setProcessing(true);
    setError(null);
    setResults([]);
    setStats(null);
    setProgress(null);

    try {
      // STAGE 1: Fetch reactions
      setStage("fetching");
      setProgress({ stage: "Fetching reactions from LinkedIn post", current: 0, total: 0 });

      console.log("[Frontend] Fetching reactions");
      const fetchResponse = await fetch("/api/linkedin-enricher/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ post_url: postUrl }),
      });

      if (!fetchResponse.ok) {
        const errorData = await fetchResponse.json();
        throw new Error(errorData.error || "Failed to fetch reactions");
      }

      const { profiles, total } = await fetchResponse.json();
      console.log(`[Frontend] Fetched ${profiles.length} profiles`);

      setProgress({ stage: "Fetching complete", current: profiles.length, total: profiles.length });

      if (profiles.length === 0) {
        setStats({
          total_reactions: 0,
          reactions_fetched: 0,
          icp_qualified: 0,
          enriched: 0,
          failed_enrichments: 0,
        });
        setStage("complete");
        setProcessing(false);
        return;
      }

      // STAGE 2: Filter by ICP in batches (client-side for progress tracking)
      setStage("filtering");
      setProgress({ stage: "Filtering by ICP", current: 0, total: profiles.length });

      const BATCH_SIZE = 20;
      const allFilteredResults: any[] = [];

      for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
        const batch = profiles.slice(i, i + BATCH_SIZE);

        const filterResponse = await fetch("/api/linkedin-enricher/filter", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ profiles: batch }),
        });

        if (!filterResponse.ok) {
          throw new Error("Failed to filter batch");
        }

        const { results } = await filterResponse.json();
        allFilteredResults.push(...results);

        // Update progress
        const processed = Math.min(i + BATCH_SIZE, profiles.length);
        setProgress({ stage: "Filtering by ICP", current: processed, total: profiles.length });

        // Small delay between batches
        if (i + BATCH_SIZE < profiles.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Filter for accepted leads
      const acceptedLeads = allFilteredResults.filter(r => r.icp_result.decision === "ACCEPT");

      console.log(`[Frontend] Filtering complete: ${acceptedLeads.length}/${profiles.length} qualified`);

      // Convert to enriched lead format with PENDING status
      const pendingLeads = acceptedLeads.map(item => ({
        profile: item.profile,
        icp_result: item.icp_result,
        contact: {},
        enrichment_status: "PENDING" as const,
      }));

      setStats({
        total_reactions: profiles.length,
        reactions_fetched: profiles.length,
        icp_qualified: acceptedLeads.length,
        enriched: 0,
        failed_enrichments: 0,
      });

      setResults(pendingLeads);
      setProgress(null);
      setStage("complete");
    } catch (err) {
      console.error("[Frontend] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to process LinkedIn post");
      setStage("idle");
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleEnrich = async () => {
    if (results.length === 0) return;

    console.log("[Frontend] Starting enrichment for", results.length, "leads");
    setEnriching(true);
    setError(null);
    setProgress({ stage: "Enriching contacts", current: 0, total: results.length });

    try {
      const BATCH_SIZE = 5;
      const enrichedLeads: any[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE);

        const response = await fetch("/api/linkedin-enricher/enrich-batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leads: batch }),
        });

        if (!response.ok) {
          throw new Error("Failed to enrich batch");
        }

        const data = await response.json();
        enrichedLeads.push(...data.results);
        successCount += data.success_count;
        failCount += data.fail_count;

        // Update progress
        const processed = Math.min(i + BATCH_SIZE, results.length);
        setProgress({ stage: "Enriching contacts", current: processed, total: results.length });

        // Small delay between batches
        if (i + BATCH_SIZE < results.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`[Frontend] Enrichment complete: ${successCount} successful, ${failCount} failed`);

      // Update stats
      if (stats) {
        setStats({
          ...stats,
          enriched: successCount,
          failed_enrichments: failCount,
        });
      }

      // Update results with enriched data
      setResults(enrichedLeads);
      setProgress(null);
      setStage("complete");
    } catch (err) {
      console.error("[Frontend] Enrichment error:", err);
      setError(err instanceof Error ? err.message : "Failed to enrich contacts");
      setProgress(null);
    } finally {
      setEnriching(false);
    }
  };

  const downloadCSV = () => {
    // Only export leads with emails
    const enrichedLeads = results.filter(lead => lead.enrichment_status === "SUCCESS");

    if (enrichedLeads.length === 0) return;

    const csv = convertToCSV(enrichedLeads);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "linkedin_enriched_leads.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">LinkedIn Post Enricher</h1>
        <p className="text-muted-foreground">
          Step 1: Extract reactions and filter by ICP • Step 2: Enrich qualified leads with emails
        </p>
      </div>

      {/* Input Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>LinkedIn Post URL</CardTitle>
          <CardDescription>
            Enter a LinkedIn post URL to extract and enrich reactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="post-url">Post URL</Label>
              <Input
                id="post-url"
                type="text"
                placeholder="https://www.linkedin.com/posts/username_activity-123456789"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                disabled={processing}
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!postUrl.trim() || processing}
              className="w-full sm:w-auto"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {stage === "fetching" && "Fetching reactions..."}
                  {stage === "filtering" && "Filtering by ICP..."}
                  {stage === "enriching" && "Enriching contacts..."}
                </>
              ) : (
                <>
                  <Users className="mr-2 h-4 w-4" />
                  Step 1: Extract & Filter
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processing Progress */}
      {(processing || enriching) && progress && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              {progress.stage}
            </CardTitle>
            {progress.total > 0 && (
              <CardDescription>
                {progress.current} / {progress.total}{" "}
                {stage === "filtering"
                  ? "profiles filtered"
                  : enriching
                  ? "leads enriched"
                  : "reactions fetched"}
              </CardDescription>
            )}
          </CardHeader>
          {progress.total > 0 && (
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Reactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_reactions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                ICP Qualified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.icp_qualified}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats.total_reactions > 0
                  ? `${((stats.icp_qualified / stats.total_reactions) * 100).toFixed(1)}%`
                  : "0%"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Enriched
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.enriched}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats.icp_qualified > 0
                  ? `${((stats.enriched / stats.icp_qualified) * 100).toFixed(1)}% success`
                  : "0%"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Failed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.failed_enrichments}</div>
              <div className="text-xs text-muted-foreground mt-1">No email found</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && !processing && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ICP Qualified Leads ({results.length})
                </CardTitle>
                <CardDescription>
                  {stats?.enriched || 0} with emails, {stats?.failed_enrichments || 0} without
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {/* Show Enrich button if leads are pending */}
                {results.some(r => r.enrichment_status === "PENDING") && !enriching && (
                  <Button onClick={handleEnrich} variant="default" size="lg">
                    <Mail className="mr-2 h-4 w-4" />
                    Step 2: Enrich with Emails ({results.length})
                  </Button>
                )}
                {/* Show loading state during enrichment */}
                {enriching && (
                  <Button disabled variant="default" size="lg">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enriching emails...
                  </Button>
                )}
                {/* Show download button if we have enriched leads */}
                {stats && stats.enriched > 0 && (
                  <Button onClick={downloadCSV} variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV ({stats.enriched})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {results.slice(0, 10).map((lead, idx) => (
                <div
                  key={idx}
                  className={`border rounded-lg p-4 ${
                    lead.enrichment_status === "FAILED"
                      ? "opacity-75 bg-muted/30"
                      : lead.enrichment_status === "PENDING"
                      ? "border-blue-200 dark:border-blue-800"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-semibold">{lead.profile.name}</h4>
                      <p className="text-sm text-muted-foreground">{lead.profile.headline}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {lead.enrichment_status === "SUCCESS" ? (
                        <Badge variant="default" className="bg-green-600">
                          <Mail className="h-3 w-3 mr-1" />
                          Enriched
                        </Badge>
                      ) : lead.enrichment_status === "PENDING" ? (
                        <Badge variant="secondary" className="text-blue-600">
                          Ready to Enrich
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-orange-600">
                          No Email
                        </Badge>
                      )}
                      <Badge
                        variant={
                          lead.icp_result.confidence === "HIGH"
                            ? "default"
                            : lead.icp_result.confidence === "MEDIUM"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {lead.icp_result.confidence}
                      </Badge>
                      {lead.profile.reaction_type && (
                        <Badge variant="outline">{lead.profile.reaction_type}</Badge>
                      )}
                    </div>
                  </div>

                  <Separator className="my-2" />

                  <div className="space-y-2 text-sm">
                    {lead.enrichment_status === "PENDING" ? (
                      <div className="flex items-center gap-2 text-blue-600 p-2 rounded bg-blue-50 dark:bg-blue-950">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm">Click "Enrich Leads" button to fetch emails</span>
                      </div>
                    ) : lead.contact?.email ? (
                      <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950 p-2 rounded">
                        <Mail className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Email:</span>
                        <span className="font-mono">{lead.contact.email}</span>
                        {lead.contact.email_rating && (
                          <Badge variant="outline" className="ml-auto">
                            {lead.contact.email_rating}% confidence
                          </Badge>
                        )}
                        {lead.contact.email_subtype && (
                          <Badge variant="outline" className="ml-2">
                            {lead.contact.email_subtype}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground p-2 rounded bg-muted">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm">{lead.error || "Email not found"}</span>
                      </div>
                    )}

                    {lead.contact?.phone && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Phone:</span>
                        <span>{lead.contact.phone}</span>
                      </div>
                    )}

                    <div>
                      <span className="font-medium">ICP Reasoning:</span>{" "}
                      {lead.icp_result.reasoning}
                    </div>

                    {lead.icp_result.extracted_info?.company && (
                      <div>
                        <span className="font-medium">Company:</span>{" "}
                        {lead.icp_result.extracted_info.company}
                      </div>
                    )}

                    {lead.icp_result.extracted_info?.role && (
                      <div>
                        <span className="font-medium">Role:</span>{" "}
                        {lead.icp_result.extracted_info.role}
                      </div>
                    )}

                    <div>
                      <a
                        href={lead.profile.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View LinkedIn Profile →
                      </a>
                    </div>
                  </div>
                </div>
              ))}
              {results.length > 10 && (
                <p className="text-sm text-muted-foreground text-center">
                  ... and {results.length - 10} more. Download CSV to see all.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {stage === "complete" && results.length === 0 && stats && stats.total_reactions > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No enriched leads found</p>
              <p className="text-sm">
                {stats.icp_qualified === 0
                  ? "None of the reactions matched the ICP criteria."
                  : "None of the qualified leads could be enriched with work emails."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
