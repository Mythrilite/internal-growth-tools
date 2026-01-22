"use client";

import { useState } from "react";
import Link from "next/link";
import * as Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  convertToCSV, 
  getEmailQualityScore, 
  isDeliverable,
  getStatusMessage,
  type EmailValidation 
} from "@/lib/email-verifier";
import { 
  Download, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  Zap, 
  ArrowLeft,
  Mail,
  TrendingUp,
  Shield,
} from "lucide-react";

type Tab = "single" | "batch";

interface VerificationStats {
  total: number;
  valid: number;
  disposable: number;
  invalid: number;
  role_based: number;
  errors: number;
}

interface VerificationProgress {
  current: number;
  total: number;
  message: string;
}

export default function EmailVerifierPage() {
  const [tab, setTab] = useState<Tab>("single");
  const [singleEmail, setSingleEmail] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<EmailValidation[]>([]);
  const [stats, setStats] = useState<VerificationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<VerificationProgress | null>(null);

  // Single email verification
  const verifySingleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleEmail.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch("/api/email-verifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: singleEmail }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to verify email");
      }

      const data = await response.json();
      setResults([data.result]);
      setSingleEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify email");
    } finally {
      setLoading(false);
    }
  };

  // Batch verification from CSV
  const verifyBatch = async () => {
    if (!csvFile) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setProgress(null);
    setStats(null);

    try {
      const csvContent = await csvFile.text();
      const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

      if (!parsed.data || parsed.data.length === 0) {
        throw new Error("No data found in CSV file");
      }

      // Extract emails from CSV - try common column names
      const emailColumn = ["email", "emails", "e-mail", "address", "contact_email"]
        .find(col => (parsed.data[0] as any)?.[col]);

      if (!emailColumn) {
        throw new Error(
          `No email column found. Expected one of: email, emails, e-mail, address, contact_email`
        );
      }

      const emails = (parsed.data as any[])
        .map(row => (row as any)[emailColumn])
        .filter(email => email && typeof email === "string" && email.trim());

      if (emails.length === 0) {
        throw new Error("No valid emails found in CSV");
      }

      console.log(`Processing ${emails.length} emails in batches of 50...`);

      // Process in batches of 50 to avoid timeout
      const BATCH_SIZE = 50;
      const allResults: EmailValidation[] = [];
      const batches: string[][] = [];

      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        batches.push(emails.slice(i, i + BATCH_SIZE));
      }

      setProgress({
        current: 0,
        total: emails.length,
        message: `Processing batch 1/${batches.length}...`
      });

      // Process batches sequentially to avoid overwhelming the API
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;

        setProgress({
          current: i * BATCH_SIZE,
          total: emails.length,
          message: `Processing batch ${batchNum}/${batches.length} (${batch.length} emails)...`
        });

        const response = await fetch("/api/email-verifier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: batch }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Failed to verify batch ${batchNum}`);
        }

        const data = await response.json();
        allResults.push(...data.results);

        // Small delay between batches to avoid rate limiting
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setProgress({
        current: emails.length,
        total: emails.length,
        message: "Verification complete!"
      });

      setResults(allResults);

      // Calculate stats
      const calculatedStats: VerificationStats = {
        total: allResults.length,
        valid: allResults.filter((r: EmailValidation) => r.status === "VALID").length,
        disposable: allResults.filter((r: EmailValidation) => r.is_disposable).length,
        invalid: allResults.filter((r: EmailValidation) => !r.syntax_valid).length,
        role_based: allResults.filter((r: EmailValidation) => r.is_role_based).length,
        errors: 0,
      };
      setStats(calculatedStats);

      // Auto-download
      if (allResults.length > 0) {
        downloadResults(allResults, `email_verification_${new Date().toISOString().split('T')[0]}.csv`);
      }

      setCsvFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify emails");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const downloadResults = (verifications: EmailValidation[], filename: string) => {
    const csv = convertToCSV(verifications);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <Link href="/">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Mail className="h-8 w-8" />
          Email Verifier
        </h1>
        <p className="text-muted-foreground">
          Validate email addresses: syntax, domain existence, MX records, and disposable detection
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={tab === "single" ? "default" : "outline"}
          onClick={() => {
            setTab("single");
            setResults([]);
            setError(null);
            setStats(null);
          }}
        >
          Single Email
        </Button>
        <Button
          variant={tab === "batch" ? "default" : "outline"}
          onClick={() => {
            setTab("batch");
            setResults([]);
            setError(null);
            setStats(null);
          }}
        >
          Batch Upload (CSV)
        </Button>
      </div>

      {/* Single Email Tab */}
      {tab === "single" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Verify Single Email</CardTitle>
            <CardDescription>Enter an email address to verify</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={verifySingleEmail} className="space-y-4">
              <div className="grid w-full gap-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={singleEmail}
                    onChange={(e) => setSingleEmail(e.target.value)}
                    disabled={loading}
                  />
                  <Button type="submit" disabled={loading || !singleEmail.trim()}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        Verify
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Batch Tab */}
      {tab === "batch" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Batch Verification</CardTitle>
            <CardDescription>
              Upload a CSV file with emails (max 100 per file). Supported columns: email, emails, e-mail, address, contact_email
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid w-full gap-2">
                <Label htmlFor="csv-file">CSV File</Label>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  disabled={loading}
                />
              </div>
              {csvFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Selected: {csvFile.name}
                </div>
              )}
              <Button
                onClick={verifyBatch}
                disabled={!csvFile || loading}
                className="w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {progress ? `${progress.current}/${progress.total}` : "Verifying..."}
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Verify Batch
                  </>
                )}
              </Button>
            </div>

            {/* Progress Indicator */}
            {progress && loading && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{progress.message}</span>
                  <span className="text-sm text-muted-foreground">
                    {progress.current} / {progress.total} emails
                  </span>
                </div>
                <div className="w-full bg-background rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Valid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.valid}</div>
              <p className="text-xs text-muted-foreground">
                {stats.total > 0 ? ((stats.valid / stats.total) * 100).toFixed(0) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Disposable
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.disposable}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Role-based
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.role_based}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Invalid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.invalid}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Verification Results ({results.length})
                </CardTitle>
                <CardDescription>
                  Click on an email to see details. Green = deliverable, Orange = caution, Red = invalid
                </CardDescription>
              </div>
              {results.length > 0 && (
                <Button
                  onClick={() =>
                    downloadResults(
                      results,
                      `email_verification_${new Date().toISOString().split('T')[0]}.csv`
                    )
                  }
                  variant="outline"
                  size="sm"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download CSV
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((validation, idx) => {
                const score = getEmailQualityScore(validation);
                const deliverable = isDeliverable(validation);
                const statusMsg = getStatusMessage(validation);

                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 ${
                      validation.status === "VALID"
                        ? "border-green-200 bg-green-50"
                        : validation.is_disposable
                        ? "border-orange-200 bg-orange-50"
                        : validation.syntax_valid
                        ? "border-yellow-200 bg-yellow-50"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-semibold break-all">{validation.email}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{statusMsg}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Badge
                          variant={deliverable ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          {score}
                        </Badge>
                        {validation.status === "VALID" && (
                          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                        )}
                        {validation.is_disposable && (
                          <AlertCircle className="h-5 w-5 text-orange-600 shrink-0" />
                        )}
                        {!validation.syntax_valid && (
                          <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                        )}
                      </div>
                    </div>

                    <Separator className="my-3" />

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Syntax</span>
                        <div className="font-medium">
                          {validation.syntax_valid ? "✓ Valid" : "✗ Invalid"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Domain</span>
                        <div className="font-medium">
                          {validation.domain_exists ? "✓ Exists" : "✗ Missing"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">MX Records</span>
                        <div className="font-medium">
                          {validation.has_mx ? "✓ Yes" : "✗ No"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Disposable</span>
                        <div className="font-medium">
                          {validation.is_disposable ? "✗ Yes" : "✓ No"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Role-based</span>
                        <div className="font-medium">
                          {validation.is_role_based ? "⚠ Yes" : "✓ No"}
                        </div>
                      </div>
                      {validation.alias_of && (
                        <div>
                          <span className="text-muted-foreground">Alias of</span>
                          <div className="font-medium text-xs break-all">
                            {validation.alias_of}
                          </div>
                        </div>
                      )}
                    </div>

                    {validation.error && (
                      <div className="mt-3 p-2 bg-red-100 rounded text-sm text-red-700">
                        Error: {validation.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {results.length === 0 && !error && !loading && (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 text-center">
            <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">
              {tab === "single"
                ? "Enter an email address and click Verify to get started"
                : "Upload a CSV file to verify multiple emails at once"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
