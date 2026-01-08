import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.INSTANTLY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "INSTANTLY_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all campaigns from Instantly.ai
    const campaignsResponse = await fetch(
      "https://api.instantly.ai/api/v2/campaigns?limit=100",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!campaignsResponse.ok) {
      throw new Error(`Instantly API error: ${campaignsResponse.status}`);
    }

    const campaignsData = await campaignsResponse.json();
    const campaigns = campaignsData.items || [];

    // Fetch analytics for each campaign
    const campaignsWithAnalytics = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          const analyticsResponse = await fetch(
            `https://api.instantly.ai/api/v2/campaigns/analytics/overview?id=${campaign.id}`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            }
          );

          if (!analyticsResponse.ok) {
            console.error(`Failed to fetch analytics for campaign ${campaign.id}`);
            return {
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              timestamp_created: campaign.created_at || new Date().toISOString(),
              timestamp_updated: campaign.updated_at,
              emails_sent: 0,
              opens: 0,
              clicks: 0,
              replies: 0,
              bounce_rate: 0,
            };
          }

          const analytics = await analyticsResponse.json();

          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            timestamp_created: campaign.created_at || new Date().toISOString(),
            timestamp_updated: campaign.updated_at,
            emails_sent: analytics.emails_sent_count || 0,
            opens: analytics.open_count_unique || 0,
            clicks: analytics.link_click_count_unique || 0,
            replies: analytics.reply_count_unique || 0,
            bounce_rate: analytics.emails_sent_count > 0
              ? (analytics.bounced_count / analytics.emails_sent_count) * 100
              : 0,
          };
        } catch (error) {
          console.error(`Error fetching analytics for campaign ${campaign.id}:`, error);
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            timestamp_created: campaign.created_at || new Date().toISOString(),
            timestamp_updated: campaign.updated_at,
            emails_sent: 0,
            opens: 0,
            clicks: 0,
            replies: 0,
            bounce_rate: 0,
          };
        }
      })
    );

    return NextResponse.json({ campaigns: campaignsWithAnalytics });
  } catch (error) {
    console.error("Error fetching Instantly campaigns:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}
