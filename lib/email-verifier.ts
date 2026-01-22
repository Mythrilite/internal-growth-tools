const VERIFIER_API = "https://rapid-email-verifier.fly.dev/api/validate";

export interface EmailValidation {
  email: string;
  syntax_valid: boolean;
  domain_exists: boolean;
  has_mx: boolean;
  is_disposable: boolean;
  is_role_based: boolean;
  status: "VALID" | "INVALID_FORMAT" | "INVALID_DOMAIN" | "DISPOSABLE" | "PROBABLY_VALID" | "UNDELIVERABLE" | "ERROR";
  alias_of?: string;
  error?: string;
}

export interface BatchVerificationResult {
  total: number;
  verified: number;
  results: EmailValidation[];
  errors: Array<{ email: string; error: string }>;
}

/**
 * Verify a single email address
 */
export async function verifyEmail(email: string): Promise<EmailValidation> {
  console.log(`[verifyEmail] Verifying: ${email}`);
  
  if (!email || typeof email !== "string" || !email.trim()) {
    return {
      email: email || "",
      syntax_valid: false,
      domain_exists: false,
      has_mx: false,
      is_disposable: false,
      is_role_based: false,
      status: "INVALID_FORMAT",
      error: "Email is empty or invalid",
    };
  }

  try {
    const trimmedEmail = email.trim().toLowerCase();
    const url = new URL(VERIFIER_API);
    url.searchParams.append("email", trimmedEmail);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[verifyEmail] API error: ${response.status}`);
      return {
        email: trimmedEmail,
        syntax_valid: false,
        domain_exists: false,
        has_mx: false,
        is_disposable: false,
        is_role_based: false,
        status: "ERROR",
        error: `API error: ${response.status}`,
      };
    }

    const data = await response.json();
    console.log(`[verifyEmail] Response for ${email}:`, data);

    // Map API response to our format
    return {
      email: trimmedEmail,
      syntax_valid: data.validations?.syntax ?? false,
      domain_exists: data.validations?.domain_exists ?? false,
      has_mx: data.validations?.mx_records ?? false,
      is_disposable: data.validations?.is_disposable ?? false,
      is_role_based: data.validations?.is_role_based ?? false,
      status: data.status || "ERROR",
      alias_of: data.aliasOf,
      error: undefined,
    };
  } catch (error) {
    console.error(`[verifyEmail] Error:`, error);
    return {
      email: email.toLowerCase(),
      syntax_valid: false,
      domain_exists: false,
      has_mx: false,
      is_disposable: false,
      is_role_based: false,
      status: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Verify multiple emails in parallel with rate limiting
 */
export async function verifyEmailsBatch(emails: string[]): Promise<BatchVerificationResult> {
  console.log(`[verifyEmailsBatch] Verifying ${emails.length} emails`);
  
  const uniqueEmails = Array.from(new Set(emails.map(e => e.trim().toLowerCase())));
  const results: EmailValidation[] = [];
  const errors: Array<{ email: string; error: string }> = [];

  // Process in parallel with a concurrency limit to avoid rate limiting
  const CONCURRENCY = 5;
  for (let i = 0; i < uniqueEmails.length; i += CONCURRENCY) {
    const batch = uniqueEmails.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(email => verifyEmail(email)));

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const email = batch[j];

      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error(`[verifyEmailsBatch] Failed to verify ${email}:`, result.reason);
        errors.push({
          email,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    // Add delay between batches to avoid rate limiting
    if (i + CONCURRENCY < uniqueEmails.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return {
    total: uniqueEmails.length,
    verified: results.length,
    results,
    errors,
  };
}

/**
 * Convert validation results to CSV format
 */
export function convertToCSV(validations: EmailValidation[]): string {
  if (validations.length === 0) return "";

  const headers = [
    "email",
    "status",
    "syntax_valid",
    "domain_exists",
    "has_mx",
    "is_disposable",
    "is_role_based",
    "alias_of",
    "error",
  ];

  const rows = validations.map((v) => [
    v.email,
    v.status,
    v.syntax_valid ? "true" : "false",
    v.domain_exists ? "true" : "false",
    v.has_mx ? "true" : "false",
    v.is_disposable ? "true" : "false",
    v.is_role_based ? "true" : "false",
    v.alias_of || "",
    v.error ? `"${v.error.replace(/"/g, '""')}"` : "",
  ]);

  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Convert validation results to CSV format, preserving original CSV columns
 * Merges original data with verification results
 */
export function convertToCSVWithOriginalData(
  validations: EmailValidation[],
  originalData: any[],
  emailColumn: string
): string {
  if (originalData.length === 0) {
    return convertToCSV(validations);
  }

  // Get all column names from the original data (first row)
  const originalColumns = Object.keys(originalData[0] || {});

  // Define verification columns (exclude email since it's already in original)
  const verificationColumns = [
    "verification_status",
    "syntax_valid",
    "domain_exists",
    "has_mx",
    "is_disposable",
    "is_role_based",
    "alias_of",
    "verification_error",
  ];

  // Create headers: all original columns + verification columns
  const headers = [...originalColumns, ...verificationColumns];

  // Create a map of email -> verification result for fast lookup
  const verificationMap = new Map<string, EmailValidation>();
  validations.forEach(v => {
    verificationMap.set(v.email.toLowerCase().trim(), v);
  });

  // Helper function to escape CSV values
  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    // If value contains comma, newline, or quotes, wrap in quotes and escape internal quotes
    if (str.includes(",") || str.includes("\n") || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build rows by merging original data with verification results
  const rows = originalData.map(originalRow => {
    const emailValue = originalRow[emailColumn];
    const emailKey = emailValue ? String(emailValue).toLowerCase().trim() : "";
    const verification = verificationMap.get(emailKey);

    // Start with all original columns
    const rowValues = originalColumns.map(col => escapeCsvValue(originalRow[col]));

    // Add verification columns
    if (verification) {
      rowValues.push(
        verification.status,
        verification.syntax_valid ? "true" : "false",
        verification.domain_exists ? "true" : "false",
        verification.has_mx ? "true" : "false",
        verification.is_disposable ? "true" : "false",
        verification.is_role_based ? "true" : "false",
        verification.alias_of || "",
        verification.error ? escapeCsvValue(verification.error) : ""
      );
    } else {
      // No verification found - add empty columns
      rowValues.push("", "", "", "", "", "", "", "");
    }

    return rowValues.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Get quality score for email (0-100)
 */
export function getEmailQualityScore(validation: EmailValidation): number {
  let score = 0;

  if (validation.syntax_valid) score += 20;
  if (validation.domain_exists) score += 25;
  if (validation.has_mx) score += 25;
  if (!validation.is_disposable) score += 20;
  if (!validation.is_role_based) score += 10;

  return Math.min(score, 100);
}

/**
 * Check if email is deliverable (best candidate for outreach)
 */
export function isDeliverable(validation: EmailValidation): boolean {
  return (
    validation.syntax_valid &&
    validation.domain_exists &&
    validation.has_mx &&
    !validation.is_disposable &&
    validation.status === "VALID"
  );
}

/**
 * Get human-readable status message
 */
export function getStatusMessage(validation: EmailValidation): string {
  if (validation.error) {
    return `Error: ${validation.error}`;
  }

  switch (validation.status) {
    case "VALID":
      return "Valid email address";
    case "PROBABLY_VALID":
      return "Probably valid (role-based email)";
    case "INVALID_FORMAT":
      return "Invalid email format";
    case "INVALID_DOMAIN":
      return "Domain doesn't exist";
    case "DISPOSABLE":
      return "Disposable/temporary email";
    case "UNDELIVERABLE":
      return "No MX records found";
    case "ERROR":
      return "Verification error";
    default:
      return validation.status;
  }
}
