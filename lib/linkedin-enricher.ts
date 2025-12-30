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

export const ICP_FILTER_PROMPT = `You are an expert at qualifying B2B software leads from LinkedIn profiles. Be INCLUSIVE - when in doubt, ACCEPT.

CRITERIA FOR ACCEPTANCE (meet ANY of these):
✅ Works at a tech/software company (any size from startup to mid-market)
✅ Technical role: Engineer, Developer, Architect, Data Scientist, ML/AI, DevOps, SRE, etc.
✅ Technical leadership: Engineering Manager, Director, VP, CTO, Head of Engineering
✅ Product roles: Product Manager, Product Owner, Head of Product, CPO
✅ Founder, Co-founder, CEO, COO of a tech company
✅ Works at a startup or scale-up (any stage)
✅ Mentions tech keywords: SaaS, API, cloud, infrastructure, platform, developer tools, etc.

ONLY REJECT IF (must be CLEARLY one of these):
❌ Student or intern (explicit in headline)
❌ Recruiter, HR, Talent Acquisition (explicit in headline)
❌ Clearly non-tech company (restaurant, retail store, real estate agent, etc.)
❌ VERY LARGE COMPANIES: Meta/Facebook, Google, Amazon, Apple, Microsoft, Netflix, or any company with 5000+ employees

IMPORTANT - BE LENIENT:
- If unclear, ACCEPT - we can filter later
- Accept junior roles at tech companies
- Accept consultants and freelancers if they work in tech
- Accept people at larger companies (up to 5000 employees) if they have decision-making roles
- Don't reject just because information is limited - accept if they seem tech-related
- We want MORE leads, not fewer

RESPONSE FORMAT (JSON):
{
  "decision": "ACCEPT" or "REJECT",
  "reasoning": "Brief explanation of your decision",
  "confidence": "HIGH", "MEDIUM", or "LOW",
  "extracted_info": {
    "company": "Company name if mentioned",
    "role": "Their role title",
    "seniority_level": "Junior/Mid/Senior/Leadership",
    "estimated_company_size": "Your estimate"
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
    // Get the app URL - try NEXT_PUBLIC_APP_URL first, then VERCEL_URL, then fallback
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || "https://myth-internal-growth-tools.vercel.app";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
        "HTTP-Referer": appUrl,
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
      console.error(`[filterByICP] Provider error for "${profile.name}":`, providerError);
      return {
        decision: "REJECT",
        reasoning: `Provider error: ${providerError.message || 'Unknown error'}`,
        confidence: "LOW",
      };
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error(`[filterByICP] No content in response for ${profile.name}`);
      return {
        decision: "REJECT",
        reasoning: "No content in AI response",
        confidence: "LOW",
      };
    }

    // Extract JSON from markdown code blocks if present
    let jsonContent = content.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    // Also handle case where LLM adds text before/after JSON
    const jsonStartIndex = jsonContent.indexOf('{');
    const jsonEndIndex = jsonContent.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      jsonContent = jsonContent.slice(jsonStartIndex, jsonEndIndex + 1);
    }

    const result = JSON.parse(jsonContent) as ICPFilterResult;
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
    const url = `https://search.clado.ai/api/enrich/contacts?linkedin_url=${encodeURIComponent(linkedinUrl)}&email_enrichment=true`;
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

    // Find all emails
    const emails = contacts.filter((c: any) => c.type === "email");
    console.log(`[enrichContact] Found ${emails.length} emails:`, emails.map((e: any) => `${e.value} (${e.subType}, rating: ${e.rating})`));

    // Personal email domains to exclude
    const personalDomains = [
      'gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com', 'outlook.com',
      'icloud.com', 'me.com', 'mac.com', 'live.com', 'msn.com',
      'ymail.com', 'rocketmail.com', 'googlemail.com', 'protonmail.com',
      'mail.com', 'zoho.com', 'gmx.com', 'inbox.com'
    ];

    // Filter out personal email domains
    const isPersonalEmail = (email: string) => {
      const domain = email.toLowerCase().split('@')[1];
      return personalDomains.includes(domain);
    };

    // Prioritize email selection based on Clado's subTypes:
    // - "verified": Work emails (corporate domains) - HIGHEST PRIORITY
    // - "work": Work emails (if exists)
    // - "professional": Professional emails
    // - "risky": Personal/unverified emails - EXCLUDE
    // IMPORTANT: Completely exclude personal email domains (Gmail, Yahoo, etc.)

    // Filter out personal domains and categorize by subType
    const verifiedEmails = emails.filter((c: any) => c.subType === "verified" && !isPersonalEmail(c.value));
    const workEmails = emails.filter((c: any) => c.subType === "work" && !isPersonalEmail(c.value));
    const professionalEmails = emails.filter((c: any) => c.subType === "professional" && !isPersonalEmail(c.value));

    console.log(`[enrichContact] After filtering personal domains: ${verifiedEmails.length} verified, ${workEmails.length} work, ${professionalEmails.length} professional`);

    // Combine and sort by priority, then by rating
    // ONLY include verified, work, and professional emails (NO risky/personal)
    const prioritizedEmails = [
      ...verifiedEmails,
      ...workEmails,
      ...professionalEmails,
    ];

    // Sort by rating (descending) within the prioritized list
    prioritizedEmails.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));

    // Choose best email
    const selectedEmail = prioritizedEmails[0] || null;

    if (!selectedEmail) {
      console.log("[enrichContact] No work email found (excluded all personal domains: Gmail, Yahoo, Outlook, etc.)");
    } else {
      console.log(`[enrichContact] Selected email: ${selectedEmail.value} (${selectedEmail.subType}, rating: ${selectedEmail.rating})`);
    }

    const result = {
      email: selectedEmail?.value,
      email_rating: selectedEmail?.rating,
      email_subtype: selectedEmail?.subType,
      phone: undefined,
      phone_rating: undefined,
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
