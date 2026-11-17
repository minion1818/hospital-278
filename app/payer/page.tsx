import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PayerTicker } from "@/components/payer-ticker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countMessages, listMessages, type MessageFilter } from "@/lib/payer/console";
import { getSettings } from "@/lib/payer/inbox";
import { MessageStatusBadge, OutcomeBadge } from "./_components/badges";
import { SettingsForm } from "./_components/settings-form";

const FILTERS: Record<MessageFilter, string> = {
  all: "All",
  waiting: "Waiting for decision",
  responded: "Responded",
};

const parseFilter = (v: string | string[] | undefined): MessageFilter =>
  typeof v === "string" && v in FILTERS ? (v as MessageFilter) : "all";

const formatDateTime = (d: Date) =>
  d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" });

export default function PayerConsolePage({ searchParams }: PageProps<"/payer">) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Payer console</h1>
        <p className="text-sm text-gray-500">
          A simulated insurance company reviewing incoming X12 278 requests. Synthetic data only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payer settings</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Database read: request-time data behind Suspense */}
          <Suspense fallback={<p className="text-sm text-gray-500">Loading settings…</p>}>
            <SettingsLoader />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
        </CardHeader>
        <CardContent>
          {/* searchParams and the database read are request-time data */}
          <Suspense fallback={<p className="text-sm text-gray-500">Loading messages…</p>}>
            <Inbox searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function SettingsLoader() {
  // Request-time data: stop prerendering here explicitly before touching the database
  await connection();
  const s = await getSettings();
  return (
    <SettingsForm
      initial={{ mode: s.mode, ackDelaySeconds: s.ackDelaySeconds, responseDelaySeconds: s.responseDelaySeconds }}
    />
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

      <nav aria-label="Filter messages" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as MessageFilter[]).map((key) => {
          const active = key === filter;
          return (
            <Link
              key={key}
              href={key === "all" ? "/payer" : `/payer?view=${key}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                active
                  ? "border-emerald-800 bg-emerald-800 text-white"
                  : "border-emerald-200 text-gray-700 hover:bg-emerald-50"
              }`}
            >
              {FILTERS[key]}
              <span className={`ml-1.5 ${active ? "text-emerald-200" : "text-gray-400"}`}>{counts[key]}</span>
            </Link>
          );
        })}
      </nav>

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
          No messages in this view. Approve a request on the hospital side to send one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Member ID</TableHead>
                <TableHead>Procedure</TableHead>
                <TableHead>Units</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id} className="hover:bg-emerald-50/60">
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/payer/${m.id}`} className="text-emerald-800 hover:underline">
                      {formatDateTime(m.receivedAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/payer/${m.id}`} className="hover:underline">
                      {m.summary?.patientName ?? "Unreadable request"}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.summary?.memberId ?? "—"}</TableCell>
                  <TableCell>
                    {m.summary?.procedureCode ?? "—"}
                    {m.summary?.procedureLabel && (
                      <span className="ml-1 text-gray-500">{m.summary.procedureLabel}</span>
                    )}
                  </TableCell>
                  <TableCell>{m.summary?.units ?? "—"}</TableCell>
                  <TableCell>
                    <MessageStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={m.outcome} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
