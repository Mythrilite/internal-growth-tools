import { NextRequest, NextResponse } from "next/server";
import { validateLinkedInPostUrl, fetchPostReactions } from "@/lib/linkedin-enricher";

export async function POST(request: NextRequest) {
  try {
    const cladoApiKey = process.env.CLADO_API_KEY;

    if (!cladoApiKey) {
      return NextResponse.json(
        { error: "CLADO_API_KEY not configured" },
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

    console.log(`[Fetch] Starting fetch for: ${post_url}`);

    // Fetch all reactions (with pagination)
    const profiles = await fetchPostReactions(post_url, cladoApiKey);

    console.log(`[Fetch] Fetched ${profiles.length} profiles`);

    return NextResponse.json({
      profiles,
      total: profiles.length,
    });
  } catch (error) {
    console.error("[Fetch] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch reactions",
      },
      { status: 500 }
    );
  }
}
