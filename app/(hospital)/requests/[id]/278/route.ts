import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionRole } from "@/lib/session";

// Downloads the stored X12 278 request as a .edi file. Runs at request time:
// there's no generateStaticParams, so nothing here is prerendered.
export async function GET(_req: NextRequest, ctx: RouteContext<"/requests/[id]/278">) {
  // Re-check the sign-in here too (the proxy is only an optimistic check)
  if (!(await getSessionRole())) {
    return new Response("Sign in to download EDI files.\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const { id } = await ctx.params;
  const request = await db.priorAuthRequest.findUnique({
    where: { id },
    select: { raw278Request: true, controlNumber: true },
  });

  if (!request?.raw278Request) {
    return new Response("No 278 request has been generated for this request.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(request.raw278Request, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="278_request_${request.controlNumber}.edi"`,
      "Cache-Control": "no-store",
    },
  });
}
