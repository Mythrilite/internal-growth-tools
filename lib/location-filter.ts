// Fast location-based filtering without LLM

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming"
];

const US_STATE_ABBREV = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy"
];

const US_CITIES = [
  "san francisco", "sf", "los angeles", "la", "new york", "nyc", "brooklyn",
  "manhattan", "queens", "bronx", "chicago", "houston", "phoenix", "philadelphia",
  "san antonio", "san diego", "dallas", "san jose", "austin", "jacksonville",
  "fort worth", "columbus", "charlotte", "indianapolis", "seattle", "denver",
  "washington dc", "dc", "boston", "el paso", "nashville", "detroit",
  "oklahoma city", "portland", "las vegas", "memphis", "louisville",
  "baltimore", "milwaukee", "albuquerque", "tucson", "fresno", "mesa",
  "sacramento", "atlanta", "kansas city", "colorado springs", "raleigh",
  "miami", "long beach", "virginia beach", "omaha", "oakland", "minneapolis",
  "tulsa", "arlington", "tampa", "new orleans", "wichita", "cleveland",
  "bakersfield", "aurora", "anaheim", "honolulu", "santa ana", "riverside",
  "corpus christi", "lexington", "stockton", "henderson", "saint paul",
  "cincinnati", "st. louis", "pittsburgh", "greensboro", "lincoln", "plano",
  "anchorage", "orlando", "irvine", "newark", "toledo", "durham", "chula vista",
  "fort wayne", "jersey city", "st. petersburg", "laredo", "madison",
  "chandler", "buffalo", "lubbock", "scottsdale", "reno", "glendale",
  "gilbert", "winston-salem", "north las vegas", "norfolk", "chesapeake",
  "garland", "irving", "hialeah", "fremont", "boise", "richmond",
  "baton rouge", "spokane", "des moines", "tacoma", "san bernardino",
  "modesto", "fontana", "santa clarita", "birmingham", "oxnard",
  "fayetteville", "moreno valley", "rochester", "glendale", "huntington beach",
  "salt lake city", "grand rapids", "amarillo", "yonkers", "aurora",
  "montgomery", "akron", "little rock", "huntsville", "augusta",
  "port st. lucie", "grand prairie", "mobile", "tallahassee", "knoxville",
  "worcester", "newport news", "brownsville", "santa rosa", "providence",
  "overland park", "garden grove", "chattanooga", "oceanside", "jackson",
  "fort lauderdale", "santa clara", "rancho cucamonga", "ontario", "salem",
  "eugene", "lancaster", "pembroke pines", "hayward", "corona", "clarksville",
  "lakewood", "springfield", "alexandria", "sunnyvale", "escondido",
  "joliet", "naperville", "bellevue", "cary", "pasadena", "boulder",
  "mountain view", "palo alto", "menlo park", "redwood city", "cupertino",
  "santa monica", "berkeley"
];

const NON_US_INDICATORS = [
  "uk", "united kingdom", "london", "england", "scotland", "wales", "ireland",
  "canada", "toronto", "vancouver", "montreal", "ottawa", "calgary",
  "europe", "european", "eu",
  "australia", "sydney", "melbourne", "brisbane", "perth",
  "new zealand", "auckland", "wellington",
  "singapore", "hong kong", "tokyo", "japan", "china", "beijing", "shanghai",
  "india", "bangalore", "mumbai", "delhi", "hyderabad", "chennai", "pune",
  "germany", "berlin", "munich", "france", "paris", "netherlands", "amsterdam",
  "spain", "madrid", "barcelona", "italy", "rome", "milan",
  "sweden", "stockholm", "denmark", "copenhagen", "norway", "oslo",
  "switzerland", "zurich", "poland", "warsaw", "israel", "tel aviv",
  "brazil", "mexico", "argentina", "chile", "colombia"
];

const POSITIVE_KEYWORDS = [
  "founder", "co-founder", "cofounder", "ceo", "cto", "cpo",
  "chief technology officer", "chief product officer",
  "vp engineering", "vp of engineering", "head of engineering", "head of product",
  "engineering manager", "engineering lead", "staff engineer", "principal engineer",
  "senior engineer", "lead engineer", "tech lead", "engineering director",
  "director of engineering", "software engineer", "ml engineer",
  "machine learning engineer", "data engineer", "backend engineer",
  "frontend engineer", "full stack engineer", "platform engineer",
  "infrastructure engineer", "devops engineer", "sre", "site reliability engineer",
  "series a", "series b", "series c", "funded", "raised", "investor",
  "venture backed", "yc", "y combinator", "techstars", "500 startups",
  "a16z", "sequoia", "benchmark", "accel", "greylock", "khosla",
  "seed round", "pre-seed", "we're hiring", "hiring engineers",
  "ex-google", "ex-facebook", "ex-meta", "ex-amazon", "ex-stripe",
  "ex-airbnb", "ex-uber", "ex-microsoft", "faang", "big tech",
  "startup", "saas", "b2b", "enterprise software", "developer tools",
  "devtools", "infrastructure", "platform", "api", "cloud", "ml", "ai",
  "artificial intelligence", "machine learning", "data science",
  "distributed systems", "scalability", "microservices", "kubernetes",
  "aws", "gcp", "azure", "founding team", "early team", "team of",
  "remote first", "eng team", "product engineer", "growth engineer",
  "full-time", "building", "shipped", "launched", "scaling",
  "san francisco", "sf", "bay area", "silicon valley", "new york",
  "nyc", "seattle", "austin", "boston", "palo alto", "mountain view"
];

export interface LocationFilterResult {
  isUS: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface FollowerFilterResult {
  isValid: boolean;
  followerCount: number | null;
  reason: string;
}

export interface KeywordFilterResult {
  hasKeyword: boolean;
  matchedKeywords: string[];
  reason: string;
}

export function isUSLocation(location: string | undefined): LocationFilterResult {
  // No location provided
  if (!location || location.trim() === "") {
    return {
      isUS: false,
      confidence: "low",
      reason: "No location provided"
    };
  }

  const loc = location.toLowerCase().trim();

  // Check for "Remote" - reject unless explicitly "Remote, US"
  if (loc === "remote" || loc === "remote worldwide" || loc === "fully remote") {
    return {
      isUS: false,
      confidence: "high",
      reason: "Remote location without US specification"
    };
  }

  if (loc.includes("remote") && (loc.includes("us") || loc.includes("usa") || loc.includes("united states"))) {
    return {
      isUS: true,
      confidence: "high",
      reason: "Remote with US specification"
    };
  }

  // Check for explicit non-US indicators first (high confidence rejection)
  for (const nonUS of NON_US_INDICATORS) {
    if (loc.includes(nonUS)) {
      return {
        isUS: false,
        confidence: "high",
        reason: `Non-US location detected: ${nonUS}`
      };
    }
  }

  // Check for "United States" or "USA"
  if (loc.includes("united states") || loc.includes("usa") || loc === "us") {
    return {
      isUS: true,
      confidence: "high",
      reason: "Explicit US mention"
    };
  }

  // Check for US states (full names)
  for (const state of US_STATES) {
    if (loc.includes(state)) {
      return {
        isUS: true,
        confidence: "high",
        reason: `US state detected: ${state}`
      };
    }
  }

  // Check for US state abbreviations (with word boundaries to avoid false positives)
  const words = loc.split(/[\s,.-]+/);
  for (const word of words) {
    if (US_STATE_ABBREV.includes(word)) {
      return {
        isUS: true,
        confidence: "high",
        reason: `US state abbreviation detected: ${word.toUpperCase()}`
      };
    }
  }

  // Check for US cities
  for (const city of US_CITIES) {
    if (loc.includes(city)) {
      return {
        isUS: true,
        confidence: "high",
        reason: `US city detected: ${city}`
      };
    }
  }

  // If we get here, location is ambiguous
  return {
    isUS: false,
    confidence: "low",
    reason: "Location cannot be determined as US"
  };
}

export function checkFollowerCount(
  publicMetrics: string | { followers_count?: number } | undefined
): FollowerFilterResult {
  // No metrics provided - allow through (let AI decide)
  if (!publicMetrics || publicMetrics === '') {
    return {
      isValid: true, // Don't reject if no data
      followerCount: null,
      reason: "No follower data (skipped filter)"
    };
  }

  let followerCount: number | null = null;

  // Parse if string
  if (typeof publicMetrics === "string") {
    try {
      const parsed = JSON.parse(publicMetrics);
      followerCount = parsed.followers_count;
    } catch (e) {
      // Invalid JSON - allow through (let AI decide)
      return {
        isValid: true,
        followerCount: null,
        reason: "Invalid public_metrics (skipped filter)"
      };
    }
  } else {
    followerCount = publicMetrics.followers_count ?? null;
  }

  if (followerCount === null || followerCount === undefined) {
    // No follower count in data - allow through
    return {
      isValid: true,
      followerCount: null,
      reason: "No followers_count in data (skipped filter)"
    };
  }

  // Check range: 100-5000
  if (followerCount < 100) {
    return {
      isValid: false,
      followerCount,
      reason: `Too few followers: ${followerCount} (minimum 100)`
    };
  }

  if (followerCount > 5000) {
    return {
      isValid: false,
      followerCount,
      reason: `Too many followers: ${followerCount} (maximum 5000)`
    };
  }

  return {
    isValid: true,
    followerCount,
    reason: `Valid follower count: ${followerCount}`
  };
}

export function checkKeywords(description: string | undefined): KeywordFilterResult {
  if (!description || description.trim() === '') {
    return {
      hasKeyword: false,
      matchedKeywords: [],
      reason: "No description provided"
    };
  }

  // Clean and normalize the description
  let cleanDesc = description.trim();

  // Remove leading/trailing quotes if present
  if (cleanDesc.startsWith('"') && cleanDesc.endsWith('"')) {
    cleanDesc = cleanDesc.slice(1, -1);
  }

  const desc = cleanDesc.toLowerCase().trim();
  const matched: string[] = [];

  for (const keyword of POSITIVE_KEYWORDS) {
    if (desc.includes(keyword)) {
      matched.push(keyword);
    }
  }

  if (matched.length === 0) {
    return {
      hasKeyword: false,
      matchedKeywords: [],
      reason: `No positive keywords found (checked: "${desc.substring(0, 50)}...")`
    };
  }

  return {
    hasKeyword: true,
    matchedKeywords: matched,
    reason: `Found ${matched.length} keyword(s): ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? "..." : ""}`
  };
}

export function batchFilterByLocation(
  leads: Array<{
    location?: string;
    description?: string;
    public_metrics?: string | { followers_count?: number };
    [key: string]: any
  }>
) {
  const qualifiedLeads: typeof leads = [];
  const rejectedLeads: Array<typeof leads[0] & { rejection_reason: string; debug_info?: any }> = [];

  const stats = {
    total: leads.length,
    qualified: 0,
    rejectedLocation: 0,
    rejectedFollowers: 0,
    rejectedKeywords: 0,
    rejectedMultiple: 0,
    debugSamples: [] as any[]
  };

  for (const lead of leads) {
    const rejectionReasons: string[] = [];
    const debugInfo: any = {};

    // Check location
    const locationResult = isUSLocation(lead.location);
    debugInfo.location = {
      value: lead.location,
      result: locationResult
    };
    if (!locationResult.isUS) {
      rejectionReasons.push(`Location: ${locationResult.reason}`);
    }

    // Check follower count
    const followerResult = checkFollowerCount(lead.public_metrics);
    debugInfo.followers = {
      rawValue: lead.public_metrics,
      result: followerResult
    };
    if (!followerResult.isValid) {
      rejectionReasons.push(`Followers: ${followerResult.reason}`);
    }

    // Check keywords
    const keywordResult = checkKeywords(lead.description);
    debugInfo.keywords = {
      description: lead.description?.substring(0, 100),
      result: keywordResult
    };
    if (!keywordResult.hasKeyword) {
      rejectionReasons.push(`Keywords: ${keywordResult.reason}`);
    }

    // If any filter failed, reject
    if (rejectionReasons.length > 0) {
      rejectedLeads.push({
        ...lead,
        rejection_reason: rejectionReasons.join(" | "),
        debug_info: debugInfo
      });

      // Save first 5 samples for debugging
      if (stats.debugSamples.length < 5) {
        stats.debugSamples.push({
          name: lead.name,
          rejectionReasons,
          debugInfo
        });
      }

      // Track individual rejection reasons
      if (rejectionReasons.length > 1) {
        stats.rejectedMultiple++;
      } else {
        if (rejectionReasons[0].startsWith("Location:")) stats.rejectedLocation++;
        else if (rejectionReasons[0].startsWith("Followers:")) stats.rejectedFollowers++;
        else if (rejectionReasons[0].startsWith("Keywords:")) stats.rejectedKeywords++;
      }
    } else {
      // All filters passed
      qualifiedLeads.push(lead);
      stats.qualified++;
    }
  }

  // Log debug info to console
  if (stats.debugSamples.length > 0) {
    console.log("🐛 Filter Debug - First 5 rejected leads:");
    stats.debugSamples.forEach((sample, i) => {
      console.log(`\n${i + 1}. ${sample.name}`);
      console.log("  Rejection reasons:", sample.rejectionReasons);
      console.log("  Debug info:", sample.debugInfo);
    });
  }

  return {
    qualifiedLeads,
    rejectedLeads,
    stats
  };
}
