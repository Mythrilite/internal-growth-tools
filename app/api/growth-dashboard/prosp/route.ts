import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.PROSP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "PROSP_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all campaigns from Prosp.ai
    const campaignsResponse = await fetch(
      "https://prosp.ai/api/v1/campaigns/lists",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ api_key: apiKey }),
      }
    );

    if (!campaignsResponse.ok) {
      throw new Error(`Prosp API error: ${campaignsResponse.status}`);
    }

    const campaignsData = await campaignsResponse.json();
    const campaigns = campaignsData.data || [];

    // Fetch analytics for each campaign
    const campaignsWithAnalytics = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          const analyticsResponse = await fetch(
            "https://prosp.ai/api/v1/campaigns/analytics",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                api_key: apiKey,
                campaign_id: campaign.campaign_id,
              }),
            }
          );

          if (!analyticsResponse.ok) {
            console.error(`Failed to fetch analytics for campaign ${campaign.campaign_id}`);
            return {
              campaign_id: campaign.campaign_id,
              campaign_name: campaign.campaign_name,
              timestamp_created: campaign.created_at || new Date().toISOString(),
              timestamp_updated: campaign.updated_at,
              connections_sent: 0,
              connections_accepted: 0,
              messages_sent: 0,
              replies_received: 0,
            };
          }

          const analyticsData = await analyticsResponse.json();
          const analytics = analyticsData.data || [];

          // Aggregate analytics data
          const stats = analytics.reduce(
            (acc: any, event: any) => {
              switch (event.action) {
                case "connection_request_sent":
                  acc.connections_sent += event.count || 0;
                  break;
                case "connection_accepted":
                  acc.connections_accepted += event.count || 0;
                  break;
                case "message_sent":
                  acc.messages_sent += event.count || 0;
                  break;
                case "reply_received":
                  acc.replies_received += event.count || 0;
                  break;
              }
              return acc;
            },
            {
              connections_sent: 0,
              connections_accepted: 0,
              messages_sent: 0,
              replies_received: 0,
            }
          );

          return {
            campaign_id: campaign.campaign_id,
            campaign_name: campaign.campaign_name,
            timestamp_created: campaign.created_at || new Date().toISOString(),
            timestamp_updated: campaign.updated_at,
            ...stats,
          };
        } catch (error) {
          console.error(`Error fetching analytics for campaign ${campaign.campaign_id}:`, error);
          return {
            campaign_id: campaign.campaign_id,
            campaign_name: campaign.campaign_name,
            timestamp_created: campaign.created_at || new Date().toISOString(),
            timestamp_updated: campaign.updated_at,
            connections_sent: 0,
            connections_accepted: 0,
            messages_sent: 0,
            replies_received: 0,
          };
        }
      })
    );

    return NextResponse.json({ campaigns: campaignsWithAnalytics });
  } catch (error) {
    console.error("Error fetching Prosp campaigns:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}
