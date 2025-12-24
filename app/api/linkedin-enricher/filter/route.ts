import { NextRequest, NextResponse } from "next/server";
import { filterByICP, type LinkedInProfile, type ICPFilterResult } from "@/lib/linkedin-enricher";

export async function POST(request: NextRequest) {
  try {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { profiles } = await request.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
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

    // Extract successful results
    const filteredResults = results
      .filter((r): r is PromiseFulfilledResult<{ profile: LinkedInProfile; icp_result: ICPFilterResult }> => r.status === "fulfilled")
      .map(r => r.value);

    console.log(`[Filter] Filtered ${filteredResults.length} profiles successfully`);

    return NextResponse.json({
      results: filteredResults,
    });
  } catch (error) {
    console.error("[Filter] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to filter profiles",
      },
      { status: 500 }
    );
  }
}
