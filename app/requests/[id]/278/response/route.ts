import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

// Downloads the payer's X12 278 response as a .edi file. Runs at request time:
// there's no generateStaticParams, so nothing here is prerendered.
export async function GET(_req: NextRequest, ctx: RouteContext<"/requests/[id]/278/response">) {
  const { id } = await ctx.params;
  const request = await db.priorAuthRequest.findUnique({
    where: { id },
    select: { raw278Response: true, controlNumber: true },
  });

  if (!request?.raw278Response) {
    return new Response("No 278 response has been received for this request.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Named after the request's control number so request/response files pair up
  return new Response(request.raw278Response, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="278_response_${request.controlNumber}.edi"`,
      "Cache-Control": "no-store",
    },
  });
}
