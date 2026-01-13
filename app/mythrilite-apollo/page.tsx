"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Search,
  Hash,
  Download,
  Loader2,
  Users,
  AlertCircle,
  ChevronRight,
  Building2,
  MapPin,
  Briefcase,
  Mail
} from "lucide-react";

interface Lead {
  firstname: string;
  lastname: string;
  headline?: string;
  description?: string;
  profileUrl?: string;
  lastJobTitle?: string;
  lastJobDescription?: string;
  lastJobStartDate?: string;
  address?: string;
  lastCompanyName?: string;
  lastCompanyUrn?: string;
  lastCompanyUrl?: string;
  lastCompanyWebsite?: string;
  lastCompanyDescription?: string;
  lastCompanySize?: number;
  lastCompanyIndustry?: string;
  lastCompanyAddress?: string;
  email?: string;
  emailCertainty?: string;
}

interface SearchQuery {
  firstname?: { include?: string[]; exclude?: string[] };
  lastname?: { include?: string[]; exclude?: string[] };
  currentJobTitle?: { include?: string[]; exclude?: string[] };
  pastJobTitle?: { include?: string[]; exclude?: string[] };
  currentCompanyName?: { include?: string[]; exclude?: string[] };
  pastCompanyName?: { include?: string[]; exclude?: string[] };
  currentCompanyId?: { include?: string[]; exclude?: string[] };
  pastCompanyId?: { include?: string[]; exclude?: string[] };
  currentCompanyWebsite?: { include?: string[]; exclude?: string[] };
  pastCompanyWebsite?: { include?: string[]; exclude?: string[] };
  school?: { include?: string[]; exclude?: string[] };
  languages?: { include?: string[]; exclude?: string[] };
  skills?: { include?: string[]; exclude?: string[] };
  location?: { include?: string[]; exclude?: string[] };
  keyword?: { include?: string[]; exclude?: string[] };
}

export default function MythriliteApolloPage() {
  const [loading, setLoading] = useState(false);
  const [counting, setCounting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [totalLeads, setTotalLeads] = useState<number>(0);
  const [paginationToken, setPaginationToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [maxLeads, setMaxLeads] = useState<number>(100);
  const [enriching, setEnriching] = useState(false);
  const [enrichedCount, setEnrichedCount] = useState<number>(0);

  // Form state for filters
  const [currentJobTitleInclude, setCurrentJobTitleInclude] = useState("");
  const [currentJobTitleExclude, setCurrentJobTitleExclude] = useState("");
  const [pastJobTitleInclude, setPastJobTitleInclude] = useState("");
  const [pastJobTitleExclude, setPastJobTitleExclude] = useState("");
  const [currentCompanyInclude, setCurrentCompanyInclude] = useState("");
  const [currentCompanyExclude, setCurrentCompanyExclude] = useState("");
  const [pastCompanyInclude, setPastCompanyInclude] = useState("");
  const [pastCompanyExclude, setPastCompanyExclude] = useState("");
  const [currentCompanyIdInclude, setCurrentCompanyIdInclude] = useState("");
  const [currentCompanyWebsiteInclude, setCurrentCompanyWebsiteInclude] = useState("");
  const [keywordInclude, setKeywordInclude] = useState("");
  const [keywordExclude, setKeywordExclude] = useState("");
  const [skillsInclude, setSkillsInclude] = useState("");
  const [skillsExclude, setSkillsExclude] = useState("");
  const [languagesInclude, setLanguagesInclude] = useState("");
  const [languagesExclude, setLanguagesExclude] = useState("");
  const [schoolInclude, setSchoolInclude] = useState("");
  const [schoolExclude, setSchoolExclude] = useState("");

  const parseCommaSeparated = (value: string): string[] => {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const buildQuery = (): SearchQuery => {
    const query: SearchQuery = {};

    // Current Job Title
    const currentJobIncArr = parseCommaSeparated(currentJobTitleInclude);
    const currentJobExcArr = parseCommaSeparated(currentJobTitleExclude);
    if (currentJobIncArr.length > 0 || currentJobExcArr.length > 0) {
      query.currentJobTitle = {};
      if (currentJobIncArr.length > 0) query.currentJobTitle.include = currentJobIncArr;
      if (currentJobExcArr.length > 0) query.currentJobTitle.exclude = currentJobExcArr;
    }

    // Past Job Title
    const pastJobIncArr = parseCommaSeparated(pastJobTitleInclude);
    const pastJobExcArr = parseCommaSeparated(pastJobTitleExclude);
    if (pastJobIncArr.length > 0 || pastJobExcArr.length > 0) {
      query.pastJobTitle = {};
      if (pastJobIncArr.length > 0) query.pastJobTitle.include = pastJobIncArr;
      if (pastJobExcArr.length > 0) query.pastJobTitle.exclude = pastJobExcArr;
    }

    // Current Company Name
    const currentCompIncArr = parseCommaSeparated(currentCompanyInclude);
    const currentCompExcArr = parseCommaSeparated(currentCompanyExclude);
    if (currentCompIncArr.length > 0 || currentCompExcArr.length > 0) {
      query.currentCompanyName = {};
      if (currentCompIncArr.length > 0) query.currentCompanyName.include = currentCompIncArr;
      if (currentCompExcArr.length > 0) query.currentCompanyName.exclude = currentCompExcArr;
    }

    // Past Company Name
    const pastCompIncArr = parseCommaSeparated(pastCompanyInclude);
    const pastCompExcArr = parseCommaSeparated(pastCompanyExclude);
    if (pastCompIncArr.length > 0 || pastCompExcArr.length > 0) {
      query.pastCompanyName = {};
      if (pastCompIncArr.length > 0) query.pastCompanyName.include = pastCompIncArr;
      if (pastCompExcArr.length > 0) query.pastCompanyName.exclude = pastCompExcArr;
    }

    // Current Company ID (domain, website, LinkedIn URL, or vanity name)
    const currentCompIdArr = parseCommaSeparated(currentCompanyIdInclude);
    if (currentCompIdArr.length > 0) {
      query.currentCompanyId = { include: currentCompIdArr };
    }

    // Current Company Website
    const currentCompWebsiteArr = parseCommaSeparated(currentCompanyWebsiteInclude);
    if (currentCompWebsiteArr.length > 0) {
      query.currentCompanyWebsite = { include: currentCompWebsiteArr };
    }

    // Location - Always filter for US only
    query.location = { include: ["US"] };

    // Keyword (searches across entire profile)
    const keyIncArr = parseCommaSeparated(keywordInclude);
    const keyExcArr = parseCommaSeparated(keywordExclude);
    if (keyIncArr.length > 0 || keyExcArr.length > 0) {
      query.keyword = {};
      if (keyIncArr.length > 0) query.keyword.include = keyIncArr;
      if (keyExcArr.length > 0) query.keyword.exclude = keyExcArr;
    }

    // Skills
    const skillsIncArr = parseCommaSeparated(skillsInclude);
    const skillsExcArr = parseCommaSeparated(skillsExclude);
    if (skillsIncArr.length > 0 || skillsExcArr.length > 0) {
      query.skills = {};
      if (skillsIncArr.length > 0) query.skills.include = skillsIncArr;
      if (skillsExcArr.length > 0) query.skills.exclude = skillsExcArr;
    }

    // Languages
    const langIncArr = parseCommaSeparated(languagesInclude);
    const langExcArr = parseCommaSeparated(languagesExclude);
    if (langIncArr.length > 0 || langExcArr.length > 0) {
      query.languages = {};
      if (langIncArr.length > 0) query.languages.include = langIncArr;
      if (langExcArr.length > 0) query.languages.exclude = langExcArr;
    }

    // School
    const schoolIncArr = parseCommaSeparated(schoolInclude);
    const schoolExcArr = parseCommaSeparated(schoolExclude);
    if (schoolIncArr.length > 0 || schoolExcArr.length > 0) {
      query.school = {};
      if (schoolIncArr.length > 0) query.school.include = schoolIncArr;
      if (schoolExcArr.length > 0) query.school.exclude = schoolExcArr;
    }

    return query;
  };

  const handleCount = async () => {
    const query = buildQuery();
    if (Object.keys(query).length === 0) {
      setError("Please add at least one search filter");
      return;
    }

    setCounting(true);
    setError(null);
    setCount(null);

    try {
      const response = await fetch("/api/mythrilite-apollo/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to count leads");
      }

      setCount(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCounting(false);
    }
  };

  const handleSearch = async (usePagination: boolean = false) => {
    const query = buildQuery();
    if (Object.keys(query).length === 0) {
      setError("Please add at least one search filter");
      return;
    }

    setLoading(true);
    setError(null);

    if (!usePagination) {
      setLeads([]);
      setPaginationToken(null);
      setEnrichedCount(0);
    }

    try {
      // Calculate how many more leads we can fetch
      const currentCount = usePagination ? leads.length : 0;
      const remainingSlots = maxLeads - currentCount;
      const fetchSize = Math.min(pageSize, remainingSlots);

      if (fetchSize <= 0) {
        setError(`Already reached max leads limit (${maxLeads})`);
        setLoading(false);
        return;
      }

      const requestBody: { query: SearchQuery; pagination?: { size: number; token?: string } } = {
        query,
        pagination: { size: fetchSize },
      };

      if (usePagination && paginationToken) {
        requestBody.pagination!.token = paginationToken;
      }

      const response = await fetch("/api/mythrilite-apollo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to search leads");
      }

      const newLeads = data.leads || [];

      if (usePagination) {
        setLeads((prev) => [...prev, ...newLeads]);
      } else {
        setLeads(newLeads);
      }
      setTotalLeads(data.total || 0);
      setPaginationToken(data.pagination?.token || null);

      // Automatically enrich new leads with emails
      if (newLeads.length > 0) {
        const leadsToEnrich = newLeads.filter(
          (lead: Lead) => lead.lastCompanyWebsite && !lead.email
        );

        if (leadsToEnrich.length > 0) {
          await enrichLeads(leadsToEnrich, usePagination);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const enrichLeads = async (leadsToEnrich: Lead[], isPagination: boolean = false) => {
    if (leadsToEnrich.length === 0) {
      return;
    }

    setEnriching(true);
    // Clear any previous enrichment errors
    if (error && error.includes("enrich")) {
      setError(null);
    }

    try {
      console.log(`Enriching ${leadsToEnrich.length} leads...`);

      const response = await fetch("/api/mythrilite-apollo/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: leadsToEnrich }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to enrich leads");
      }

      console.log(`Enrichment complete: ${data.enrichedCount} emails found`);

      // Update leads with email results
      const enrichmentResults = data.results || [];

      setLeads((currentLeads) => {
        const updatedLeads = [...currentLeads];
        let enrichedIndex = 0;

        for (let i = 0; i < updatedLeads.length; i++) {
          const lead = updatedLeads[i];
          // Check if this lead was in the batch we just enriched
          if (lead.lastCompanyWebsite && !lead.email) {
            const result = enrichmentResults[enrichedIndex];
            if (result && result.email) {
              updatedLeads[i] = {
                ...lead,
                email: result.email,
                emailCertainty: result.certainty,
              };
            }
            enrichedIndex++;

            // Stop when we've processed all results
            if (enrichedIndex >= enrichmentResults.length) {
              break;
            }
          }
        }

        return updatedLeads;
      });

      setEnrichedCount((prev) => prev + (data.enrichedCount || 0));
    } catch (err) {
      console.error("Enrichment error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEnriching(false);
    }
  };

  const handleEnrich = async () => {
    if (leads.length === 0) {
      setError("No leads to enrich. Search for leads first.");
      return;
    }

    // Filter leads that need enrichment (have company website and no email yet)
    const leadsToEnrich = leads.filter(
      (lead) => lead.lastCompanyWebsite && !lead.email
    );

    if (leadsToEnrich.length === 0) {
      setError("All leads are already enriched or missing company website.");
      return;
    }

    await enrichLeads(leadsToEnrich, false);
  };

  const handleDownloadCSV = () => {
    if (leads.length === 0) return;

    const headers = [
      "First Name",
      "Last Name",
      "Email",
      "Email Certainty",
      "Job Title",
      "Headline",
      "Company",
      "Company Website",
      "Company Size",
      "Industry",
      "Location",
      "LinkedIn URL",
    ];

    const rows = leads.map((lead) => [
      lead.firstname || "",
      lead.lastname || "",
      lead.email || "",
      lead.emailCertainty || "",
      lead.lastJobTitle || "",
      (lead.headline || "").replace(/"/g, '""'),
      lead.lastCompanyName || "",
      lead.lastCompanyWebsite || "",
      lead.lastCompanySize?.toString() || "",
      lead.lastCompanyIndustry || "",
      lead.address || "",
      lead.profileUrl || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `icypeas-leads-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setCurrentJobTitleInclude("");
    setCurrentJobTitleExclude("");
    setPastJobTitleInclude("");
    setPastJobTitleExclude("");
    setCurrentCompanyInclude("");
    setCurrentCompanyExclude("");
    setPastCompanyInclude("");
    setPastCompanyExclude("");
    setCurrentCompanyIdInclude("");
    setCurrentCompanyWebsiteInclude("");
    setKeywordInclude("");
    setKeywordExclude("");
    setSkillsInclude("");
    setSkillsExclude("");
    setLanguagesInclude("");
    setLanguagesExclude("");
    setSchoolInclude("");
    setSchoolExclude("");
    setCount(null);
    setLeads([]);
    setError(null);
    setEnrichedCount(0);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Mythrilite Apollo</h1>
        <p className="text-muted-foreground">
          Search for leads using Icypeas People Search and automatically enrich with emails. Use the count feature first to preview results without consuming credits.
        </p>
      </div>

      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Search Filters */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Search Filters</CardTitle>
              <CardDescription>
                All fields support comma-separated values. Results are filtered to US location only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="job" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                  <TabsTrigger value="job" className="text-xs">Job</TabsTrigger>
                  <TabsTrigger value="company" className="text-xs">Company</TabsTrigger>
                  <TabsTrigger value="other" className="text-xs">Other</TabsTrigger>
                </TabsList>

                <TabsContent value="job" className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Briefcase className="h-3 w-3" />
                      Current Job Title
                    </Label>
                    <Input
                      placeholder="Include: CTO, CEO, Founder"
                      value={currentJobTitleInclude}
                      onChange={(e) => setCurrentJobTitleInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude: Intern, Junior"
                      value={currentJobTitleExclude}
                      onChange={(e) => setCurrentJobTitleExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Past Job Title</Label>
                    <Input
                      placeholder="Include: Engineer, Developer"
                      value={pastJobTitleInclude}
                      onChange={(e) => setPastJobTitleInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude titles..."
                      value={pastJobTitleExclude}
                      onChange={(e) => setPastJobTitleExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Search className="h-3 w-3" />
                      Keyword (Full Profile Search)
                    </Label>
                    <Input
                      placeholder="Include: SaaS, B2B, startup"
                      value={keywordInclude}
                      onChange={(e) => setKeywordInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude keywords..."
                      value={keywordExclude}
                      onChange={(e) => setKeywordExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="company" className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Building2 className="h-3 w-3" />
                      Current Company Name
                    </Label>
                    <Input
                      placeholder="Include: Google, Microsoft"
                      value={currentCompanyInclude}
                      onChange={(e) => setCurrentCompanyInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude companies..."
                      value={currentCompanyExclude}
                      onChange={(e) => setCurrentCompanyExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Past Company Name</Label>
                    <Input
                      placeholder="Include: Amazon, IBM"
                      value={pastCompanyInclude}
                      onChange={(e) => setPastCompanyInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude companies..."
                      value={pastCompanyExclude}
                      onChange={(e) => setPastCompanyExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Company ID / Domain / LinkedIn URL</Label>
                    <Input
                      placeholder="icypeas.com, linkedin.com/company/..."
                      value={currentCompanyIdInclude}
                      onChange={(e) => setCurrentCompanyIdInclude(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Company Website</Label>
                    <Input
                      placeholder="microsoft.com, apple.com"
                      value={currentCompanyWebsiteInclude}
                      onChange={(e) => setCurrentCompanyWebsiteInclude(e.target.value)}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="other" className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      Location
                    </Label>
                    <Input
                      value="US"
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">Location is locked to US only</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Skills</Label>
                    <Input
                      placeholder="Include: JavaScript, Python"
                      value={skillsInclude}
                      onChange={(e) => setSkillsInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude skills..."
                      value={skillsExclude}
                      onChange={(e) => setSkillsExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Languages</Label>
                    <Input
                      placeholder="Include: EN, FR, Spanish"
                      value={languagesInclude}
                      onChange={(e) => setLanguagesInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude languages..."
                      value={languagesExclude}
                      onChange={(e) => setLanguagesExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>School</Label>
                    <Input
                      placeholder="Include: Stanford, Harvard"
                      value={schoolInclude}
                      onChange={(e) => setSchoolInclude(e.target.value)}
                    />
                    <Input
                      placeholder="Exclude schools..."
                      value={schoolExclude}
                      onChange={(e) => setSchoolExclude(e.target.value)}
                      className="border-red-200 focus:border-red-400"
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="mt-6 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Max total leads:</Label>
                    <Input
                      type="number"
                      min="1"
                      max="10000"
                      value={maxLeads}
                      onChange={(e) => setMaxLeads(Math.min(10000, Math.max(1, parseInt(e.target.value) || 100)))}
                      className="w-24"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Results per page:</Label>
                    <Input
                      type="number"
                      min="1"
                      max="200"
                      value={pageSize}
                      onChange={(e) => setPageSize(Math.min(200, Math.max(1, parseInt(e.target.value) || 25)))}
                      className="w-20"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleCount}
                  disabled={counting}
                  variant="outline"
                  className="w-full"
                >
                  {counting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Hash className="mr-2 h-4 w-4" />
                  )}
                  Count Results (Free)
                </Button>

                {count !== null && (
                  <div className="p-3 bg-blue-50 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">Matching leads:</p>
                    <p className="text-2xl font-bold text-blue-600">{count.toLocaleString()}</p>
                  </div>
                )}

                <Button
                  onClick={() => handleSearch(false)}
                  disabled={loading || enriching}
                  className="w-full"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  {loading ? "Searching..." : enriching ? "Enriching Emails..." : "Search & Enrich Leads"}
                </Button>

                {leads.length > 0 && !enriching && (
                  <Button
                    onClick={handleEnrich}
                    variant="outline"
                    className="w-full text-xs"
                  >
                    <Mail className="mr-2 h-3 w-3" />
                    Re-enrich Emails
                  </Button>
                )}

                {enriching && (
                  <div className="p-3 bg-blue-50 rounded-lg text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
                    <p className="text-sm text-blue-600 font-medium">Enriching emails...</p>
                    <p className="text-xs text-muted-foreground">This may take a few minutes</p>
                  </div>
                )}

                {enrichedCount > 0 && !enriching && (
                  <div className="p-3 bg-green-50 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">Emails found:</p>
                    <p className="text-2xl font-bold text-green-600">{enrichedCount}</p>
                  </div>
                )}

                <Button
                  onClick={clearFilters}
                  variant="ghost"
                  className="w-full text-muted-foreground"
                >
                  Clear All Filters
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Results
                    {leads.length > 0 && (
                      <Badge variant="secondary">
                        {leads.length} of {totalLeads.toLocaleString()}
                        {leads.length >= maxLeads && ` (max: ${maxLeads})`}
                      </Badge>
                    )}
                    {enriching && (
                      <Badge variant="outline" className="bg-blue-50">
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Enriching...
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Lead search results with automated email enrichment
                  </CardDescription>
                </div>
                {leads.length > 0 && (
                  <Button onClick={handleDownloadCSV} variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {leads.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No leads to display.</p>
                  <p className="text-sm mt-1">Use the filters on the left to search for leads.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2 font-medium">Name</th>
                          <th className="text-left py-2 px-2 font-medium">Email</th>
                          <th className="text-left py-2 px-2 font-medium">Title</th>
                          <th className="text-left py-2 px-2 font-medium">Company</th>
                          <th className="text-left py-2 px-2 font-medium">Location</th>
                          <th className="text-left py-2 px-2 font-medium">Profile</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((lead, index) => (
                          <tr key={index} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-2">
                              <div className="font-medium">
                                {lead.firstname} {lead.lastname}
                              </div>
                              {lead.headline && (
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {lead.headline}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              {lead.email ? (
                                <div>
                                  <div className="text-xs font-mono">{lead.email}</div>
                                  {lead.emailCertainty && (
                                    <Badge
                                      variant={
                                        lead.emailCertainty === "ultra_sure" || lead.emailCertainty === "sure"
                                          ? "default"
                                          : "secondary"
                                      }
                                      className="text-xs mt-1"
                                    >
                                      {lead.emailCertainty}
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <div className="max-w-[150px] truncate">
                                {lead.lastJobTitle || "-"}
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-medium">{lead.lastCompanyName || "-"}</div>
                              {lead.lastCompanyIndustry && (
                                <div className="text-xs text-muted-foreground">
                                  {lead.lastCompanyIndustry}
                                  {lead.lastCompanySize && ` (${lead.lastCompanySize} emp)`}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <div className="text-xs max-w-[120px] truncate">
                                {lead.address || "-"}
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              {lead.profileUrl ? (
                                <a
                                  href={lead.profileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline text-xs"
                                >
                                  LinkedIn
                                </a>
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {paginationToken && leads.length < totalLeads && leads.length < maxLeads && (
                    <div className="flex flex-col items-center gap-2 pt-4">
                      <Button
                        onClick={() => handleSearch(true)}
                        disabled={loading || enriching}
                        variant="outline"
                      >
                        {loading || enriching ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ChevronRight className="mr-2 h-4 w-4" />
                        )}
                        {loading ? "Loading..." : enriching ? "Enriching..." : `Load More (${leads.length} / ${Math.min(totalLeads, maxLeads).toLocaleString()})`}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Max limit: {maxLeads.toLocaleString()} leads
                      </p>
                    </div>
                  )}
                  {leads.length >= maxLeads && leads.length < totalLeads && (
                    <div className="flex justify-center pt-4">
                      <p className="text-sm text-muted-foreground">
                        Reached max leads limit ({maxLeads.toLocaleString()}). Increase limit to load more.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
