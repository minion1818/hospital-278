"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActingUser } from "@/lib/demo-session";
import { TRANSITION_KEYS } from "@/lib/workflow";
import { applyTransition } from "@/lib/workflow-db";

export type TransitionState = { ok: boolean; error?: string; attempt: number };

const inputSchema = z.object({
  requestId: z.string().trim().min(1, { error: "Missing request id." }),
  action: z.enum(TRANSITION_KEYS, { error: "Unknown action." }),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.string().max(1000, { error: "Keep the note under 1,000 characters." }).optional(),
  ),
});

export async function runTransition(
  prev: TransitionState,
  formData: FormData,
): Promise<TransitionState> {
  const attempt = prev.attempt + 1;

  const parsed = inputSchema.safeParse({
    requestId: formData.get("requestId"),
    action: formData.get("action"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input.", attempt };
  }
  const { requestId, action, note } = parsed.data;

  // Demo stand-in for real authentication: the role comes from a cookie
  const actor = await getActingUser();
  if (!actor) {
    return { ok: false, error: "Demo users not found. Run `npx prisma db seed`.", attempt };
  }

  // Role, current-status and note checks all happen inside the transaction
  const result = await applyTransition(db, { requestId, key: action, actor, note });

  // Revalidate on failure too, so a stale page picks up the real status
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);

  return result.ok ? { ok: true, attempt } : { ok: false, error: result.error, attempt };
}
