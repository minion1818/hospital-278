"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const initialState: TransitionState = { ok: false, attempt: 0 };

export function ActionsPanel({
  requestId,
  transitions,
}: {
  requestId: string;
  transitions: TransitionOption[];
}) {
  const [state, formAction, pending] = useActionState(runTransition, initialState);
  // Which note-required action is currently showing its note box
  const [noteFor, setNoteFor] = useState<TransitionKey | null>(null);
  const [note, setNote] = useState("");

  const noteTransition = transitions.find((t) => t.key === noteFor);

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {transitions.map((t) => (
          <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t.noteRequired ? (
              <Button
                type="button"
                variant={noteFor === t.key ? "secondary" : "outline"}
                disabled={pending}
                onClick={() => setNoteFor(noteFor === t.key ? null : t.key)}
                aria-expanded={noteFor === t.key}
              >
                {t.label}…
              </Button>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="requestId" value={requestId} />
                <input type="hidden" name="action" value={t.key} />
                <Button type="submit" disabled={pending}>
                  {t.label}
                </Button>
              </form>
            )}
            <span className="text-sm text-gray-500">{t.description}</span>
          </li>
        ))}
      </ul>

      {noteTransition && (
        // The typed note survives a failed attempt (controlled state). After a
        // success the page keys this panel by status, which remounts and clears it.
        <form action={formAction} className="space-y-2 rounded-lg border bg-gray-50 p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="action" value={noteTransition.key} />
          <Label htmlFor="transition-note">
            {noteTransition.notePrompt ?? "Note"}{" "}
            <span className="font-normal text-gray-500">(required)</span>
          </Label>
          <Textarea
            id="transition-note"
            name="note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || note.trim() === ""}>
              {pending ? "Saving…" : `Confirm: ${noteTransition.label.toLowerCase()}`}
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

      {pending && <p className="text-sm text-gray-500">Applying…</p>}
      {!pending && state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
    </div>
  );
}
