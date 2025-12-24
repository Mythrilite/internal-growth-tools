export interface LinkedInProfile {
  name: string;
  headline: string;
  linkedin_url: string;
  reaction_type?: string;
  timestamp?: string;
}

export interface ICPFilterResult {
  decision: "ACCEPT" | "REJECT";
  reasoning: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  extracted_info?: {
    company?: string;
    role?: string;
    seniority_level?: string;
    estimated_company_size?: string;
  };
}

export interface ContactData {
  email?: string;
  email_rating?: number;
  email_subtype?: string;
  phone?: string;
  phone_rating?: number;
}

export interface EnrichedLead {
  profile: LinkedInProfile;
  icp_result: ICPFilterResult;
  contact: ContactData;
  enrichment_status: "SUCCESS" | "FAILED" | "PENDING";
  error?: string;
}

export const ICP_FILTER_PROMPT = `You are an expert at qualifying B2B software leads from LinkedIn profiles.

CRITERIA FOR ACCEPTANCE:
✅ Technical role (Engineer, Engineering Manager, Director of Engineering, VP Engineering, CTO, Founder, Head of Engineering, Staff Engineer, Principal Engineer, Senior Engineer)
✅ Mid-level+ seniority OR leadership role
✅ Software/tech company (20+ engineers estimated)
✅ US-based (if location mentioned in headline)
✅ Well-known tech companies automatically qualify (FAANG, Stripe, Airbnb, Uber, etc.)

REJECT IF:
❌ Student, intern, freelancer, recruiter, HR roles
❌ Non-tech company (retail, hospitality, traditional services)
❌ Junior roles unless at well-known tech company
❌ Consultant, agency worker (unless at major consultancy)
❌ Insufficient information to determine

IMPORTANT:
- Make reasonable inferences based on headline and company
- Focus on technical roles and leadership positions
- Company size estimate based on company name recognition and industry

RESPONSE FORMAT (JSON):
{
  "decision": "ACCEPT" or "REJECT",
  "reasoning": "Brief explanation of your decision",
  "confidence": "HIGH", "MEDIUM", or "LOW",
  "extracted_info": {
    "company": "Company name if mentioned",
    "role": "Their role title",
    "seniority_level": "Junior/Mid/Senior/Leadership",
    "estimated_company_size": "Your estimate (e.g., 20-50, 50-200, 200+)"
  }
}`;

export function validateLinkedInPostUrl(url: string): boolean {
  // LinkedIn post URLs follow patterns like:
  // https://www.linkedin.com/posts/username_activity-1234567890
  // https://www.linkedin.com/posts/username-text-activity-1234567890-Pcn8
  // https://www.linkedin.com/feed/update/urn:li:activity:1234567890
  const patterns = [
    /^https:\/\/(www\.)?linkedin\.com\/posts\/.+activity-\d+/,
    /^https:\/\/(www\.)?linkedin\.com\/feed\/update\/urn:li:activity:\d+/,
  ];

  return patterns.some(pattern => pattern.test(url));
}

export async function fetchPostReactions(
  postUrl: string,
  apiKey: string
): Promise<LinkedInProfile[]> {
  console.log("[fetchPostReactions] Starting fetch for URL:", postUrl);
  const allReactions: LinkedInProfile[] = [];
  let currentPage = 1;
  let hasNext = true;

  while (hasNext) {
    const url = `https://search.clado.ai/api/enrich/post-reactions?page=${currentPage}&url=${encodeURIComponent(postUrl)}`;
    console.log(`[fetchPostReactions] Fetching page ${currentPage}:`, url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    console.log(`[fetchPostReactions] Page ${currentPage} response status:`, response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetchPostReactions] Error response:`, errorText);
      throw new Error(`Clado API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[fetchPostReactions] Page ${currentPage} data:`, JSON.stringify(data, null, 2));

    // The actual structure is data.data.data.items (nested data objects)
    const items = data.data?.data?.items || [];

    if (items.length > 0) {
      const reactions = items.map((item: any) => ({
        name: item.fullName || "",
        headline: item.headline || "",
        linkedin_url: item.profileUrl || "",
        reaction_type: item.reactionType || "",
        timestamp: item.timestamp || "",
      }));

      console.log(`[fetchPostReactions] Page ${currentPage} added ${reactions.length} reactions`);
      allReactions.push(...reactions);
    }

    // Check if there are more pages
    const totalPages = data.data?.data?.totalPages || 1;
    hasNext = currentPage < totalPages;
    currentPage++;

    console.log(`[fetchPostReactions] Total reactions so far: ${allReactions.length}, hasNext: ${hasNext}`);

    // Rate limiting: wait 500ms between requests
    if (hasNext) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[fetchPostReactions] Completed! Total reactions: ${allReactions.length}`);
  return allReactions;
}

export async function filterByICP(
  profile: LinkedInProfile,
  openRouterKey: string
): Promise<ICPFilterResult> {
  console.log(`[filterByICP] Filtering: ${profile.name} - ${profile.headline}`);
  const userPrompt = `Name: ${profile.name}
Headline: ${profile.headline}

Analyze this LinkedIn profile and determine if they meet our ICP criteria.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "Mythrilite - LinkedIn Enricher",
      },
      body: JSON.stringify({
        model: "x-ai/grok-4.1-fast",
        messages: [
          {
            role: "system",
            content: ICP_FILTER_PROMPT,
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
      console.error(`[filterByICP] OpenRouter error:`, errorData);
      throw new Error(`OpenRouter API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error(`[filterByICP] No content in response`);
      throw new Error("No content in response");
    }

    const result = JSON.parse(content) as ICPFilterResult;
    console.log(`[filterByICP] Result for ${profile.name}: ${result.decision} (${result.confidence})`);
    return result;
  } catch (error) {
    console.error(`[filterByICP] Error:`, error);
    return {
      decision: "REJECT",
      reasoning: `Error during analysis: ${error instanceof Error ? error.message : String(error)}`,
      confidence: "LOW",
    };
  }
}

export async function enrichContact(
  linkedinUrl: string,
  apiKey: string
): Promise<ContactData> {
  console.log("[enrichContact] Enriching:", linkedinUrl);
  try {
    const url = `https://search.clado.ai/api/enrich/contacts?linkedin_url=${encodeURIComponent(linkedinUrl)}`;
    console.log("[enrichContact] Fetching:", url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    console.log("[enrichContact] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[enrichContact] Error response:", errorText);
      throw new Error(`Clado API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("[enrichContact] Response data:", JSON.stringify(data, null, 2));

    if (data.data?.[0]?.error) {
      console.error("[enrichContact] Enrichment returned error flag");
      throw new Error("Contact enrichment failed");
    }

    const contacts = data.data?.[0]?.contacts || [];
    console.log(`[enrichContact] Found ${contacts.length} contacts`);

    // Find ANY email (not just work - can be risky, personal, etc.)
    const emails = contacts.filter((c: any) => c.type === "email");
    console.log(`[enrichContact] Found ${emails.length} emails:`, emails.map((e: any) => `${e.value} (${e.subType}, rating: ${e.rating})`));

    // Prefer work emails, but accept any email type
    const workEmail = emails.find((c: any) => c.subType === "work");
    const anyEmail = workEmail || emails[0]; // Use first available email if no work email

    // Find phone
    const phone = contacts.find((c: any) => c.type === "phone");

    const result = {
      email: anyEmail?.value,
      email_rating: anyEmail?.rating,
      email_subtype: anyEmail?.subType,
      phone: phone?.value,
      phone_rating: phone?.rating,
    };

    console.log("[enrichContact] Extracted contact data:", result);
    return result;
  } catch (error) {
    console.error(`[enrichContact] Error:`, error);
    throw error;
  }
}

export function convertToCSV(leads: EnrichedLead[]): string {
  if (leads.length === 0) return "";

  const headers = [
    "name",
    "headline",
    "linkedin_url",
    "reaction_type",
    "email",
    "email_rating",
    "email_type",
    "phone",
    "phone_rating",
    "icp_decision",
    "icp_reasoning",
    "icp_confidence",
    "extracted_company",
    "extracted_role",
    "extracted_seniority",
    "estimated_company_size",
  ];

  const rows = leads.map((lead) => {
    const row = headers.map((header) => {
      switch (header) {
        case "name":
          return lead.profile.name;
        case "headline":
          return `"${lead.profile.headline.replace(/"/g, '""')}"`;
        case "linkedin_url":
          return lead.profile.linkedin_url;
        case "reaction_type":
          return lead.profile.reaction_type || "";
        case "email":
          return lead.contact.email || "";
        case "email_rating":
          return lead.contact.email_rating || "";
        case "email_type":
          return lead.contact.email_subtype || "";
        case "phone":
          return lead.contact.phone || "";
        case "phone_rating":
          return lead.contact.phone_rating || "";
        case "icp_decision":
          return lead.icp_result.decision;
        case "icp_reasoning":
          return `"${lead.icp_result.reasoning.replace(/"/g, '""')}"`;
        case "icp_confidence":
          return lead.icp_result.confidence;
        case "extracted_company":
          return lead.icp_result.extracted_info?.company || "";
        case "extracted_role":
          return lead.icp_result.extracted_info?.role || "";
        case "extracted_seniority":
          return lead.icp_result.extracted_info?.seniority_level || "";
        case "estimated_company_size":
          return lead.icp_result.extracted_info?.estimated_company_size || "";
        default:
          return "";
      }
    });
    return row.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}
