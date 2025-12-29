import { NextRequest, NextResponse } from "next/server";
import { filterByICP, type LinkedInProfile, type ICPFilterResult } from "@/lib/linkedin-enricher";

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

    console.log(`[Filter] Filtering ${profiles.length} profiles`);

    // Process all profiles in parallel
    const results = await Promise.allSettled(
      profiles.map(async (profile: LinkedInProfile) => {
        const icp_result = await filterByICP(profile, openRouterKey);
        return { profile, icp_result };
      })
    );

    // Extract successful results and log failures
    const filteredResults = results
      .filter((r): r is PromiseFulfilledResult<{ profile: LinkedInProfile; icp_result: ICPFilterResult }> => r.status === "fulfilled")
      .map(r => r.value);

    const failedResults = results.filter(r => r.status === "rejected");
    if (failedResults.length > 0) {
      console.error(`[Filter] ${failedResults.length} profiles failed to filter`);
    }

    console.log(`[Filter] Filtered ${filteredResults.length}/${profiles.length} profiles successfully`);

    return NextResponse.json({
      results: filteredResults,
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
