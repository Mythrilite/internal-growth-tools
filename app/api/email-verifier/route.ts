import { NextRequest, NextResponse } from "next/server";
import { verifyEmail, verifyEmailsBatch } from "@/lib/email-verifier";

/**
 * POST - Verify a single email or multiple emails
 * 
 * Request body:
 * - Single email: { "email": "user@example.com" }
 * - Batch: { "emails": ["user1@example.com", "user2@example.com"] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle single email
    if (body.email && typeof body.email === "string") {
      const validation = await verifyEmail(body.email);
      return NextResponse.json({
        result: validation,
      });
    }

    // Handle batch emails
    if (Array.isArray(body.emails) && body.emails.length > 0) {
      const validEmails = body.emails.filter((e: any) => typeof e === "string");

      if (validEmails.length === 0) {
        return NextResponse.json(
          { error: "No valid email addresses provided" },
          { status: 400 }
        );
      }

      if (validEmails.length > 100) {
        return NextResponse.json(
          { error: "Maximum 100 emails per request" },
          { status: 400 }
        );
      }

      const result = await verifyEmailsBatch(validEmails);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "Request must include either 'email' (string) or 'emails' (array)" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[email-verifier] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to verify email",
      },
      { status: 500 }
    );
  }
}
