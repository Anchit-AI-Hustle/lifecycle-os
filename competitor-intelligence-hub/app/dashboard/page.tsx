/**
 * Dashboard (PART 2). Server Component: fetches all rows from the Google Sheet
 * on load, computes headline stats, and hands the data to the interactive
 * client table (which keeps it fresh via SWR).
 */
import { Activity, Mail, Tag, Building2, AlertTriangle } from "lucide-react";
import { getAllEmails } from "@/lib/google-client";
import { EmailTable } from "@/components/email-table";
import { Card, CardContent } from "@/components/ui/card";
import type { CompetitorEmail } from "@/lib/types";

// Always render fresh — this is a live operational dashboard.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">{icon}</div>
        <div>
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  let emails: CompetitorEmail[] = [];
  let loadError: string | null = null;

  try {
    emails = await getAllEmails();
  } catch (err) {
    // Don't crash the page if the sheet/credentials aren't wired yet —
    // render an actionable setup notice instead (PART 3: graceful errors).
    loadError = (err as Error).message;
  }

  const brandCount = new Set(emails.map((e) => e.brand)).size;
  const promoCount = emails.filter(
    (e) => e.promoCodes && e.promoCodes !== "None"
  ).length;
  const last7d = emails.filter((e) => {
    const t = new Date(e.receivedAt).getTime();
    return !Number.isNaN(t) && Date.now() - t < 7 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <main className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Activity className="h-4 w-4" />
          Competitor Intelligence
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Benchmarking Hub
        </h1>
        <p className="mt-1 text-muted-foreground">
          Automated capture of competitor email campaigns — synced from the
          inbox to Google Sheets every 15 minutes.
        </p>
      </header>

      {loadError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">
                Could not load data from Google Sheets.
              </p>
              <p className="text-sm text-muted-foreground">
                Check your{" "}
                <code className="rounded bg-muted px-1">GOOGLE_*</code>{" "}
                environment variables and that the service account has Editor
                access to the sheet. Details: {loadError}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              icon={<Mail className="h-5 w-5" />}
              label="Total emails"
              value={emails.length}
            />
            <Stat
              icon={<Building2 className="h-5 w-5" />}
              label="Brands tracked"
              value={brandCount}
            />
            <Stat
              icon={<Tag className="h-5 w-5" />}
              label="With promo codes"
              value={promoCount}
            />
            <Stat
              icon={<Activity className="h-5 w-5" />}
              label="Last 7 days"
              value={last7d}
            />
          </section>

          <EmailTable initialData={emails} />
        </>
      )}
    </main>
  );
}
