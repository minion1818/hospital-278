"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ManualDecisionError, decideManually } from "@/lib/payer/console";
import { settingsSchema, updateSettings } from "@/lib/payer/inbox";

// SIMULATED PAYER console actions. No authentication: this is a demo stand-in
// for an insurer's internal review tool.

export type SettingsState = {
  ok: boolean;
  message?: string;
  errors: Partial<Record<"mode" | "ackDelaySeconds" | "responseDelaySeconds", string>>;
  attempt: number;
};

export async function saveSettings(prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const attempt = prev.attempt + 1;
  const parsed = settingsSchema.safeParse({
    mode: formData.get("mode"),
    ackDelaySeconds: formData.get("ackDelaySeconds"),
    responseDelaySeconds: formData.get("responseDelaySeconds"),
  });
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      errors: {
        mode: fe.mode?.[0],
        ackDelaySeconds: fe.ackDelaySeconds?.[0],
        responseDelaySeconds: fe.responseDelaySeconds?.[0],
      },
      attempt,
    };
  }
  await updateSettings(parsed.data);
  revalidatePath("/payer");
  return { ok: true, message: `Saved. Payer is now in ${parsed.data.mode} mode.`, errors: {}, attempt };
}

export type DecideState = {
  ok: boolean;
  error?: string;
  fieldErrors: Partial<Record<"kind" | "unitsApproved" | "reason" | "code", string>>;
  attempt: number;
};

export async function decide(prev: DecideState, formData: FormData): Promise<DecideState> {
  const attempt = prev.attempt + 1;
  const messageId = String(formData.get("messageId") ?? "");
  const input = {
    kind: formData.get("kind"),
    unitsApproved: formData.get("unitsApproved") ?? undefined,
    reason: formData.get("reason") ?? undefined,
    code: formData.get("code") ?? undefined,
  };

  try {
    await decideManually(messageId, input, new Date());
  } catch (e) {
    if (e instanceof ManualDecisionError) {
      revalidatePath(`/payer/${messageId}`); // e.g. "already responded": show the real state
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors, attempt };
    }
    throw e;
  }

  // Delivery to the hospital happens on the next tick (the page's poller runs it)
  revalidatePath("/payer");
  revalidatePath(`/payer/${messageId}`);
  return { ok: true, fieldErrors: {}, attempt };
}
