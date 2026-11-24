"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TransitionKey } from "@/lib/workflow";
import { runTransition, type TransitionState } from "./actions";

/** Serializable subset of a Transition, passed from the server component. */
export type TransitionOption = {
  key: TransitionKey;
  label: string;
  description: string;
  noteRequired: boolean;
  notePrompt?: string;
};

// Presentation per action: button style, success toast, and a confirm step for
// the ones that can't be undone.
const UI: Record<
  TransitionKey,
  { variant: "default" | "outline"; success: string; confirm?: { title: string; body: string; button: string } }
> = {
  SUBMIT_FOR_REVIEW: { variant: "default", success: "Submitted for review" },
  APPROVE_AND_SEND: {
    variant: "default",
    success: "Request sent to payer",
    confirm: {
      title: "Send this request to the payer?",
      body: "A 278 request will be generated and sent to the payer. The payer reviews it and, if it approves, issues the authorization number. Once sent, it can't be recalled.",
      button: "Send to payer",
    },
  },
  SEND_BACK: { variant: "outline", success: "Sent back to staff" },
  REOPEN_AS_DRAFT: { variant: "outline", success: "Reopened as draft" },
  MARK_SERVICE_COMPLETED: {
    variant: "default",
    success: "Marked as service completed",
    confirm: {
      title: "Mark the service as completed?",
      body: "This closes the request. No further actions will be available.",
      button: "Mark completed",
    },
  },
};

const initialState: TransitionState = { ok: false, attempt: 0 };

export function ActionsPanel({ requestId, transitions }: { requestId: string; transitions: TransitionOption[] }) {
  // Which action is running (for its spinner) and which one is awaiting confirmation
  const [activeKey, setActiveKey] = useState<TransitionKey | null>(null);
  const [confirmKey, setConfirmKey] = useState<TransitionKey | null>(null);

  const [state, formAction, pending] = useActionState(async (prev: TransitionState, fd: FormData) => {
    const key = fd.get("action") as TransitionKey;
    const result = await runTransition(prev, fd);
    // Toast from here (not an effect): on success the page remounts this panel
    if (result.ok && !result.error) toast.success(UI[key]?.success ?? "Saved");
    if (result.ok && result.error) toast.warning(result.error);
    setConfirmKey(null);
    return result;
  }, initialState);

  // Which note-required action is currently showing its note box
  const [noteFor, setNoteFor] = useState<TransitionKey | null>(null);
  const [note, setNote] = useState("");

  const noteTransition = transitions.find((t) => t.key === noteFor);
  const confirmTransition = transitions.find((t) => t.key === confirmKey);
  // Primary actions first, so the main next step is always on top
  const ordered = [...transitions].sort(
    (a, b) => Number(UI[a.key].variant !== "default") - Number(UI[b.key].variant !== "default"),
  );

  const spinner = (key: TransitionKey) =>
    pending && activeKey === key ? <Loader2 aria-hidden className="animate-spin" /> : null;

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {ordered.map((t) => {
          const ui = UI[t.key];
          return (
            <li key={t.key} className="space-y-1">
              {t.noteRequired ? (
                <Button
                  type="button"
                  variant={noteFor === t.key ? "secondary" : ui.variant}
                  className="w-full"
                  disabled={pending}
                  onClick={() => setNoteFor(noteFor === t.key ? null : t.key)}
                  aria-expanded={noteFor === t.key}
                >
                  {t.label}…
                </Button>
              ) : ui.confirm ? (
                <Button
                  type="button"
                  variant={ui.variant}
                  className="w-full"
                  disabled={pending}
                  onClick={() => setConfirmKey(t.key)}
                >
                  {spinner(t.key)}
                  {t.label}
                </Button>
              ) : (
                <form action={formAction} onSubmit={() => setActiveKey(t.key)}>
                  <input type="hidden" name="requestId" value={requestId} />
                  <input type="hidden" name="action" value={t.key} />
                  <Button type="submit" variant={ui.variant} className="w-full" disabled={pending}>
                    {spinner(t.key)}
                    {pending && activeKey === t.key ? "Working…" : t.label}
                  </Button>
                </form>
              )}
              <p className="text-xs text-muted-foreground">{t.description}</p>
            </li>
          );
        })}
      </ul>

      {noteTransition && (
        // The typed note survives a failed attempt (controlled state). After a
        // success the page keys this panel by status, which remounts and clears it.
        <form
          action={formAction}
          onSubmit={() => setActiveKey(noteTransition.key)}
          className="space-y-2 rounded-lg border bg-muted/50 p-3"
        >
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="action" value={noteTransition.key} />
          <Label htmlFor="transition-note">
            {noteTransition.notePrompt ?? "Note"} <span className="font-normal text-muted-foreground">(required)</span>
          </Label>
          <Textarea
            id="transition-note"
            name="note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="bg-card"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || note.trim() === ""}>
              {spinner(noteTransition.key)}
              {pending ? "Saving…" : noteTransition.label}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setNoteFor(null);
                setNote("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!pending && state.error && !state.ok && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-600/20">
          {state.error}
        </p>
      )}

      <Dialog open={confirmTransition !== undefined} onOpenChange={(open) => !open && !pending && setConfirmKey(null)}>
        {confirmTransition && (
          <DialogContent showCloseButton={!pending}>
            <form action={formAction} onSubmit={() => setActiveKey(confirmTransition.key)} className="grid gap-4">
              <input type="hidden" name="requestId" value={requestId} />
              <input type="hidden" name="action" value={confirmTransition.key} />
              <DialogHeader>
                <DialogTitle>{UI[confirmTransition.key].confirm?.title}</DialogTitle>
                <DialogDescription>{UI[confirmTransition.key].confirm?.body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
                <Button type="submit" disabled={pending}>
                  {spinner(confirmTransition.key)}
                  {pending ? "Working…" : UI[confirmTransition.key].confirm?.button}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
