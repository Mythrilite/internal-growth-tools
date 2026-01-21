"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { convertToCSV, type EnrichedLead, type LinkedInProfile, type ICPFilterResult } from "@/lib/linkedin-enricher";
import { Download, Loader2, CheckCircle2, AlertCircle, Mail, Users, ArrowLeft, RotateCcw, Trash2 } from "lucide-react";

type ProcessingStage = "idle" | "fetching" | "filtering" | "enriching" | "complete";

const STORAGE_KEY = "linkedin-enricher-progress";

interface SavedState {
  urls: string[];
  allProfiles: LinkedInProfile[];
  filteredResults: Array<{ profile: LinkedInProfile; icp_result: ICPFilterResult }>;
  results: EnrichedLead[];
  stats: {
    total_reactions: number;
    reactions_fetched: number;
    icp_qualified: number;
    enriched: number;
    failed_enrichments: number;
  };
  stage: ProcessingStage;
  filterIndex: number;
  enrichIndex: number;
  enrichmentProvider?: 'clado' | 'apollo';
  savedAt: number;
}

// Helper functions for localStorage persistence
const saveProgress = (state: SavedState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log("[Progress] Saved state:", state.stage, "filter:", state.filterIndex, "enrich:", state.enrichIndex);
  } catch (e) {
    console.error("[Progress] Failed to save:", e);
  }
};

const loadProgress = (): SavedState | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved) as SavedState;
      // Check if saved state is less than 24 hours old
      if (Date.now() - state.savedAt < 24 * 60 * 60 * 1000) {
        return state;
      }
    }
  } catch (e) {
    console.error("[Progress] Failed to load:", e);
  }
  return null;
};

const clearProgress = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log("[Progress] Cleared saved state");
  } catch (e) {
    console.error("[Progress] Failed to clear:", e);
  }
};

export default function LinkedInEnricherPage() {
  const [postUrls, setPostUrls] = useState("");
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
  const [savedState, setSavedState] = useState<SavedState | null>(null);
  const [enrichmentProvider, setEnrichmentProvider] = useState<'clado' | 'apollo'>('clado');

  // Check for saved progress on mount
  useEffect(() => {
    const saved = loadProgress();
    if (saved && saved.stage !== "complete" && saved.stage !== "idle") {
      setSavedState(saved);
      console.log("[Progress] Found saved state from", new Date(saved.savedAt).toLocaleString());
    }
  }, []);

  // Resume from saved state
  const handleResume = useCallback(async () => {
    if (!savedState) return;

    console.log("[Resume] Resuming from saved state:", savedState.stage);
    setPostUrls(savedState.urls.join('\n'));
    setStats(savedState.stats);
    setError(null);

    // Restore provider selection if it was saved
    if (savedState.enrichmentProvider) {
      setEnrichmentProvider(savedState.enrichmentProvider);
    }

    if (savedState.stage === "filtering") {
      // Resume filtering
      setProcessing(true);
      setStage("filtering");
      await resumeFiltering(savedState);
    } else if (savedState.stage === "enriching") {
      // Resume enriching - first restore results
      setResults(savedState.results);
      setEnriching(true);
      setStage("enriching");
      await resumeEnriching(savedState);
    } else {
      // Just restore the state
      setResults(savedState.results);
      setStage(savedState.stage);
    }

    setSavedState(null);
  }, [savedState]);

  // Discard saved progress
  const handleDiscardSaved = useCallback(() => {
    clearProgress();
    setSavedState(null);
  }, []);

  // Resume filtering from saved state
  const resumeFiltering = async (saved: SavedState) => {
    const BATCH_SIZE = 10; // Reduced from 20 to work with Vercel Hobby plan timeout
    const PARALLEL_BATCHES = 2; // Reduced from 5 to avoid overwhelming Vercel
    const allProfiles = saved.allProfiles;
    const allFilteredResults = [...saved.filteredResults];
    const startIndex = saved.filterIndex;

    setProgress({ stage: "Filtering by ICP (resumed)", current: startIndex, total: allProfiles.length });

    try {
      // Create remaining batches from where we left off
      const remainingProfiles = allProfiles.slice(startIndex);
      const batches: LinkedInProfile[][] = [];
      for (let i = 0; i < remainingProfiles.length; i += BATCH_SIZE) {
        batches.push(remainingProfiles.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel groups
      for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);

        const batchPromises = parallelBatches.map(async (batch) => {
          const filterResponse = await fetch("/api/linkedin-enricher/filter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profiles: batch }),
          });

          if (!filterResponse.ok) {
            const text = await filterResponse.text();
            let errorMessage = `Failed to filter batch (${filterResponse.status})`;
            try {
              const errorData = JSON.parse(text);
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = text.slice(0, 100) || errorMessage;
            }
            throw new Error(errorMessage);
          }

          const { results } = await filterResponse.json();
          return results;
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(results => allFilteredResults.push(...results));

        const processedBatches = Math.min(i + PARALLEL_BATCHES, batches.length);
        const processed = startIndex + Math.min(processedBatches * BATCH_SIZE, remainingProfiles.length);
        setProgress({ stage: "Filtering by ICP (resumed)", current: processed, total: allProfiles.length });

        // Save progress after each parallel group
        saveProgress({
          ...saved,
          filteredResults: allFilteredResults,
          filterIndex: processed,
          savedAt: Date.now(),
        });

        if (i + PARALLEL_BATCHES < batches.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Filtering complete
      const acceptedLeads = allFilteredResults.filter(r => r.icp_result.decision === "ACCEPT");
      const pendingLeads = acceptedLeads.map(item => ({
        profile: item.profile,
        icp_result: item.icp_result,
        contact: {},
        enrichment_status: "PENDING" as const,
      }));

      const newStats = {
        ...saved.stats,
        icp_qualified: acceptedLeads.length,
      };

      setStats(newStats);
      setResults(pendingLeads);
      setProgress(null);
      setStage("complete");
      setProcessing(false);

      // Save completed filter state
      saveProgress({
        ...saved,
        filteredResults: allFilteredResults,
        results: pendingLeads,
        stats: newStats,
        stage: "complete",
        filterIndex: allProfiles.length,
        savedAt: Date.now(),
      });
    } catch (err) {
      console.error("[Resume] Filter error:", err);
      setError(err instanceof Error ? err.message : "Failed to resume filtering");
      setProcessing(false);
      setProgress(null);
    }
  };

  // Resume enriching from saved state
  const resumeEnriching = async (saved: SavedState) => {
    const BATCH_SIZE = 5;
    const PARALLEL_BATCHES = 4;
    const leadsToEnrich = saved.results;
    const enrichedLeads: EnrichedLead[] = [];
    const startIndex = saved.enrichIndex;
    let successCount = saved.stats.enriched;
    let failCount = saved.stats.failed_enrichments;

    // Use the provider from saved state, or fall back to current selection
    const provider = saved.enrichmentProvider || enrichmentProvider;

    // Copy already enriched leads
    for (let i = 0; i < startIndex && i < leadsToEnrich.length; i++) {
      enrichedLeads.push(leadsToEnrich[i]);
    }

    setProgress({ stage: "Enriching contacts (resumed)", current: startIndex, total: leadsToEnrich.length });

    try {
      // Create remaining batches from where we left off
      const remainingLeads = leadsToEnrich.slice(startIndex);
      const batches: EnrichedLead[][] = [];
      for (let i = 0; i < remainingLeads.length; i += BATCH_SIZE) {
        batches.push(remainingLeads.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel groups
      for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);

        const batchPromises = parallelBatches.map(async (batch) => {
          const response = await fetch("/api/linkedin-enricher", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leads: batch, provider }),
          });

          if (!response.ok) {
            const text = await response.text();
            let errorMessage = `Failed to enrich batch (${response.status})`;
            try {
              const errorData = JSON.parse(text);
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = text.slice(0, 100) || errorMessage;
            }
            throw new Error(errorMessage);
          }

          const data = await response.json();
          return data;
        });

        const batchResults = await Promise.all(batchPromises);

        // Aggregate results from parallel batches
        batchResults.forEach(data => {
          enrichedLeads.push(...data.results);
          successCount += data.enriched;
          failCount += data.failed_enrichments;
        });

        const processedBatches = Math.min(i + PARALLEL_BATCHES, batches.length);
        const processed = startIndex + Math.min(processedBatches * BATCH_SIZE, remainingLeads.length);
        setProgress({ stage: "Enriching contacts (resumed)", current: processed, total: leadsToEnrich.length });

        // Update results and stats in real-time
        const currentResults = [...enrichedLeads, ...leadsToEnrich.slice(processed)];
        setResults(currentResults);
        const currentStats = {
          ...saved.stats,
          enriched: successCount,
          failed_enrichments: failCount,
        };
        setStats(currentStats);

        // Save progress after each parallel group
        saveProgress({
          ...saved,
          results: currentResults,
          stats: currentStats,
          enrichIndex: processed,
          savedAt: Date.now(),
        });

        if (i + PARALLEL_BATCHES < batches.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Enrichment complete
      setResults(enrichedLeads);
      setProgress(null);
      setStage("complete");
      setEnriching(false);

      // Clear saved state on completion
      clearProgress();

      // Auto-download CSV
      const successfulLeads = enrichedLeads.filter(lead => lead.enrichment_status === "SUCCESS");
      if (successfulLeads.length > 0) {
        const csv = convertToCSV(successfulLeads);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `linkedin_enriched_leads_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[Resume] Enrich error:", err);
      setError(err instanceof Error ? err.message : "Failed to resume enrichment");
      setEnriching(false);
      setProgress(null);
    }
  };

  const handleSubmit = async () => {
    if (!postUrls.trim()) return;

    // Parse URLs (one per line)
    const urls = postUrls.split('\n').map(url => url.trim()).filter(url => url.length > 0);

    if (urls.length === 0) return;

    console.log(`[Frontend] Starting processing for ${urls.length} URL(s):`, urls);
    setProcessing(true);
    setError(null);
    setResults([]);
    setStats(null);
    setProgress(null);

    try {
      // STAGE 1: Fetch reactions from all URLs in parallel
      setStage("fetching");
      setProgress({ stage: `Fetching reactions from ${urls.length} LinkedIn post(s)`, current: 0, total: urls.length });

      console.log("[Frontend] Fetching reactions from multiple URLs in parallel");
      const fetchPromises = urls.map(url =>
        fetch("/api/linkedin-enricher/fetch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ post_url: url }),
        }).then(async (response) => {
          if (!response.ok) {
            // Try to parse JSON error, but handle plain text responses
            const text = await response.text();
            let errorMessage = `Failed to fetch (${response.status})`;
            try {
              const errorData = JSON.parse(text);
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = text.slice(0, 100) || errorMessage;
            }
            console.error(`Failed to fetch ${url}:`, errorMessage);
            return { profiles: [], url, error: errorMessage };
          }
          const data = await response.json();
          return { profiles: data.profiles, url, error: null };
        })
      );

      const fetchResults = await Promise.all(fetchPromises);

      // Aggregate all profiles
      const allProfiles = fetchResults.flatMap(result => result.profiles);
      const failedUrls = fetchResults.filter(r => r.error).map(r => r.url);

      if (failedUrls.length > 0) {
        console.warn(`[Frontend] Failed to fetch from ${failedUrls.length} URL(s):`, failedUrls);
      }

      console.log(`[Frontend] Fetched ${allProfiles.length} total profiles from ${urls.length} post(s)`);

      setProgress({ stage: "Fetching complete", current: allProfiles.length, total: allProfiles.length });

      if (allProfiles.length === 0) {
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
      setProgress({ stage: "Filtering by ICP", current: 0, total: allProfiles.length });

      const BATCH_SIZE = 10; // Reduced from 20 to work with Vercel Hobby plan timeout
      const PARALLEL_BATCHES = 2; // Reduced from 5 to avoid overwhelming Vercel (was 100 profiles at once)
      const allFilteredResults: Array<{ profile: LinkedInProfile; icp_result: ICPFilterResult }> = [];

      // Initialize stats for saving progress
      const initialStats = {
        total_reactions: allProfiles.length,
        reactions_fetched: allProfiles.length,
        icp_qualified: 0,
        enriched: 0,
        failed_enrichments: 0,
      };

      // Create all batches
      const batches: LinkedInProfile[][] = [];
      for (let i = 0; i < allProfiles.length; i += BATCH_SIZE) {
        batches.push(allProfiles.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel groups
      for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);

        // Run multiple batches in parallel
        const batchPromises = parallelBatches.map(async (batch) => {
          const filterResponse = await fetch("/api/linkedin-enricher/filter", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ profiles: batch }),
          });

          if (!filterResponse.ok) {
            const text = await filterResponse.text();
            let errorMessage = `Failed to filter batch (${filterResponse.status})`;
            try {
              const errorData = JSON.parse(text);
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = text.slice(0, 100) || errorMessage;
            }
            throw new Error(errorMessage);
          }

          const { results } = await filterResponse.json();
          return results;
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(results => allFilteredResults.push(...results));

        // Update progress
        const processedBatches = Math.min(i + PARALLEL_BATCHES, batches.length);
        const processedProfiles = Math.min(processedBatches * BATCH_SIZE, allProfiles.length);
        setProgress({ stage: "Filtering by ICP", current: processedProfiles, total: allProfiles.length });

        // Save progress after each parallel group
        saveProgress({
          urls,
          allProfiles,
          filteredResults: allFilteredResults,
          results: [],
          stats: initialStats,
          stage: "filtering",
          filterIndex: processedProfiles,
          enrichIndex: 0,
          savedAt: Date.now(),
        });

        // Small delay between parallel groups
        if (i + PARALLEL_BATCHES < batches.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Filter for accepted leads
      const acceptedLeads = allFilteredResults.filter(r => r.icp_result.decision === "ACCEPT");

      console.log(`[Frontend] Filtering complete: ${acceptedLeads.length}/${allProfiles.length} qualified`);

      // Convert to enriched lead format with PENDING status
      const pendingLeads = acceptedLeads.map(item => ({
        profile: item.profile,
        icp_result: item.icp_result,
        contact: {},
        enrichment_status: "PENDING" as const,
      }));

      const completeStats = {
        total_reactions: allProfiles.length,
        reactions_fetched: allProfiles.length,
        icp_qualified: acceptedLeads.length,
        enriched: 0,
        failed_enrichments: 0,
      };

      setStats(completeStats);
      setResults(pendingLeads);
      setProgress(null);
      setStage("complete");

      // Save completed filter state (ready for enrichment)
      saveProgress({
        urls,
        allProfiles,
        filteredResults: allFilteredResults,
        results: pendingLeads,
        stats: completeStats,
        stage: "complete",
        filterIndex: allProfiles.length,
        enrichIndex: 0,
        savedAt: Date.now(),
      });
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

    // Validate company data for Apollo provider
    if (enrichmentProvider === 'apollo') {
      const leadsWithoutCompany = results.filter(r => !r.profile.company);
      if (leadsWithoutCompany.length > 0) {
        console.warn(`[Frontend] ${leadsWithoutCompany.length} leads missing company data for Apollo enrichment`);
        // You could show a warning to the user here if needed
      }
    }

    console.log("[Frontend] Starting enrichment for", results.length, "leads using", enrichmentProvider);
    setEnriching(true);
    setError(null);
    setProgress({ stage: "Enriching contacts", current: 0, total: results.length });

    // Load saved state for context (urls, allProfiles, filteredResults)
    const savedContext = loadProgress();
    const urls = savedContext?.urls || postUrls.split('\n').map(u => u.trim()).filter(u => u);
    const allProfiles = savedContext?.allProfiles || [];
    const filteredResults = savedContext?.filteredResults || [];

    try {
      const BATCH_SIZE = 5;
      const PARALLEL_BATCHES = 4; // Run 4 batches in parallel = 20 leads at once
      const enrichedLeads: EnrichedLead[] = [];
      let successCount = 0;
      let failCount = 0;

      // Create all batches
      const batches: EnrichedLead[][] = [];
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        batches.push(results.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel groups
      for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);

        // Run multiple batches in parallel
        const batchPromises = parallelBatches.map(async (batch) => {
          const response = await fetch("/api/linkedin-enricher", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ leads: batch, provider: enrichmentProvider }),
          });

          if (!response.ok) {
            const text = await response.text();
            let errorMessage = `Failed to enrich batch (${response.status})`;
            try {
              const errorData = JSON.parse(text);
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = text.slice(0, 100) || errorMessage;
            }
            throw new Error(errorMessage);
          }

          const data = await response.json();
          return data;
        });

        const batchResults = await Promise.all(batchPromises);

        // Aggregate results from parallel batches
        batchResults.forEach(data => {
          enrichedLeads.push(...data.results);
          successCount += data.enriched;
          failCount += data.failed_enrichments;
        });

        // Update progress
        const processedBatches = Math.min(i + PARALLEL_BATCHES, batches.length);
        const processed = Math.min(processedBatches * BATCH_SIZE, results.length);
        setProgress({ stage: "Enriching contacts", current: processed, total: results.length });

        // Update results in real-time
        const currentResults = [...enrichedLeads, ...results.slice(processed)];
        setResults(currentResults);

        // Update stats in real-time
        const currentStats = {
          total_reactions: stats?.total_reactions || results.length,
          reactions_fetched: stats?.reactions_fetched || results.length,
          icp_qualified: stats?.icp_qualified || results.length,
          enriched: successCount,
          failed_enrichments: failCount,
        };
        setStats(currentStats);

        // Save progress after each parallel group
        saveProgress({
          urls,
          allProfiles,
          filteredResults,
          results: currentResults,
          stats: currentStats,
          stage: "enriching",
          filterIndex: allProfiles.length,
          enrichIndex: processed,
          enrichmentProvider,
          savedAt: Date.now(),
        });

        // Small delay between parallel groups
        if (i + PARALLEL_BATCHES < batches.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`[Frontend] Enrichment complete: ${successCount} successful, ${failCount} failed`);

      // Final stats update
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

      // Clear saved state on successful completion
      clearProgress();

      // Auto-download CSV with enriched leads
      const successfulLeads = enrichedLeads.filter(lead => lead.enrichment_status === "SUCCESS");
      if (successfulLeads.length > 0) {
        const csv = convertToCSV(successfulLeads);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `linkedin_enriched_leads_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
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

  const downloadFilteredCSV = () => {
    // Export filtered leads (before enrichment) - just the basic profile + ICP info
    if (results.length === 0) return;

    const headers = [
      "name",
      "headline",
      "linkedin_url",
      "reaction_type",
      "company",
      "icp_decision",
      "icp_reasoning",
      "icp_confidence",
      "extracted_company",
      "extracted_role",
      "extracted_seniority",
      "estimated_company_size",
    ];

    const rows = results.map((lead) => {
      return [
        lead.profile.name,
        `"${lead.profile.headline.replace(/"/g, '""')}"`,
        lead.profile.linkedin_url,
        lead.profile.reaction_type || "",
        lead.profile.company || "",
        lead.icp_result.decision,
        `"${lead.icp_result.reasoning.replace(/"/g, '""')}"`,
        lead.icp_result.confidence,
        lead.icp_result.extracted_info?.company || "",
        lead.icp_result.extracted_info?.role || "",
        lead.icp_result.extracted_info?.seniority_level || "",
        lead.icp_result.extracted_info?.estimated_company_size || "",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linkedin_filtered_leads_${new Date().toISOString().split('T')[0]}.csv`;
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

      {/* Resume Progress Banner */}
      {savedState && (
        <Card className="mb-6 border-blue-500 bg-blue-50 dark:bg-blue-950">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <RotateCcw className="h-5 w-5" />
              Resume Previous Progress
            </CardTitle>
            <CardDescription className="text-blue-600 dark:text-blue-400">
              Found saved progress from {new Date(savedState.savedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-sm text-blue-700 dark:text-blue-300">
                <p><strong>Stage:</strong> {savedState.stage === "filtering" ? "ICP Filtering" : savedState.stage === "enriching" ? "Contact Enrichment" : savedState.stage}</p>
                <p><strong>URLs:</strong> {savedState.urls.length} post(s)</p>
                <p><strong>Profiles fetched:</strong> {savedState.allProfiles.length}</p>
                {savedState.stage === "filtering" && (
                  <p><strong>Filtered:</strong> {savedState.filterIndex} / {savedState.allProfiles.length}</p>
                )}
                {savedState.stage === "enriching" && (
                  <p><strong>Enriched:</strong> {savedState.enrichIndex} / {savedState.results.length}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleResume} className="bg-blue-600 hover:bg-blue-700">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resume Processing
                </Button>
                <Button onClick={handleDiscardSaved} variant="outline" className="text-red-600 border-red-300 hover:bg-red-50">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Discard & Start Fresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Input Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>LinkedIn Post URLs</CardTitle>
          <CardDescription>
            Enter one or more LinkedIn post URLs (one per line) to extract and enrich reactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="post-urls">Post URLs (one per line)</Label>
              <Textarea
                id="post-urls"
                placeholder="https://www.linkedin.com/posts/username_activity-123456789
https://www.linkedin.com/posts/username2_activity-987654321
https://www.linkedin.com/posts/username3_activity-555555555"
                rows={5}
                value={postUrls}
                onChange={(e) => setPostUrls(e.target.value)}
                disabled={processing}
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!postUrls.trim() || processing}
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
              <div className="flex items-center gap-4">
                {/* Provider Selection - only show if leads are pending */}
                {results.some(r => r.enrichment_status === "PENDING") && !enriching && (
                  <div className="flex items-center gap-3">
                    <Label className="text-sm font-medium whitespace-nowrap">
                      Enrichment Provider:
                    </Label>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="enrichment-provider"
                          value="clado"
                          checked={enrichmentProvider === 'clado'}
                          onChange={(e) => setEnrichmentProvider(e.target.value as 'clado' | 'apollo')}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">Clado (LinkedIn URL)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="enrichment-provider"
                          value="apollo"
                          checked={enrichmentProvider === 'apollo'}
                          onChange={(e) => setEnrichmentProvider(e.target.value as 'clado' | 'apollo')}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">Apollo (Name + Company)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {/* Show download filtered list button if leads are pending */}
                {results.some(r => r.enrichment_status === "PENDING") && !enriching && (
                  <Button onClick={downloadFilteredCSV} variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Download Filtered List ({results.length})
                  </Button>
                )}
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
                    Download Enriched CSV ({stats.enriched})
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
