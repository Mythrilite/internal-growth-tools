export interface LinkedInProfile {
  name: string;
  headline: string;
  linkedin_url: string;
  reaction_type?: string;
  timestamp?: string;
  company?: string; // Extracted from headline
  company_domain?: string; // Extracted from work email
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
  company_domain?: string; // Extracted from email domain
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

/**
 * Extracts company name from a LinkedIn headline.
 *
 * Common patterns:
 * - "Role at Company" -> Company
 * - "Role @ Company" -> Company
 * - "Role | Company" -> Company
 * - "Role, Company" -> Company
 * - "Company - Role" -> Company
 * - "Founder of Company" -> Company
 *
 * @param headline The LinkedIn headline string
 * @returns The extracted company name, or undefined if not found
 */
export function extractCompanyFromHeadline(headline: string): string | undefined {
  if (!headline || headline.trim() === "") {
    return undefined;
  }

  // Normalize the headline
  const normalizedHeadline = headline.trim();

  // Pattern 1: "Role at Company" (case insensitive)
  // Examples: "Software Engineer at Stripe", "CEO at TechStartup"
  const atMatch = normalizedHeadline.match(/\bat\s+(.+?)(?:\s*[|,]|$)/i);
  if (atMatch && atMatch[1]) {
    const company = atMatch[1].trim();
    // Avoid returning if it's just a location like "at San Francisco"
    if (company.length > 1 && !company.match(/^(the|a|an)$/i)) {
      return cleanCompanyName(company);
    }
  }

  // Pattern 2: "Role @ Company"
  // Examples: "CEO @ TechStartup", "Founder @ MyCompany"
  const atSymbolMatch = normalizedHeadline.match(/@\s*(.+?)(?:\s*[|,]|$)/);
  if (atSymbolMatch && atSymbolMatch[1]) {
    return cleanCompanyName(atSymbolMatch[1].trim());
  }

  // Pattern 3: "Role | Company" or "Company | Role"
  // Examples: "Founder | MyCompany", "Stripe | Engineering Manager"
  const pipeMatch = normalizedHeadline.match(/\|\s*(.+?)(?:\s*[|,]|$)/);
  if (pipeMatch && pipeMatch[1]) {
    const afterPipe = pipeMatch[1].trim();
    // Check if it looks like a company (not a role)
    if (!isLikelyRole(afterPipe)) {
      return cleanCompanyName(afterPipe);
    }
    // Try the part before the pipe
    const beforePipe = normalizedHeadline.split('|')[0].trim();
    if (!isLikelyRole(beforePipe)) {
      return cleanCompanyName(beforePipe);
    }
  }

  // Pattern 4: "Company - Role" or "Role - Company"
  // Examples: "Google - Software Engineer", "Software Engineer - Stripe"
  const dashMatch = normalizedHeadline.match(/^(.+?)\s*[-–—]\s*(.+?)$/);
  if (dashMatch) {
    const part1 = dashMatch[1].trim();
    const part2 = dashMatch[2].trim();
    // Usually the company is the shorter part or the one that doesn't look like a role
    if (!isLikelyRole(part1) && isLikelyRole(part2)) {
      return cleanCompanyName(part1);
    }
    if (!isLikelyRole(part2) && isLikelyRole(part1)) {
      return cleanCompanyName(part2);
    }
  }

  // Pattern 5: "Role, Company"
  // Examples: "Software Engineer, Stripe", "CEO, TechStartup"
  const commaMatch = normalizedHeadline.match(/,\s*(.+?)(?:\s*[|]|$)/);
  if (commaMatch && commaMatch[1]) {
    const afterComma = commaMatch[1].trim();
    // Avoid locations
    if (!isLikelyLocation(afterComma) && !isLikelyRole(afterComma)) {
      return cleanCompanyName(afterComma);
    }
  }

  // Pattern 6: "Founder/Co-founder of Company"
  // Examples: "Founder of TechStartup", "Co-founder of MyCompany"
  const founderMatch = normalizedHeadline.match(/(?:founder|co-founder|cofounder)\s+(?:of|&|and)\s+(.+?)(?:\s*[|,]|$)/i);
  if (founderMatch && founderMatch[1]) {
    return cleanCompanyName(founderMatch[1].trim());
  }

  return undefined;
}

/**
 * Cleans up a company name by removing common suffixes and extra whitespace
 */
function cleanCompanyName(company: string): string {
  return company
    // Remove common suffixes
    .replace(/\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Co\.?)$/i, "")
    // Remove extra whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a string looks like a job role rather than a company name
 */
function isLikelyRole(text: string): boolean {
  const roleKeywords = [
    /\b(engineer|developer|architect|manager|director|vp|vice president|head|lead|senior|junior|principal|staff|ceo|cto|coo|cfo|cmo|founder|co-founder|cofounder|president|owner|consultant|analyst|designer|scientist|specialist|coordinator|associate|intern|executive|officer)\b/i,
  ];
  return roleKeywords.some((pattern) => pattern.test(text));
}

/**
 * Checks if a string looks like a location
 */
function isLikelyLocation(text: string): boolean {
  const locationKeywords = [
    /\b(san francisco|new york|los angeles|chicago|boston|seattle|austin|denver|london|berlin|paris|tokyo|singapore|remote|usa|uk|us|ca|ny|sf|la)\b/i,
    /\b(california|texas|florida|washington|massachusetts|colorado|georgia|virginia|illinois|pennsylvania)\b/i,
  ];
  return locationKeywords.some((pattern) => pattern.test(text));
}

/**
 * Generates a likely domain name from a company name.
 * This is a best-effort guess and may not always be accurate.
 *
 * @param companyName The company name
 * @returns A likely domain (e.g., "Acme Corp" -> "acmecorp.com")
 */
export function generateDomainFromCompany(companyName: string): string | undefined {
  if (!companyName || companyName.trim() === "") {
    return undefined;
  }

  // Normalize: lowercase, remove special chars, keep only alphanumeric
  const normalized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special characters
    .replace(/\s+/g, "") // Remove spaces
    .trim();

  if (normalized.length === 0) {
    return undefined;
  }

  // Common tech company domain patterns
  // Most companies use .com, but some use .io, .ai, etc.
  return `${normalized}.com`;
}

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

    // Actual structure: data.data.items[]
    const items = data.data?.data?.items || [];

    if (items.length > 0) {
      const mappedReactions = items.map((item: any) => {
        const headline = item.headline || "";
        const company = extractCompanyFromHeadline(headline);
        const companyDomain = company ? generateDomainFromCompany(company) : undefined;

        return {
          name: item.fullName || "",
          headline,
          linkedin_url: item.profileUrl || "",
          reaction_type: item.reactionType || "",
          timestamp: item.timestamp || "",
          company,
          company_domain: companyDomain,
        };
      });

      console.log(`[fetchPostReactions] Page ${currentPage} added ${mappedReactions.length} reactions`);
      allReactions.push(...mappedReactions);
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
  console.log("[enrichContact] API key (first 10 chars):", apiKey?.substring(0, 10) + "...");

  try {
    // Ensure LinkedIn URL is properly formatted
    let formattedUrl = linkedinUrl;
    if (!linkedinUrl.startsWith("http")) {
      formattedUrl = `https://www.linkedin.com${linkedinUrl.startsWith("/") ? "" : "/"}${linkedinUrl}`;
      console.log("[enrichContact] Formatted URL:", formattedUrl);
    }

    const url = `https://search.clado.ai/api/enrich/contacts?linkedin_url=${formattedUrl}&email_enrichment=true`;
    console.log("[enrichContact] Full API URL:", url);

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

    const rawText = await response.text();
    console.log("[enrichContact] Raw response:", rawText);

    const data = JSON.parse(rawText);
    console.log("[enrichContact] Parsed data:", JSON.stringify(data, null, 2));
    console.log("[enrichContact] LinkedIn URL passed:", formattedUrl);

    if (data.data?.[0]?.error) {
      console.error("[enrichContact] Enrichment returned error flag for URL:", formattedUrl);
      throw new Error(`Contact enrichment failed for ${formattedUrl}`);
    }

    // DEBUG: Log the full response structure to understand what Clado returns
    console.log("[enrichContact] Full API response structure:", JSON.stringify(data, null, 2));

    const contacts = data.data?.[0]?.contacts || data.contacts || data.data?.contacts || [];
    console.log(`[enrichContact] Found ${contacts.length} contacts`);

    // If no contacts found, try alternative paths
    if (contacts.length === 0) {
      console.log("[enrichContact] No contacts found. Checking alternative response paths...");
      console.log("[enrichContact] data.data:", JSON.stringify(data.data, null, 2));
      console.log("[enrichContact] Keys in response:", Object.keys(data));
      if (data.data) {
        console.log("[enrichContact] Keys in data.data:", Object.keys(data.data));
      }
    }

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

    // Include verified, work, and risky emails - exclude personal domains
    const verifiedEmails = emails.filter((c: any) => c.subType === "verified" && !isPersonalEmail(c.value));
    const workEmails = emails.filter((c: any) => c.subType === "work" && !isPersonalEmail(c.value));
    const riskyEmails = emails.filter((c: any) => c.subType === "risky" && !isPersonalEmail(c.value));

    console.log(`[enrichContact] After filtering: ${verifiedEmails.length} verified, ${workEmails.length} work, ${riskyEmails.length} risky`);

    // Combine all work-related emails (verified first, then work, then risky)
    const prioritizedEmails = [
      ...verifiedEmails,
      ...workEmails,
      ...riskyEmails,
    ];

    // Sort by rating (descending)
    prioritizedEmails.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));

    // Choose best email
    const selectedEmail = prioritizedEmails[0] || null;

    if (!selectedEmail) {
      console.log("[enrichContact] No work email found (only accepting verified/work subTypes, excluding personal domains)");
    } else {
      console.log(`[enrichContact] Selected email: ${selectedEmail.value} (${selectedEmail.subType}, rating: ${selectedEmail.rating})`);
    }

    // Extract company domain from email
    const companyDomain = selectedEmail?.value
      ? selectedEmail.value.split('@')[1]?.toLowerCase()
      : undefined;

    const result = {
      email: selectedEmail?.value,
      email_rating: selectedEmail?.rating,
      email_subtype: selectedEmail?.subType,
      phone: undefined,
      phone_rating: undefined,
      company_domain: companyDomain,
    };

    console.log("[enrichContact] Extracted contact data:", result);
    return result;
  } catch (error) {
    console.error(`[enrichContact] Error:`, error);
    throw error;
  }
}

export async function enrichContactApollo(
  profile: LinkedInProfile,
  apiKey: string
): Promise<ContactData> {
  console.log("[enrichContactApollo] Enriching:", profile.name, "at", profile.company);
  console.log("[enrichContactApollo] API key (first 10 chars):", apiKey?.substring(0, 10) + "...");

  try {
    // Parse name into first and last name
    const nameParts = profile.name.trim().split(' ');
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(' ') || "";

    console.log(`[enrichContactApollo] Parsed name: first="${firstName}", last="${lastName}"`);

    // Check if we have required data
    if (!firstName || !profile.company) {
      console.warn(`[enrichContactApollo] Missing required data: firstName="${firstName}", company="${profile.company}"`);
      throw new Error(`Missing required data for Apollo enrichment`);
    }

    const requestBody = {
      first_name: firstName,
      last_name: lastName,
      organization_name: profile.company,
      reveal_personal_emails: false,
    };

    console.log("[enrichContactApollo] Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    console.log("[enrichContactApollo] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[enrichContactApollo] Error response:", errorText);
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`);
    }

    const rawText = await response.text();
    console.log("[enrichContactApollo] Raw response:", rawText);

    const data = JSON.parse(rawText);
    console.log("[enrichContactApollo] Parsed data:", JSON.stringify(data, null, 2));

    // Extract person data from Apollo response
    // Apollo returns: { person: { email, ... } }
    const person = data.person || data;

    if (!person) {
      console.error("[enrichContactApollo] No person data in response");
      throw new Error(`No person data returned from Apollo`);
    }

    // Get email from Apollo response
    const email = person.email || person.primary_email || null;

    console.log(`[enrichContactApollo] Found email: ${email || "none"}`);

    // Personal email domains to exclude
    const personalDomains = [
      'gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com', 'outlook.com',
      'icloud.com', 'me.com', 'mac.com', 'live.com', 'msn.com',
      'ymail.com', 'rocketmail.com', 'googlemail.com', 'protonmail.com',
      'mail.com', 'zoho.com', 'gmx.com', 'inbox.com'
    ];

    // Filter out personal email domains
    const isPersonalEmail = (emailAddr: string) => {
      const domain = emailAddr.toLowerCase().split('@')[1];
      return personalDomains.includes(domain);
    };

    // Check if email is personal
    let filteredEmail = email;
    if (email && isPersonalEmail(email)) {
      console.log(`[enrichContactApollo] Filtering out personal email: ${email}`);
      filteredEmail = null;
    }

    // Extract organization domain if available
    const organization = person.organization || person.employment_history?.[0]?.organization;
    const companyDomain = organization?.primary_domain || organization?.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || null;

    const result = {
      email: filteredEmail || undefined,
      email_rating: filteredEmail ? 90 : undefined, // Apollo doesn't provide rating, use 90 as default
      email_subtype: filteredEmail ? "apollo" : undefined,
      phone: undefined,
      phone_rating: undefined,
      company_domain: companyDomain || undefined,
    };

    console.log("[enrichContactApollo] Extracted contact data:", result);
    return result;
  } catch (error) {
    console.error(`[enrichContactApollo] Error:`, error);
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
    "company",
    "company_domain",
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
        case "company":
          return lead.profile.company || "";
        case "company_domain":
          return lead.contact.company_domain || "";
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
