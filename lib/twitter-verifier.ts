import * as Papa from 'papaparse';

export interface TwitterLead {
  name: string;
  description: string;
  location?: string;
  public_metrics?: string | { followers_count?: number; following_count?: number; tweet_count?: number; listed_count?: number };
  username?: string; // Twitter handle
  twitter_handle?: string; // Alternative name for username
  [key: string]: any;
}

export interface FilterResult {
  decision: "ACCEPT" | "REJECT";
  reasoning: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  extracted_info?: {
    company?: string;
    role?: string;
    estimated_company_size?: string;
    estimated_funding?: string;
    location?: string;
  };
}

export const FILTER_PROMPT = `You are an expert at analyzing Twitter profiles to identify potential B2B software leads.

CRITERIA FOR ACCEPTANCE:
✅ Company has 20-2000 engineers (software/ML/data engineers, etc.)
✅ Company is primarily a software/tech company
✅ Company has raised Seed+ funding (ideally Series A or beyond)
✅ Company is US-based (REQUIRED - check location field carefully)
✅ Person's role is: Founder, Co-founder, Head of X, VP, Director, Engineer, Manager, or similar technical/leadership role
✅ Mid-sized tech companies (startups, scale-ups, growth-stage companies)

REJECT IF:
❌ Student, freelancer, consultant, agency worker
❌ Non-tech company (retail, restaurant, traditional services)
❌ Pre-seed/bootstrapped unless clearly a large company
❌ Non-US location (if location provided, it MUST be in the United States)
❌ Influencer, content creator, educator (unless also working at qualifying company)
❌ Insufficient information to determine
❌ VERY LARGE COMPANIES (CRITICAL): Meta/Facebook, Google, Amazon, Apple, Microsoft, Netflix, Oracle, IBM, Salesforce, Adobe, Intel, Cisco, Dell, HP, SAP, Workday, ServiceNow, or any company with 2000+ employees
❌ Public companies with massive scale (unicorns worth $10B+, publicly traded tech giants)

LOCATION FILTERING (CRITICAL):
- If a location field is provided, it MUST be in the United States
- US locations include: any US state, US cities (SF, NYC, Seattle, Austin, Boulder, etc.), or "United States"
- REJECT if location is: UK, Canada, Europe, Asia, Australia, Remote (unless explicitly says "Remote, US"), or any non-US country
- If no location is provided, make reasonable inferences from description

IMPORTANT:
- Make reasonable inferences based on description context
- Focus on growth-stage companies (Series A-D, 20-2000 employees)
- EXCLUDE people from mega-corporations and enterprise giants
- Target: startups, scale-ups, and mid-market tech companies
- "Stealth" startups with experienced founders can qualify if they mention funding
- If description mentions specific funding round or investor, consider that strong signal

RESPONSE FORMAT (JSON):
{
  "decision": "ACCEPT" or "REJECT",
  "reasoning": "Brief explanation of your decision",
  "confidence": "HIGH", "MEDIUM", or "LOW",
  "extracted_info": {
    "company": "Company name if mentioned",
    "role": "Their role",
    "estimated_company_size": "Your estimate (e.g., 20-50, 50-200, 200-500, 500-2000)",
    "estimated_funding": "Your estimate",
    "location": "Location if mentioned"
  }
}`;

export async function analyzeLead(
  lead: TwitterLead,
  apiKey: string
): Promise<FilterResult> {
  const userPrompt = `Name: ${lead.name}
Description: ${lead.description}
${lead.location ? `Location: ${lead.location}` : ""}
${lead.twitter_handle ? `Twitter: @${lead.twitter_handle}` : ""}

Analyze this lead and determine if they meet our criteria.`;

  try {
    // Get the app URL - try NEXT_PUBLIC_APP_URL first, then VERCEL_URL, then fallback
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || "https://myth-internal-growth-tools.vercel.app";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": appUrl,
        "X-Title": "Mythrilite - Twitter Lead Verifier",
      },
      body: JSON.stringify({
        model: "x-ai/grok-4.1-fast",
        messages: [
          {
            role: "system",
            content: FILTER_PROMPT,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`OpenRouter API error (${response.status}):`, errorData);
      // Don't throw - return REJECT instead to allow batch to continue
      return {
        decision: "REJECT",
        reasoning: `OpenRouter API error: ${response.status}`,
        confidence: "LOW",
      };
    }

    const data = await response.json();

    // Check if OpenRouter/provider returned an error
    const providerError = data.choices?.[0]?.error;
    if (providerError) {
      console.error(`Provider error for "${lead.name}":`, providerError);
      return {
        decision: "REJECT",
        reasoning: `Provider error: ${providerError.message || 'Unknown error'}`,
        confidence: "LOW",
      };
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in OpenRouter response:", JSON.stringify(data));
      return {
        decision: "REJECT",
        reasoning: "No content in AI response",
        confidence: "LOW",
      };
    }

    const result = JSON.parse(content) as FilterResult;
    return result;
  } catch (error) {
    console.error(`Error analyzing lead "${lead.name}":`, error);
    return {
      decision: "REJECT",
      reasoning: `Error during analysis: ${error instanceof Error ? error.message : String(error)}`,
      confidence: "LOW",
    };
  }
}

export function parseCSV(csvContent: string): TwitterLead[] {
  // Parse CSV with PapaParse for proper handling of multi-line fields
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  console.log(`📊 CSV Parsing Debug:
  - Total rows parsed by PapaParse: ${result.data.length}
  - Parsing errors: ${result.errors.length}
  - Headers found: ${result.meta.fields?.join(', ')}`);

  if (result.errors.length > 0) {
    console.error("CSV parsing errors:", result.errors.slice(0, 5));
  }

  if (!result.data || result.data.length === 0) {
    throw new Error("CSV must have at least a header row and one data row");
  }

  // Get headers from the first row to check for required columns
  const headers = result.meta.fields || [];
  const hasName = headers.some((h) => h.toLowerCase() === "name");
  const hasDescription = headers.some((h) => h.toLowerCase() === "description");

  if (!hasName || !hasDescription) {
    throw new Error("CSV must have 'name' and 'description' columns");
  }

  const leads: TwitterLead[] = [];
  let droppedCount = 0;
  const dropReasons: { missingName: number; missingDescription: number; missingBoth: number } = {
    missingName: 0,
    missingDescription: 0,
    missingBoth: 0,
  };

  for (const row of result.data) {
    // Find name and description (case-insensitive)
    let name = "";
    let description = "";
    let location: string | undefined;

    // Extract required and optional fields (case-insensitive)
    for (const [key, value] of Object.entries(row)) {
      const keyLower = key.toLowerCase();
      const strValue = String(value || "");
      if (keyLower === "name") {
        name = strValue.trim();
      } else if (keyLower === "description") {
        description = strValue.trim();
      } else if (keyLower === "location") {
        location = value ? strValue.trim() : undefined;
      }
    }

    // Only add leads with both name and description
    if (name && description) {
      const lead: TwitterLead = {
        name,
        description,
      };

      // Add location if present
      if (location) {
        lead.location = location;
      }

      // Add all other columns dynamically
      for (const [key, value] of Object.entries(row)) {
        const keyLower = key.toLowerCase();
        if (keyLower !== "name" && keyLower !== "description" && keyLower !== "location") {
          lead[key] = value || "";
        }
      }

      leads.push(lead);
    } else {
      droppedCount++;
      if (!name && !description) {
        dropReasons.missingBoth++;
      } else if (!name) {
        dropReasons.missingName++;
      } else {
        dropReasons.missingDescription++;
      }
    }
  }

  console.log(`📉 Rows dropped: ${droppedCount}
  - Missing name: ${dropReasons.missingName}
  - Missing description: ${dropReasons.missingDescription}
  - Missing both: ${dropReasons.missingBoth}
  ✅ Valid leads returned: ${leads.length}`);

  return leads;
}

export function convertToCSV(
  leads: Array<TwitterLead & { filter_result: FilterResult }>
): string {
  if (leads.length === 0) return "";

  // Flatten the lead objects with filter results
  const data = leads.map((lead) => {
    const { filter_result, public_metrics, ...leadData } = lead;

    // Ensure public_metrics is properly serialized as a string
    let publicMetricsStr = "";
    if (public_metrics) {
      if (typeof public_metrics === "string") {
        publicMetricsStr = public_metrics;
      } else {
        publicMetricsStr = JSON.stringify(public_metrics);
      }
    }

    return {
      ...leadData,
      public_metrics: publicMetricsStr,
      decision: filter_result.decision,
      reasoning: filter_result.reasoning,
      confidence: filter_result.confidence,
      extracted_company: filter_result.extracted_info?.company || "",
      extracted_role: filter_result.extracted_info?.role || "",
      estimated_company_size: filter_result.extracted_info?.estimated_company_size || "",
      estimated_funding: filter_result.extracted_info?.estimated_funding || "",
      extracted_location: filter_result.extracted_info?.location || "",
    };
  });

  // Use PapaParse to generate CSV with proper quoting
  return Papa.unparse(data, {
    quotes: true,        // Quote all fields for safety
    quoteChar: '"',
    escapeChar: '"',     // Standard CSV quote escaping
    header: true,
  });
}
