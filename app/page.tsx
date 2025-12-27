import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8">Internal Growth Tools</h1>
      <p className="text-muted-foreground mb-8">
        A collection of internal tools for lead generation and enrichment.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
      </div>
    </div>
  );
}
