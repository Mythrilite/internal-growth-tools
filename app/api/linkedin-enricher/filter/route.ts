import { NextRequest, NextResponse } from "next/server";
import { filterByICP, type LinkedInProfile, type ICPFilterResult } from "@/lib/linkedin-enricher";

// Process profiles in batches to avoid timeout
const BATCH_SIZE = 5; // Process 5 profiles concurrently

async function processBatch(
  profiles: LinkedInProfile[],
  openRouterKey: string
): Promise<{ profile: LinkedInProfile; icp_result: ICPFilterResult }[]> {
  const results = await Promise.allSettled(
    profiles.map(async (profile) => {
      const icp_result = await filterByICP(profile, openRouterKey);
      return { profile, icp_result };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ profile: LinkedInProfile; icp_result: ICPFilterResult }> =>
      r.status === "fulfilled"
    )
    .map(r => r.value);
}

export const maxDuration = 60; // Set max duration to 60 seconds (requires Vercel Pro)

export async function POST(request: NextRequest) {
  try {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      console.error("[Filter] OPENROUTER_API_KEY not configured in environment");
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured. Please add it to your Vercel environment variables." },
        { status: 500 }
      );
    }

    const body = await request.json();
    console.log("[Filter] Request body keys:", Object.keys(body));

    const { profiles } = body;

    if (!Array.isArray(profiles)) {
      console.error("[Filter] Profiles is not an array:", typeof profiles);
      return NextResponse.json(
        { error: "Invalid request: profiles must be an array" },
        { status: 400 }
      );
    }

    if (profiles.length === 0) {
      console.log("[Filter] Empty profiles array received");
      return NextResponse.json(
        { error: "No profiles provided for filtering" },
        { status: 400 }
      );
    }

    console.log(`[Filter] Filtering ${profiles.length} profiles in batches of ${BATCH_SIZE}`);

    // Process profiles in batches to avoid timeout
    const allResults: { profile: LinkedInProfile; icp_result: ICPFilterResult }[] = [];

    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(profiles.length / BATCH_SIZE);

      console.log(`[Filter] Processing batch ${batchNum}/${totalBatches} (${batch.length} profiles)`);

      const batchResults = await processBatch(batch, openRouterKey);
      allResults.push(...batchResults);

      console.log(`[Filter] Batch ${batchNum} complete. Total processed: ${allResults.length}/${profiles.length}`);
    }

    console.log(`[Filter] Filtered ${allResults.length}/${profiles.length} profiles successfully`);

    return NextResponse.json({
      results: allResults,
    });
  } catch (error) {
    console.error("[Filter] Unexpected error:", error);
    console.error("[Filter] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to filter profiles",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
