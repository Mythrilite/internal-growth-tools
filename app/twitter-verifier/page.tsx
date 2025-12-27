"use client";

import { useState } from "react";
import Link from "next/link";
import * as Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { parseCSV, convertToCSV, type TwitterLead, type FilterResult } from "@/lib/twitter-verifier";
import { batchFilterByLocation } from "@/lib/location-filter";
import { Download, Filter, CheckCircle2, XCircle, AlertCircle, Loader2, Zap, ArrowLeft } from "lucide-react";

interface ProcessedLead extends TwitterLead {
  filter_result: FilterResult;
}

type ProcessingStage = "idle" | "location-filter" | "ai-verification" | "complete";

export default function TwitterVerifierPage() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [locationStats, setLocationStats] = useState<any>(null);
  const [qualifiedLeads, setQualifiedLeads] = useState<TwitterLead[]>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [accepted, setAccepted] = useState<ProcessedLead[]>([]);
  const [rejected, setRejected] = useState<ProcessedLead[]>([]);
  const [locationRejected, setLocationRejected] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      // Reset results when new file is selected
      setAccepted([]);
      setRejected([]);
      setLocationRejected([]);
      setQualifiedLeads([]);
      setLocationStats(null);
      setStage("idle");
    }
  };

  const processLeads = async () => {
    if (!file) return;

    setProcessing(true);
    setError(null);
    setAccepted([]);
    setRejected([]);
    setLocationRejected([]);
    setQualifiedLeads([]);
    setLocationStats(null);

    try {
      // STAGE 1: Parse CSV
      const csvContent = await file.text();
      const allLeads = parseCSV(csvContent);

      // STAGE 2: Fast multi-filter (location + followers + keywords, no LLM)
      setStage("location-filter");
      const { qualifiedLeads, rejectedLeads, stats } = batchFilterByLocation(allLeads);
      setLocationStats(stats);
      setLocationRejected(rejectedLeads);
      setQualifiedLeads(qualifiedLeads);

      // STAGE 3: Parallel AI verification on qualified leads only
      setStage("ai-verification");
      const BATCH_SIZE = 20; // Process 20 leads at a time in parallel
      const batches = [];
      for (let i = 0; i < qualifiedLeads.length; i += BATCH_SIZE) {
        batches.push(qualifiedLeads.slice(i, i + BATCH_SIZE));
      }
      setTotalBatches(batches.length);

      const acceptedLeads: ProcessedLead[] = [];
      const aiRejectedLeads: ProcessedLead[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        setCurrentBatch(batchIndex + 1);
        const batch = batches[batchIndex];

        // Call batch API endpoint
        const response = await fetch("/api/twitter-verifier", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leads: batch }),
        });

        if (!response.ok) {
          throw new Error(`Failed to analyze batch ${batchIndex + 1}`);
        }

        const data = await response.json();

        // Process results
        for (const item of data.results) {
          const processedLead: ProcessedLead = {
            ...item.lead,
            filter_result: item.result,
          };

          if (item.result.decision === "ACCEPT") {
            acceptedLeads.push(processedLead);
          } else {
            aiRejectedLeads.push(processedLead);
          }
        }

        // Update state after each batch
        setAccepted([...acceptedLeads]);
        setRejected([...aiRejectedLeads]);
      }

      setStage("complete");

      // Automatically download accepted leads CSV
      if (acceptedLeads.length > 0) {
        const csv = convertToCSV(acceptedLeads);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `accepted_leads_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process leads");
      setStage("idle");
    } finally {
      setProcessing(false);
    }
  };

  const downloadCSV = (leads: ProcessedLead[], filename: string) => {
    const csv = convertToCSV(leads);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const downloadQualifiedLeadsCSV = () => {
    if (qualifiedLeads.length === 0) return;

    // Convert qualified leads to CSV (these don't have filter_result yet)
    const csv = Papa.unparse(qualifiedLeads, {
      quotes: true,
      quoteChar: '"',
      escapeChar: '"',
      header: true,
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qualified_leads_pre_filter_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const totalProcessed = accepted.length + rejected.length;
  const acceptanceRate = totalProcessed > 0 ? (accepted.length / totalProcessed) * 100 : 0;
  const totalLeads = locationStats ? locationStats.total : 0;

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Twitter Lead Verifier</h1>
        <p className="text-muted-foreground">
          Two-stage filtering: Fast pre-filter (location + followers + keywords) + AI verification
        </p>
      </div>

      {/* Upload Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            Required: name, description, location, public_metrics. Optional: username (twitter handle)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="csv-file">CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={processing}
              />
            </div>
            {file && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Selected: {file.name}
              </div>
            )}
            <Button
              onClick={processLeads}
              disabled={!file || processing}
              className="w-full sm:w-auto"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {stage === "location-filter" && "Filtering by location..."}
                  {stage === "ai-verification" && `AI Verifying (Batch ${currentBatch}/${totalBatches})`}
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Start Fast Filtering
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

      {/* Stage 1: Multi-Filter Stats */}
      {locationStats && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  Stage 1: Fast Pre-Filter (Instant)
                </CardTitle>
                <CardDescription>
                  Location + Follower Count (100-5K) + Keyword matching without LLM
                </CardDescription>
              </div>
              {qualifiedLeads.length > 0 && (
                <Button
                  onClick={downloadQualifiedLeadsCSV}
                  variant="outline"
                  size="sm"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Qualified
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Leads</div>
                <div className="text-2xl font-bold">{locationStats.total}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Qualified</div>
                <div className="text-2xl font-bold text-green-600">{locationStats.qualified}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Filter Rate</div>
                <div className="text-2xl font-bold">
                  {((locationStats.qualified / locationStats.total) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <Separator className="my-4" />
            <div className="text-sm font-medium mb-2">Rejection Breakdown:</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Non-US Location</div>
                <div className="text-lg font-semibold text-red-600">{locationStats.rejectedLocation}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Follower Count</div>
                <div className="text-lg font-semibold text-red-600">{locationStats.rejectedFollowers}</div>
              </div>
              <div>
                <div className="text-muted-foreground">No Keywords</div>
                <div className="text-lg font-semibold text-red-600">{locationStats.rejectedKeywords}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Multiple Reasons</div>
                <div className="text-lg font-semibold text-red-600">{locationStats.rejectedMultiple}</div>
              </div>
            </div>

            {locationStats.debugSamples && locationStats.debugSamples.length > 0 && (
              <>
                <Separator className="my-4" />
                <div className="text-sm font-medium mb-2">Debug: Sample Rejections</div>
                <div className="space-y-2 text-xs">
                  {locationStats.debugSamples.slice(0, 3).map((sample: any, idx: number) => (
                    <div key={idx} className="bg-muted p-3 rounded">
                      <div className="font-semibold">{idx + 1}. {sample.name}</div>
                      <div className="text-red-600 mt-1">
                        {sample.rejectionReasons.join(" | ")}
                      </div>
                      {sample.debugInfo && (
                        <div className="mt-2 text-muted-foreground space-y-1">
                          <div>Location: {sample.debugInfo.location?.value || "none"} → {sample.debugInfo.location?.result?.reason}</div>
                          <div>Followers: {JSON.stringify(sample.debugInfo.followers?.result?.followerCount)} → {sample.debugInfo.followers?.result?.reason}</div>
                          <div>Keywords: {sample.debugInfo.keywords?.result?.matchedKeywords?.length || 0} matched → {sample.debugInfo.keywords?.result?.reason}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage 2: AI Verification Progress */}
      {stage === "ai-verification" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-blue-500" />
              Stage 2: AI Verification (Parallel Processing)
            </CardTitle>
            <CardDescription>
              Processing {locationStats.qualified} qualified leads in batches of 20
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{currentBatch} / {totalBatches} batches</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(currentBatch / totalBatches) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Final Stats */}
      {(stage === "complete" || totalProcessed > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                AI Processed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalProcessed} / {locationStats?.qualified || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Accepted
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-green-600">{accepted.length}</div>
                {totalProcessed > 0 && (
                  <Badge variant="secondary">{acceptanceRate.toFixed(1)}%</Badge>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Rejected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {rejected.length + locationRejected.length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {locationRejected.length} location, {rejected.length} AI
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {totalProcessed > 0 && !processing && (
        <div className="space-y-6">
          {/* Accepted Leads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    Accepted Leads ({accepted.length})
                  </CardTitle>
                  <CardDescription>
                    Leads that meet the qualification criteria
                  </CardDescription>
                </div>
                {accepted.length > 0 && (
                  <Button
                    onClick={() => downloadCSV(accepted, "accepted_leads.csv")}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {accepted.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accepted leads yet</p>
              ) : (
                <div className="space-y-4">
                  {accepted.slice(0, 5).map((lead, idx) => (
                    <div key={idx} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold">{lead.name}</h4>
                          {lead.location && (
                            <p className="text-sm text-muted-foreground">📍 {lead.location}</p>
                          )}
                          {(lead.username || lead.twitter_handle) && (
                            <p className="text-sm text-muted-foreground">@{lead.username || lead.twitter_handle}</p>
                          )}
                        </div>
                        <Badge
                          variant={
                            lead.filter_result.confidence === "HIGH"
                              ? "default"
                              : lead.filter_result.confidence === "MEDIUM"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {lead.filter_result.confidence}
                        </Badge>
                      </div>
                      <p className="text-sm mb-2">{lead.description}</p>
                      <Separator className="my-2" />
                      <div className="text-sm space-y-1">
                        <p>
                          <span className="font-medium">Reasoning:</span>{" "}
                          {lead.filter_result.reasoning}
                        </p>
                        {lead.filter_result.extracted_info?.company && (
                          <p>
                            <span className="font-medium">Company:</span>{" "}
                            {lead.filter_result.extracted_info.company}
                          </p>
                        )}
                        {lead.filter_result.extracted_info?.role && (
                          <p>
                            <span className="font-medium">Role:</span>{" "}
                            {lead.filter_result.extracted_info.role}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {accepted.length > 5 && (
                    <p className="text-sm text-muted-foreground text-center">
                      ... and {accepted.length - 5} more. Download CSV to see all.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Rejected Leads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600" />
                    AI Rejected Leads ({rejected.length})
                  </CardTitle>
                  <CardDescription>
                    US-based leads that don't meet qualification criteria
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rejected.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI rejected leads</p>
              ) : (
                <div className="space-y-4">
                  {rejected.slice(0, 3).map((lead, idx) => (
                    <div key={idx} className="border rounded-lg p-4 opacity-75">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold">{lead.name}</h4>
                          {lead.location && (
                            <p className="text-sm text-muted-foreground">📍 {lead.location}</p>
                          )}
                          {(lead.username || lead.twitter_handle) && (
                            <p className="text-sm text-muted-foreground">@{lead.username || lead.twitter_handle}</p>
                          )}
                        </div>
                      </div>
                      <p className="text-sm mb-2">{lead.description}</p>
                      <Separator className="my-2" />
                      <p className="text-sm">
                        <span className="font-medium">Reason:</span> {lead.filter_result.reasoning}
                      </p>
                    </div>
                  ))}
                  {rejected.length > 3 && (
                    <p className="text-sm text-muted-foreground text-center">
                      ... and {rejected.length - 3} more rejected by AI
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pre-filter Rejected Summary */}
          {locationRejected.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                  Pre-filter Rejected ({locationRejected.length})
                </CardTitle>
                <CardDescription>
                  Leads rejected in Stage 1 (location/followers/keywords) - not processed by AI
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {locationRejected.length} leads were filtered out in Stage 1 due to location, follower count, or missing keywords,
                  saving ~${((locationRejected.length * 0.00035).toFixed(2))} in API costs.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
