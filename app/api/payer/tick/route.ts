import { db } from "@/lib/db";
import { tick } from "@/lib/integration/tick";

// DEMO STAND-IN FOR A BACKGROUND WORKER.
// In a real system the payer's processing and the delivery of its 278 response
// would run on their own (a queue worker, cron, or the payer calling a webhook).
// Here the browser pokes this endpoint while a request is waiting on the payer.
//
// POST handlers always run at request time (only GET handlers can be
// prerendered under Cache Components), so no route config is needed.
export async function POST() {
  const result = await tick(new Date());
  const pending = await db.priorAuthRequest.count({
    where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } },
  });

  if (result.errors.length > 0) console.error("[payer tick]", result.errors);

  return Response.json(
    {
      acknowledged: result.acknowledged,
      responded: result.responded,
      pending,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
