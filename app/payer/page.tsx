import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PayerTicker } from "@/components/payer-ticker";
import { PageContainer, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ClickableRow, DataTable } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { CardSkeleton, TableSkeleton, ToolbarSkeleton } from "@/components/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBody, TableCell, TableHead } from "@/components/ui/table";
import { countMessages, listMessages, type MessageFilter } from "@/lib/payer/console";
import { getSettings } from "@/lib/payer/inbox";
import { cn } from "@/lib/utils";
import { MessageStatusBadge, OutcomeBadge } from "./_components/badges";
import { SettingsForm } from "./_components/settings-form";

export const metadata: Metadata = { title: { absolute: "Inbox | Payer simulator" } };

const FILTERS: Record<MessageFilter, string> = {
  all: "All",
  waiting: "Waiting for decision",
  responded: "Responded",
};

const parseFilter = (v: string | string[] | undefined): MessageFilter =>
  typeof v === "string" && v in FILTERS ? (v as MessageFilter) : "all";

export default function PayerConsolePage({ searchParams }: PageProps<"/payer">) {
  return (
    <PageContainer>
      <PageHeader
        title="Payer simulator"
        subtitle="Acts as the insurance company so you can see the full prior authorization loop."
      />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <section aria-labelledby="inbox-title" className="min-w-0 xl:order-1">
          <h2 id="inbox-title" className="mb-3 text-base font-semibold">
            Incoming 278 requests
          </h2>
          {/* searchParams and the database read are request-time data */}
          <Suspense
            fallback={
              <>
                <ToolbarSkeleton />
                <TableSkeleton label="Loading messages" />
              </>
            }
          >
            <Inbox searchParams={searchParams} />
          </Suspense>
        </section>

        <div className="xl:order-2">
          {/* Database read: request-time data behind Suspense */}
          <Suspense fallback={<CardSkeleton lines={4} />}>
            <SettingsLoader />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}

async function SettingsLoader() {
  // Request-time data: stop prerendering here explicitly before touching the database
  await connection();
  const s = await getSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payer settings</CardTitle>
        <CardDescription>How this payer handles new requests.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsForm
          initial={{ mode: s.mode, ackDelaySeconds: s.ackDelaySeconds, responseDelaySeconds: s.responseDelaySeconds }}
        />
      </CardContent>
    </Card>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/payer">["searchParams"] }) {
  const filter = parseFilter((await searchParams).view);
  const [messages, counts] = await Promise.all([listMessages(filter), countMessages()]);

  // Poll while anything still needs a decision or delivery (across all messages)
  const all = filter === "all" ? messages : await listMessages("all");
  const open = all.filter((m) => m.status !== "RESPONDED" || !m.deliveredAt);

  return (
    <>
      <PayerTicker
        key={open.map((m) => `${m.id}:${m.status}`).join(",")}
        active={open.length > 0}
        watch="payer"
        label="Processing messages…"
      />

      <nav aria-label="Filter messages" className="mb-4 flex w-fit flex-wrap rounded-lg bg-muted p-0.5">
        {(Object.keys(FILTERS) as MessageFilter[]).map((key) => {
          const active = key === filter;
          return (
            <Link
              key={key}
              href={key === "all" ? "/payer" : `/payer?view=${key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTERS[key]}
              <span className={cn("text-xs tabular-nums", active ? "text-primary" : "text-muted-foreground")}>
                {counts[key]}
              </span>
            </Link>
          );
        })}
      </nav>

      {messages.length === 0 ? (
        <EmptyState
          title={filter === "waiting" ? "Nothing waiting for a decision" : "No requests received yet"}
          description="Requests appear here when the hospital approves and sends a prior authorization."
        />
      ) : (
        <DataTable
          label="Incoming 278 requests"
          head={
            <>
              <TableHead>Patient</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
            </>
          }
        >
          <TableBody>
            {messages.map((m) => {
              const href = `/payer/${m.id}`;
              return (
                <ClickableRow key={m.id} href={href}>
                  <TableCell>
                    <Link href={href} className="font-medium text-foreground hover:text-primary hover:underline">
                      {m.summary?.patientName ?? "Unreadable request"}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{m.summary?.memberId ?? "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div>{m.summary?.procedureLabel ?? "Procedure"}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {m.summary?.procedureCode ? `CPT ${m.summary.procedureCode}` : "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.summary?.units ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <DateTime value={m.receivedAt} />
                  </TableCell>
                  <TableCell>
                    <MessageStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={m.outcome} />
                  </TableCell>
                </ClickableRow>
              );
            })}
          </TableBody>
        </DataTable>
      )}
    </>
  );
}
