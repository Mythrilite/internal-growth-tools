import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.DRIPPI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "DRIPPI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all automations from Drippi.ai
    const automationsResponse = await fetch(
      "https://app.drippi.ai/api/v1/automations",
      {
        headers: {
          "x-api-key": apiKey,
        },
      }
    );

    if (!automationsResponse.ok) {
      throw new Error(`Drippi API error: ${automationsResponse.status}`);
    }

    const automationsData = await automationsResponse.json();
    const automations = automationsData.automations || [];

    // Fetch replies for each automation
    const transformedAutomations = await Promise.all(
      automations.map(async (automation: any) => {
        let replies = [];
        let repliesWithClassification = {
          interested: 0,
          unknown: 0,
          uninterested: 0,
          total: 0,
        };

        try {
          // Fetch replies for this automation
          const repliesResponse = await fetch(
            `https://app.drippi.ai/api/v1/automations/${automation.id}/replies`,
            {
              headers: {
                "x-api-key": apiKey,
              },
            }
          );

          if (repliesResponse.ok) {
            const repliesData = await repliesResponse.json();
            replies = repliesData.replies || [];
            
            // Count replies by classification
            repliesWithClassification.total = replies.length;
            replies.forEach((reply: any) => {
              const classification = (reply.classification || "unknown").toLowerCase();
              if (classification === "interested") {
                repliesWithClassification.interested++;
              } else if (classification === "uninterested") {
                repliesWithClassification.uninterested++;
              } else {
                repliesWithClassification.unknown++;
              }
            });
          } else {
            console.warn(`Failed to fetch replies for automation ${automation.id}: ${repliesResponse.status}`);
          }
        } catch (error) {
          console.error(`Error fetching replies for automation ${automation.id}:`, error);
          // Continue with empty replies array
        }

        return {
          campaign_id: automation.id,
          campaign_name: automation.name,
          timestamp_created: automation.created_at || new Date().toISOString(),
          timestamp_updated: automation.updated_at,
          dms_sent: automation.sentMessages || 0,
          dms_responded: automation.respondedMessages || 0,
          dms_skipped: automation.skippedMessages || 0,
          dms_failed: automation.failedMessages || 0,
          drippi_replies: replies,
          replies_by_classification: repliesWithClassification,
        };
      })
    );

    return NextResponse.json({ automations: transformedAutomations });
  } catch (error) {
    console.error("Error fetching Drippi automations:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch automations" },
      { status: 500 }
    );
  }
}
