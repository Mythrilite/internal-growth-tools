import { NextRequest, NextResponse } from "next/server";

const ICYPEAS_API_URL = "https://app.icypeas.com/api";
const POLL_INTERVAL = 5000; // 5 seconds
const POLL_TIMEOUT = 1800000; // 30 minutes

interface Lead {
  firstname: string;
  lastname: string;
  lastCompanyWebsite?: string;
}

interface EmailResult {
  email: string;
  certainty: string;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ICYPEAS_API_KEY;
    const userId = process.env.ICYPEAS_USER_ID;

    if (!apiKey || !userId) {
      return NextResponse.json(
        { error: "Icypeas API credentials not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { leads } = body as { leads: Lead[] };

    if (!leads || leads.length === 0) {
      return NextResponse.json(
        { error: "No leads provided for enrichment" },
        { status: 400 }
      );
    }

    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    // Prepare bulk data: [[firstname, lastname, domain], ...]
    const bulkData = leads.map((lead) => {
      const domain = lead.lastCompanyWebsite || "";
      return [lead.firstname, lead.lastname, domain];
    });

    // Submit bulk search
    console.log(`Submitting bulk email search for ${leads.length} leads...`);
    const submitResponse = await fetch(`${ICYPEAS_API_URL}/bulk-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user: userId,
        name: `ui_bulk_${new Date().toISOString()}`,
        task: "email-search",
        data: bulkData,
      }),
    });

    if (!submitResponse.ok) {
      const error = await submitResponse.text();
      return NextResponse.json(
        { error: `Failed to submit bulk search: ${error}` },
        { status: submitResponse.status }
      );
    }

    const submitResult = await submitResponse.json();
    if (!submitResult.success || !submitResult.file) {
      return NextResponse.json(
        { error: "Bulk search submission failed", details: submitResult },
        { status: 500 }
      );
    }

    const fileId = submitResult.file;
    console.log(`Bulk search submitted with file ID: ${fileId}`);

    // Poll for completion
    const completed = await pollBulkCompletion(fileId, headers, leads.length);
    if (!completed) {
      console.log("Polling timed out, attempting to fetch results anyway...");
    }

    // Fetch results
    console.log("Fetching results...");
    const results = await fetchBulkResults(fileId, headers, leads.length);

    return NextResponse.json({
      success: true,
      enrichedCount: results.length,
      results,
    });
  } catch (error) {
    console.error("Email enrichment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function pollBulkCompletion(
  fileId: string,
  headers: Record<string, string>,
  totalItems: number
): Promise<boolean> {
  const startTime = Date.now();
  let pollInterval = POLL_INTERVAL;
  let lastProgress = 0;

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      const response = await fetch(`${ICYPEAS_API_URL}/search-files/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ file: fileId }),
      });

      if (response.ok) {
        const result = await response.json();

        if (result.success) {
          // Try new format first: files array
          const files = result.files || [];
          if (files.length > 0) {
            const file = files[0];
            const status = file.status;
            const finished = file.finished || false;
            const progress = file.progress || 0;

            if (progress !== lastProgress) {
              console.log(`Progress: ${progress}/${totalItems}`);
              lastProgress = progress;
            }

            if (status === "done" || finished) {
              console.log("Bulk search completed!");
              return true;
            }
          }
          // Fall back to items format
          else if (result.items && result.items.length > 0) {
            const item = result.items[0];
            const status = item.status;
            const finished = item.finished || false;
            const progress = item.progress || 0;

            if (progress !== lastProgress) {
              console.log(`Progress: ${progress}/${totalItems}`);
              lastProgress = progress;
            }

            if (status === "done" || finished) {
              console.log("Bulk search completed!");
              return true;
            }
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      pollInterval = Math.min(pollInterval * 1.4, 60000); // Gradual backoff up to 60s
    } catch (error) {
      console.error("Polling error:", error);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  console.log("Polling timeout reached");
  return false;
}

async function fetchBulkResults(
  fileId: string,
  headers: Record<string, string>,
  totalLeads: number
): Promise<EmailResult[]> {
  const results: EmailResult[] = [];
  let hasMore = true;
  let sortValue: string | null = null;

  while (hasMore) {
    try {
      const payload: any = {
        mode: "bulk",
        file: fileId,
        limit: 100,
      };

      if (sortValue) {
        payload.sort = sortValue;
        payload.next = true;
      }

      const response = await fetch(
        `${ICYPEAS_API_URL}/bulk-single-searchs/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        console.error(`Fetch results error: ${response.status}`);
        break;
      }

      const result = await response.json();

      if (result.success && result.items && result.items.length > 0) {
        const items = result.items;

        for (const item of items) {
          const order = item.order;
          if (order >= 0 && order < totalLeads) {
            const resultsData = item.results || {};
            const emails = resultsData.emails || [];

            if (emails.length > 0) {
              // Get best email by certainty
              const best = emails.reduce((prev: any, curr: any) => {
                return certaintyScore(curr.certainty) > certaintyScore(prev.certainty)
                  ? curr
                  : prev;
              });

              results[order] = {
                email: best.email,
                certainty: best.certainty,
              };
            }
          }
        }

        // Check for more pages
        if (items.length < 100) {
          hasMore = false;
        } else {
          const lastItem = items[items.length - 1];
          sortValue = lastItem.createdAt || lastItem._id || null;
          if (!sortValue) {
            hasMore = false;
          }
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error("Fetch error:", error);
      hasMore = false;
    }
  }

  console.log(`Fetched ${results.filter(Boolean).length} email results`);
  return results;
}

function certaintyScore(certainty: string): number {
  const scores: Record<string, number> = {
    ultra_sure: 4,
    sure: 3,
    likely: 2,
    maybe: 1,
  };
  return scores[certainty] || 0;
}
