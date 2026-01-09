import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <svg width="48" height="48" viewBox="0 0 212 212" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M26 80.4C26 61.3582 26 51.8373 29.7058 44.5643C32.9655 38.1668 38.1668 32.9655 44.5643 29.7058C51.8373 26 61.3582 26 80.4 26H131.6C150.642 26 160.163 26 167.436 29.7058C173.833 32.9655 179.035 38.1668 182.294 44.5643C186 51.8373 186 61.3582 186 80.4V131.6C186 150.642 186 160.163 182.294 167.436C179.035 173.833 173.833 179.035 167.436 182.294C160.163 186 150.642 186 131.6 186H80.4C61.3582 186 51.8373 186 44.5643 182.294C38.1668 179.035 32.9655 173.833 29.7058 167.436C26 160.163 26 150.642 26 131.6V80.4Z" fill="#37E278" fillOpacity="0.85"/>
          <path d="M26 80.4C26 61.3582 26 51.8373 29.7058 44.5643C32.9655 38.1668 38.1668 32.9655 44.5643 29.7058C51.8373 26 61.3582 26 80.4 26H131.6C150.642 26 160.163 26 167.436 29.7058C173.833 32.9655 179.035 38.1668 182.294 44.5643C186 51.8373 186 61.3582 186 80.4V131.6C186 150.642 186 160.163 182.294 167.436C179.035 173.833 173.833 179.035 167.436 182.294C160.163 186 150.642 186 131.6 186H80.4C61.3582 186 51.8373 186 44.5643 182.294C38.1668 179.035 32.9655 173.833 29.7058 167.436C26 160.163 26 150.642 26 131.6V80.4Z" fill="#F5F5F5" fillOpacity="0.35"/>
          <rect x="26" y="26" width="160" height="160" rx="34" fill="black" fillOpacity="0.01"/>
        </svg>
        <h1 className="text-4xl font-bold">Mythrilite Internal Tools</h1>
      </div>
      <p className="text-muted-foreground mb-8">
        A collection of internal tools for lead generation and enrichment.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Growth Dashboard</CardTitle>
            <CardDescription>
              Track all cold/warm outbound campaigns across Email, LinkedIn, and Twitter
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/growth-dashboard">
              <Button className="w-full">Open Tool</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Twitter Lead Verifier</CardTitle>
            <CardDescription>
              Filter and verify Twitter leads based on ICP criteria using two-stage filtering
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/twitter-verifier">
              <Button className="w-full">Open Tool</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LinkedIn Enricher</CardTitle>
            <CardDescription>
              Extract leads from LinkedIn post reactions and enrich with contact data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/linkedin-enricher">
              <Button className="w-full">Open Tool</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pipeline Monitor
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-normal">
                Automated
              </span>
            </CardTitle>
            <CardDescription>
              Monitor the daily autonomous lead generation pipeline (LinkedIn jobs → Campaigns)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pipeline-monitor">
              <Button className="w-full" variant="default">Open Monitor</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
