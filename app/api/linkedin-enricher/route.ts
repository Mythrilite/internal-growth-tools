import { NextRequest, NextResponse } from "next/server";
import {
  validateLinkedInPostUrl,
  fetchPostReactions,
  filterByICP,
  enrichContact,
  enrichContactApollo,
  type LinkedInProfile,
  type ICPFilterResult,
  type EnrichedLead,
  type ContactData,
} from "@/lib/linkedin-enricher";

export async function POST(request: NextRequest) {
  try {
    const cladoApiKey = process.env.CLADO_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!cladoApiKey) {
      return NextResponse.json(
        { error: "CLADO_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (!openRouterKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { post_url } = await request.json();

    if (!post_url) {
      return NextResponse.json(
        { error: "LinkedIn post URL is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    if (!validateLinkedInPostUrl(post_url)) {
      return NextResponse.json(
        { error: "Invalid LinkedIn post URL format" },
        { status: 400 }
      );
    }

    console.log(`[LinkedIn Enricher] Starting processing for: ${post_url}`);

    // STAGE 1: Fetch all reactions (with pagination)
    console.log("[LinkedIn Enricher] Stage 1: Fetching reactions...");
    const reactions = await fetchPostReactions(post_url, cladoApiKey);
    console.log(`[LinkedIn Enricher] Fetched ${reactions.length} reactions`);

    if (reactions.length === 0) {
      return NextResponse.json({
        total_reactions: 0,
        reactions_fetched: 0,
        icp_qualified: 0,
        enriched: 0,
        failed_enrichments: 0,
        results: [],
      });
    }

    // STAGE 2: Filter by ICP (parallel batches)
    console.log("[LinkedIn Enricher] Stage 2: Filtering by ICP...");
    const BATCH_SIZE = 20;
    const icpResults: Array<{
      profile: LinkedInProfile;
      icp_result: ICPFilterResult;
    }> = [];

    for (let i = 0; i < reactions.length; i += BATCH_SIZE) {
      const batch = reactions.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (profile) => {
          const icp_result = await filterByICP(profile, openRouterKey);
          return { profile, icp_result };
        })
      );

      // Extract successful results
      batchResults.forEach((result) => {
        if (result.status === "fulfilled") {
          icpResults.push(result.value);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < reactions.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Filter for accepted leads only
    const acceptedLeads = icpResults.filter(
      (item) => item.icp_result.decision === "ACCEPT"
    );

    console.log(
      `[LinkedIn Enricher] ICP filtering complete: ${acceptedLeads.length}/${reactions.length} qualified`
    );

    // Return filtered results WITHOUT enrichment
    // Convert to format with empty contact data
    const filteredLeads = acceptedLeads.map((item) => ({
      profile: item.profile,
      icp_result: item.icp_result,
      contact: {},
      enrichment_status: "PENDING" as const,
    }));

    return NextResponse.json({
      total_reactions: reactions.length,
      reactions_fetched: reactions.length,
      icp_qualified: acceptedLeads.length,
      enriched: 0,
      failed_enrichments: 0,
      results: filteredLeads,
    });
  } catch (error) {
    console.error("[LinkedIn Enricher] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to process LinkedIn post",
      },
      { status: 500 }
    );
  }
}

// PATCH endpoint to enrich already filtered leads
export async function PATCH(request: NextRequest) {
  try {
    const cladoApiKey = process.env.CLADO_API_KEY;
    const apolloApiKey = process.env.APOLLO_API_KEY;

    const { leads, provider = 'clado' } = await request.json();

    // Validate API keys based on provider
    if (provider === 'clado' && !cladoApiKey) {
      return NextResponse.json(
        { error: "CLADO_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (provider === 'apollo' && !apolloApiKey) {
      return NextResponse.json(
        { error: "APOLLO_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: "No leads provided for enrichment" },
        { status: 400 }
      );
    }

    console.log(`[LinkedIn Enricher] Starting enrichment for ${leads.length} leads using ${provider} provider`);

    const enrichedLeads: EnrichedLead[] = [];
    let successfulEnrichments = 0;
    let failedEnrichments = 0;

    // Process enrichment in smaller batches to respect rate limits
    const ENRICHMENT_BATCH_SIZE = 5;
    for (let i = 0; i < leads.length; i += ENRICHMENT_BATCH_SIZE) {
      const batch = leads.slice(i, i + ENRICHMENT_BATCH_SIZE);

      const enrichmentResults = await Promise.allSettled(
        batch.map(async (lead: any) => {
          try {
            // Use appropriate enrichment function based on provider
            const contact = provider === 'apollo'
              ? await enrichContactApollo(lead.profile, apolloApiKey!)
              : await enrichContact(lead.profile.linkedin_url, cladoApiKey!);

            // Include all leads, whether they have emails or not
            if (contact.email) {
              successfulEnrichments++;
              return {
                profile: lead.profile,
                icp_result: lead.icp_result,
                contact,
                enrichment_status: "SUCCESS" as const,
              };
            } else {
              failedEnrichments++;
              return {
                profile: lead.profile,
                icp_result: lead.icp_result,
                contact: {},
                enrichment_status: "FAILED" as const,
                error: "No email found",
              };
            }
          } catch (error) {
            failedEnrichments++;
            return {
              profile: lead.profile,
              icp_result: lead.icp_result,
              contact: {},
              enrichment_status: "FAILED" as const,
              error: error instanceof Error ? error.message : "Enrichment failed",
            };
          }
        })
      );

      enrichmentResults.forEach((result) => {
        if (result.status === "fulfilled") {
          enrichedLeads.push(result.value);
        }
      });

      // Rate limiting: wait between enrichment batches
      if (i + ENRICHMENT_BATCH_SIZE < leads.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    console.log(
      `[LinkedIn Enricher] Enrichment complete: ${successfulEnrichments} successful, ${failedEnrichments} failed`
    );

    return NextResponse.json({
      enriched: successfulEnrichments,
      failed_enrichments: failedEnrichments,
      results: enrichedLeads,
    });
  } catch (error) {
    console.error("[LinkedIn Enricher] Enrichment error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to enrich contacts",
      },
      { status: 500 }
    );
  }
}
