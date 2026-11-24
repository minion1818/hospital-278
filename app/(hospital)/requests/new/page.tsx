import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";
import { db } from "@/lib/db";
import { todayIsoDate } from "@/lib/validation/request";
import { PageContainer, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ROLE_TITLES, canCreateRequests } from "@/lib/auth/roles";
import { requireRole } from "@/lib/session";
import { FormSkeleton } from "@/components/skeletons";
import { NewRequestForm, type PatientOption } from "./new-request-form";

export const metadata: Metadata = { title: "New request" };

export default function NewRequestPage() {
  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: "New request" }]}
        title="New prior authorization request"
        subtitle="Capture the request details. A reviewer checks it before it is sent to the payer."
      />
      <div className="max-w-5xl">
        <Suspense fallback={<FormSkeleton />}>
          <NewRequestFormLoader />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function NewRequestFormLoader() {
  // Server-side role gate (the action checks again): only the Authorization
  // Specialist creates requests
  const role = await requireRole();
  if (!canCreateRequests(role)) {
    return (
      <EmptyState
        icon={ShieldX}
        title="You don't have access to this page"
        description={`New requests are created by the ${ROLE_TITLES.STAFF}. You're signed in as the ${ROLE_TITLES[role]}.`}
        action={
          <Link href="/requests?view=review" className={buttonVariants({ variant: "outline" })}>
            Go to review queue
          </Link>
        }
      />
    );
  }

  const patients = await db.patient.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const options: PatientOption[] = patients.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName} · ${p.memberId} · ${p.payerName}`,
  }));

  // Computed at request time (after the DB read), never in the prerendered shell
  return <NewRequestForm patients={options} minServiceDate={todayIsoDate()} />;
}
