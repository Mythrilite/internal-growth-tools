"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Loader2, ArrowLeft, Mail, Linkedin, Twitter, RefreshCw, TrendingUp, Users, Send, MousePointer } from "lucide-react";
import type { RangeValue, DateValue } from "react-aria-components";

interface Campaign {
  id: string;
  name: string;
  status: string;
  source: "email" | "linkedin" | "twitter";
}

interface CampaignAnalytics {
  campaign_id: string;
  campaign_name: string;
  timestamp_created?: string;
  timestamp_updated?: string;
  // Email analytics (Instantly)
  emails_sent?: number;
  opens?: number;
  clicks?: number;
  replies?: number;
  bounce_rate?: number;
  // LinkedIn analytics (Prosp)
  connections_sent?: number;
  connections_accepted?: number;
  messages_sent?: number;
  replies_received?: number;
  // Twitter analytics (Drippi)
  dms_sent?: number;
  dms_responded?: number;
  dms_skipped?: number;
  dms_failed?: number;
  drippi_replies?: any[];
  replies_by_classification?: {
    interested: number;
    unknown: number;
    uninterested: number;
    total: number;
  };
}

export default function GrowthDashboardPage() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [emailCampaigns, setEmailCampaigns] = useState<CampaignAnalytics[]>([]);
  const [linkedinCampaigns, setLinkedinCampaigns] = useState<CampaignAnalytics[]>([]);
  const [twitterAutomations, setTwitterAutomations] = useState<CampaignAnalytics[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("email");
  const [dateFilter, setDateFilter] = useState<RangeValue<DateValue> | null>(null);

  useEffect(() => {
    fetchAllCampaigns();
  }, []);

  const fetchAllCampaigns = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all campaigns in parallel
      const [emailRes, linkedinRes, twitterRes] = await Promise.allSettled([
        fetch("/api/growth-dashboard/instantly"),
        fetch("/api/growth-dashboard/prosp"),
        fetch("/api/growth-dashboard/drippi"),
      ]);

      // Handle email campaigns
      if (emailRes.status === "fulfilled" && emailRes.value.ok) {
        const data = await emailRes.value.json();
        setEmailCampaigns(data.campaigns || []);
      } else {
        console.error("Failed to fetch email campaigns:", emailRes);
      }

      // Handle LinkedIn campaigns
      if (linkedinRes.status === "fulfilled" && linkedinRes.value.ok) {
        const data = await linkedinRes.value.json();
        setLinkedinCampaigns(data.campaigns || []);
      } else {
        console.error("Failed to fetch LinkedIn campaigns:", linkedinRes);
      }

      // Handle Twitter automations
      if (twitterRes.status === "fulfilled" && twitterRes.value.ok) {
        const data = await twitterRes.value.json();
        setTwitterAutomations(data.automations || []);
      } else {
        console.error("Failed to fetch Twitter automations:", twitterRes);
      }
    } catch (err) {
      console.error("Error fetching campaigns:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAllCampaigns();
    setRefreshing(false);
  };

  const filterCampaignsByDate = (campaigns: CampaignAnalytics[]) => {
    if (!dateFilter?.start || !dateFilter?.end) {
      return campaigns;
    }

    return campaigns.filter((campaign) => {
      if (!campaign.timestamp_created) return false;
      
      try {
        // Parse campaign date
        const campaignDate = new Date(campaign.timestamp_created);
        
        // Convert DateValue objects to Date objects
        // DateValue.toString() returns YYYY-MM-DD format
        const startDateStr = dateFilter.start!.toString();
        const endDateStr = dateFilter.end!.toString();
        
        // Create date objects at midnight
        const startDate = new Date(startDateStr + "T00:00:00Z");
        const endDate = new Date(endDateStr + "T23:59:59Z");
        
        // Compare dates
        return campaignDate >= startDate && campaignDate <= endDate;
      } catch (error) {
        console.error("Error filtering campaign date:", error, campaign);
        return false;
      }
    });
  };

  const clearDateFilter = () => {
    setDateFilter(null);
  };

  // Apply date filters
  const filteredEmailCampaigns = filterCampaignsByDate(emailCampaigns);
  const filteredLinkedinCampaigns = filterCampaignsByDate(linkedinCampaigns);
  const filteredTwitterAutomations = filterCampaignsByDate(twitterAutomations);

  // Calculate summary stats for email campaigns
  const emailStats = {
    total_sent: filteredEmailCampaigns.reduce((sum, c) => sum + (c.emails_sent || 0), 0),
    total_opens: filteredEmailCampaigns.reduce((sum, c) => sum + (c.opens || 0), 0),
    total_clicks: filteredEmailCampaigns.reduce((sum, c) => sum + (c.clicks || 0), 0),
    total_replies: filteredEmailCampaigns.reduce((sum, c) => sum + (c.replies || 0), 0),
    avg_open_rate: filteredEmailCampaigns.length > 0
      ? filteredEmailCampaigns.reduce((sum, c) => {
          const rate = (c.emails_sent && c.opens) ? (c.opens / c.emails_sent) * 100 : 0;
          return sum + rate;
        }, 0) / filteredEmailCampaigns.length
      : 0,
    avg_reply_rate: filteredEmailCampaigns.length > 0
      ? filteredEmailCampaigns.reduce((sum, c) => {
          const rate = (c.emails_sent && c.replies) ? (c.replies / c.emails_sent) * 100 : 0;
          return sum + rate;
        }, 0) / filteredEmailCampaigns.length
      : 0,
  };

  // Calculate summary stats for LinkedIn campaigns
  const linkedinStats = {
    total_connections_sent: filteredLinkedinCampaigns.reduce((sum, c) => sum + (c.connections_sent || 0), 0),
    total_accepted: filteredLinkedinCampaigns.reduce((sum, c) => sum + (c.connections_accepted || 0), 0),
    total_messages: filteredLinkedinCampaigns.reduce((sum, c) => sum + (c.messages_sent || 0), 0),
    total_replies: filteredLinkedinCampaigns.reduce((sum, c) => sum + (c.replies_received || 0), 0),
    avg_acceptance_rate: filteredLinkedinCampaigns.length > 0
      ? filteredLinkedinCampaigns.reduce((sum, c) => {
          const rate = (c.connections_sent && c.connections_accepted)
            ? (c.connections_accepted / c.connections_sent) * 100
            : 0;
          return sum + rate;
        }, 0) / filteredLinkedinCampaigns.length
      : 0,
  };

  // Calculate summary stats for Twitter automations
  const twitterStats = {
    total_sent: filteredTwitterAutomations.reduce((sum, c) => sum + (c.dms_sent || 0), 0),
    total_responded: filteredTwitterAutomations.reduce((sum, c) => sum + (c.dms_responded || 0), 0),
    total_skipped: filteredTwitterAutomations.reduce((sum, c) => sum + (c.dms_skipped || 0), 0),
    total_failed: filteredTwitterAutomations.reduce((sum, c) => sum + (c.dms_failed || 0), 0),
    avg_response_rate: filteredTwitterAutomations.length > 0
      ? filteredTwitterAutomations.reduce((sum, c) => {
          const rate = (c.dms_sent && c.dms_responded) ? (c.dms_responded / c.dms_sent) * 100 : 0;
          return sum + rate;
        }, 0) / filteredTwitterAutomations.length
      : 0,
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Growth Dashboard</h1>
          <p className="text-muted-foreground">
            Track all your cold/warm outbound campaigns across Email, LinkedIn, and Twitter
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Date Filter Section */}
      <div className="mb-8 flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <DateRangePicker
            value={dateFilter}
            onChange={setDateFilter}
            label="Filter by Campaign Date"
            placeholder="Select dates"
          />
          <Button
            onClick={clearDateFilter}
            variant="ghost"
            size="sm"
            disabled={!dateFilter}
            className="text-xs h-8"
          >
            Clear
          </Button>
        </div>
        {dateFilter && (
          <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded w-fit">
            Showing {filteredEmailCampaigns.length + filteredLinkedinCampaigns.length + filteredTwitterAutomations.length} of {emailCampaigns.length + linkedinCampaigns.length + twitterAutomations.length} campaigns
          </div>
        )}
      </div>

      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email ({filteredEmailCampaigns.length}{emailCampaigns.length > filteredEmailCampaigns.length ? `/${emailCampaigns.length}` : ""})
            </TabsTrigger>
            <TabsTrigger value="linkedin" className="flex items-center gap-2">
              <Linkedin className="h-4 w-4" />
              LinkedIn ({filteredLinkedinCampaigns.length}{linkedinCampaigns.length > filteredLinkedinCampaigns.length ? `/${linkedinCampaigns.length}` : ""})
            </TabsTrigger>
            <TabsTrigger value="twitter" className="flex items-center gap-2">
              <Twitter className="h-4 w-4" />
              Twitter ({filteredTwitterAutomations.length}{twitterAutomations.length > filteredTwitterAutomations.length ? `/${twitterAutomations.length}` : ""})
            </TabsTrigger>
          </TabsList>

          {/* Email Tab */}
          <TabsContent value="email">
            <div className="grid gap-6">
              {filteredEmailCampaigns.length === 0 && emailCampaigns.length > 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No email campaigns found in the selected date range.
                  </CardContent>
                </Card>
              ) : filteredEmailCampaigns.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        Total Sent
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{emailStats.total_sent.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Total Replies
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">{emailStats.total_replies.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Avg Reply Rate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600">{emailStats.avg_reply_rate.toFixed(1)}%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <MousePointer className="h-4 w-4" />
                        Bounce Rate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">
                        {emailCampaigns.length > 0
                          ? (emailCampaigns.reduce((sum, c) => sum + (c.bounce_rate || 0), 0) / emailCampaigns.length).toFixed(1)
                          : "0"}%
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {emailCampaigns.reduce((sum, c) => {
                          const bounced = c.emails_sent && c.bounce_rate
                            ? Math.round((c.emails_sent * c.bounce_rate) / 100)
                            : 0;
                          return sum + bounced;
                        }, 0).toLocaleString()} bounced
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}
              {filteredEmailCampaigns.length === 0 && !emailCampaigns.length ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No email campaigns found. Check your Instantly.ai API key configuration.
                  </CardContent>
                </Card>
              ) : (
                filteredEmailCampaigns.map((campaign) => (
                  <Card key={campaign.campaign_id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5 text-blue-500" />
                            {campaign.campaign_name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Email Campaign via Instantly.ai
                          </CardDescription>
                        </div>
                        <Badge variant="default">Email</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Sent</p>
                          <p className="text-2xl font-bold">{campaign.emails_sent || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Opens</p>
                          <p className="text-2xl font-bold text-blue-600">{campaign.opens || 0}</p>
                          {campaign.emails_sent && campaign.opens && (
                            <p className="text-xs text-muted-foreground">
                              {((campaign.opens / campaign.emails_sent) * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Clicks</p>
                          <p className="text-2xl font-bold text-purple-600">{campaign.clicks || 0}</p>
                          {campaign.emails_sent && campaign.clicks && (
                            <p className="text-xs text-muted-foreground">
                              {((campaign.clicks / campaign.emails_sent) * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Replies</p>
                          <p className="text-2xl font-bold text-green-600">{campaign.replies || 0}</p>
                          {campaign.emails_sent && campaign.replies && (
                            <p className="text-xs text-muted-foreground">
                              {((campaign.replies / campaign.emails_sent) * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Bounce Rate</p>
                          <p className="text-2xl font-bold text-red-600">
                            {campaign.bounce_rate ? `${campaign.bounce_rate.toFixed(1)}%` : "0%"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* LinkedIn Tab */}
          <TabsContent value="linkedin">
            <div className="grid gap-6">
              {filteredLinkedinCampaigns.length === 0 && linkedinCampaigns.length > 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No LinkedIn campaigns found in the selected date range.
                  </CardContent>
                </Card>
              ) : filteredLinkedinCampaigns.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Connections Sent
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{linkedinStats.total_connections_sent.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Avg Acceptance Rate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">{linkedinStats.avg_acceptance_rate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground mt-1">{linkedinStats.total_accepted.toLocaleString()} accepted</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        Total Messages
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600">{linkedinStats.total_messages.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Total Replies
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-purple-600">{linkedinStats.total_replies.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                </div>
              )}
              {filteredLinkedinCampaigns.length === 0 && !linkedinCampaigns.length ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No LinkedIn campaigns found. Check your Prosp.ai API key configuration.
                  </CardContent>
                </Card>
              ) : (
                filteredLinkedinCampaigns.map((campaign) => (
                  <Card key={campaign.campaign_id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Linkedin className="h-5 w-5 text-blue-700" />
                            {campaign.campaign_name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            LinkedIn Campaign via Prosp.ai
                          </CardDescription>
                        </div>
                        <Badge variant="default" className="bg-blue-700">LinkedIn</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Connections Sent</p>
                          <p className="text-2xl font-bold">{campaign.connections_sent || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Accepted</p>
                          <p className="text-2xl font-bold text-green-600">{campaign.connections_accepted || 0}</p>
                          {campaign.connections_sent && campaign.connections_accepted && (
                            <p className="text-xs text-muted-foreground">
                              {((campaign.connections_accepted / campaign.connections_sent) * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Messages</p>
                          <p className="text-2xl font-bold text-blue-600">{campaign.messages_sent || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Replies</p>
                          <p className="text-2xl font-bold text-purple-600">{campaign.replies_received || 0}</p>
                          {campaign.messages_sent && campaign.replies_received && (
                            <p className="text-xs text-muted-foreground">
                              {((campaign.replies_received / campaign.messages_sent) * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Twitter Tab */}
          <TabsContent value="twitter">
            <div className="grid gap-6">
              {filteredTwitterAutomations.length === 0 && twitterAutomations.length > 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No Twitter automations found in the selected date range.
                  </CardContent>
                </Card>
              ) : filteredTwitterAutomations.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        Total DMs Sent
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{twitterStats.total_sent.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Avg Response Rate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">{twitterStats.avg_response_rate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground mt-1">{twitterStats.total_responded.toLocaleString()} responded</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Total Skipped
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-yellow-600">{twitterStats.total_skipped.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Total Failed
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">{twitterStats.total_failed.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                </div>
              )}
              {filteredTwitterAutomations.length === 0 && !twitterAutomations.length ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No Twitter automations found. Check your Drippi.ai API key configuration.
                  </CardContent>
                </Card>
              ) : (
                filteredTwitterAutomations.map((automation) => (
                  <Card key={automation.campaign_id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Twitter className="h-5 w-5 text-sky-500" />
                            {automation.campaign_name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Twitter Automation via Drippi.ai
                          </CardDescription>
                        </div>
                        <Badge variant="default" className="bg-sky-500">Twitter</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                         <div className="space-y-1">
                           <p className="text-sm text-muted-foreground">DMs Sent</p>
                           <p className="text-2xl font-bold">{automation.dms_sent || 0}</p>
                         </div>
                         <div className="space-y-1">
                           <p className="text-sm text-muted-foreground">Responded</p>
                           <p className="text-2xl font-bold text-green-600">{automation.dms_responded || 0}</p>
                           {automation.dms_sent && automation.dms_responded && (
                             <p className="text-xs text-muted-foreground">
                               {((automation.dms_responded / automation.dms_sent) * 100).toFixed(1)}%
                             </p>
                           )}
                         </div>
                         <div className="space-y-1">
                           <p className="text-sm text-muted-foreground">Skipped</p>
                           <p className="text-2xl font-bold text-yellow-600">{automation.dms_skipped || 0}</p>
                         </div>
                         <div className="space-y-1">
                           <p className="text-sm text-muted-foreground">Failed</p>
                           <p className="text-2xl font-bold text-red-600">{automation.dms_failed || 0}</p>
                         </div>
                       </div>
                       {automation.replies_by_classification && automation.replies_by_classification.total > 0 && (
                         <div className="border-t pt-4 mt-4">
                           <p className="text-xs font-semibold text-muted-foreground mb-3">Reply Classifications</p>
                           <div className="grid grid-cols-3 gap-3">
                             <div className="space-y-1">
                               <p className="text-xs text-muted-foreground">Interested</p>
                               <p className="text-lg font-bold text-green-600">{automation.replies_by_classification.interested}</p>
                               <p className="text-xs text-muted-foreground">
                                 {automation.replies_by_classification.total > 0 
                                   ? ((automation.replies_by_classification.interested / automation.replies_by_classification.total) * 100).toFixed(0)
                                   : 0}%
                               </p>
                             </div>
                             <div className="space-y-1">
                               <p className="text-xs text-muted-foreground">Unknown</p>
                               <p className="text-lg font-bold text-gray-600">{automation.replies_by_classification.unknown}</p>
                               <p className="text-xs text-muted-foreground">
                                 {automation.replies_by_classification.total > 0
                                   ? ((automation.replies_by_classification.unknown / automation.replies_by_classification.total) * 100).toFixed(0)
                                   : 0}%
                               </p>
                             </div>
                             <div className="space-y-1">
                               <p className="text-xs text-muted-foreground">Uninterested</p>
                               <p className="text-lg font-bold text-red-600">{automation.replies_by_classification.uninterested}</p>
                               <p className="text-xs text-muted-foreground">
                                 {automation.replies_by_classification.total > 0
                                   ? ((automation.replies_by_classification.uninterested / automation.replies_by_classification.total) * 100).toFixed(0)
                                   : 0}%
                               </p>
                             </div>
                           </div>
                         </div>
                       )}
                     </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
