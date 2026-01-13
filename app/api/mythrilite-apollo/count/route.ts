import { NextRequest, NextResponse } from "next/server";

const ICYPEAS_API_URL = "https://app.icypeas.com/api/find-people/count";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ICYPEAS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Icypeas API key not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { query } = body;

    if (!query || Object.keys(query).length === 0) {
      return NextResponse.json(
        { error: "Query is required and cannot be empty" },
        { status: 400 }
      );
    }

    const response = await fetch(ICYPEAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || "Failed to count leads", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Icypeas count error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
