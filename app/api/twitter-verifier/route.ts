import { NextRequest, NextResponse } from "next/server";
import { analyzeLead, parseCSV, type TwitterLead, type FilterResult } from "@/lib/twitter-verifier";
import { batchFilterByLocation } from "@/lib/location-filter";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    // Read CSV content
    const csvContent = await file.text();
    const leads = parseCSV(csvContent);

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found in CSV" },
        { status: 400 }
      );
    }

    // Return initial response with lead count
    return NextResponse.json({
      total: leads.length,
      message: "CSV parsed successfully. Use /api/twitter-verifier/analyze to process leads.",
    });
  } catch (error) {
    console.error("Error processing CSV:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process CSV",
      },
      { status: 500 }
    );
  }
}

// Endpoint to analyze a single lead
export async function PUT(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const lead: TwitterLead = await request.json();

    if (!lead.name || !lead.description) {
      return NextResponse.json(
        { error: "Lead must have name and description" },
        { status: 400 }
      );
    }

    const result = await analyzeLead(lead, apiKey);

    return NextResponse.json({
      lead,
      result,
    });
  } catch (error) {
    console.error("Error analyzing lead:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to analyze lead",
      },
      { status: 500 }
    );
  }
}

// Endpoint to analyze multiple leads in parallel (batch processing)
export async function PATCH(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { leads }: { leads: TwitterLead[] } = await request.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: "Must provide an array of leads" },
        { status: 400 }
      );
    }

    // Process all leads in parallel
    const results = await Promise.allSettled(
      leads.map(lead => analyzeLead(lead, apiKey))
    );

    // Map results back to leads
    const processedLeads = leads.map((lead, index) => {
      const result = results[index];
      if (result.status === "fulfilled") {
        return {
          lead,
          result: result.value,
          error: null
        };
      } else {
        return {
          lead,
          result: {
            decision: "REJECT" as const,
            reasoning: `Error: ${result.reason}`,
            confidence: "LOW" as const
          },
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        };
      }
    });

    return NextResponse.json({
      processed: processedLeads.length,
      results: processedLeads
    });
  } catch (error) {
    console.error("Error batch analyzing leads:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to batch analyze leads",
      },
      { status: 500 }
    );
  }
}
