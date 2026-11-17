"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decide, type DecideState } from "../actions";

type Kind = "APPROVED" | "PARTIAL" | "DENIED" | "PENDED" | "REJECTED";

const ACTIONS: { kind: Kind; label: string; confirm: string; toast: string }[] = [
  { kind: "APPROVED", label: "Approve", confirm: "Send approval", toast: "Approval sent" },
  { kind: "PARTIAL", label: "Partially approve", confirm: "Send partial approval", toast: "Partial approval sent" },
  { kind: "PENDED", label: "Pend", confirm: "Send pend", toast: "Pend sent" },
  { kind: "DENIED", label: "Deny", confirm: "Send denial", toast: "Denial sent" },
  { kind: "REJECTED", label: "Reject", confirm: "Send rejection", toast: "Rejection sent" },
];

const REASON_MAX = 200;

export function DecidePanel({
  messageId,
  requestedUnits,
  rejectCodes,
}: {
  messageId: string;
  requestedUnits?: number;
  rejectCodes: { code: string; text: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: DecideState, fd: FormData) => {
      const result = await decide(prev, fd);
      // Toast from here (not an effect): on success the page replaces this panel
      if (result.ok) {
        const a = ACTIONS.find((x) => x.kind === fd.get("kind"));
        toast.success(a?.toast ?? "Decision sent", { description: "The hospital receives it on the next update." });
      }
      return result;
    },
    { ok: false, fieldErrors: {}, attempt: 0 } satisfies DecideState,
  );
  // Controlled: inputs survive a failed attempt
  const [kind, setKind] = useState<Kind | null>(null);
  const [units, setUnits] = useState(requestedUnits && requestedUnits > 1 ? String(requestedUnits - 1) : "1");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");

  const needsReason = kind !== null && kind !== "APPROVED";
  const fe = state.fieldErrors;
  const selected = ACTIONS.find((a) => a.kind === kind);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="messageId" value={messageId} />
      {kind && <input type="hidden" name="kind" value={kind} />}

      <div role="group" aria-label="Decision" className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.kind}
            type="button"
            variant={kind === a.kind ? "default" : "outline"}
            disabled={pending}
            aria-pressed={kind === a.kind}
            onClick={() => setKind(a.kind)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {fe.kind && <p className="text-xs font-medium text-destructive">{fe.kind}</p>}

      {kind === "APPROVED" && (
        <p className="text-sm text-foreground">
          Approves all {requestedUnits ?? "requested"} unit{requestedUnits === 1 ? "" : "s"} as requested and issues an
          authorization number.
        </p>
      )}

      {kind === "PARTIAL" && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="unitsApproved">Units to approve</Label>
          <Input
            id="unitsApproved"
            name="unitsApproved"
            type="number"
            inputMode="numeric"
            min={1}
            max={requestedUnits ? requestedUnits - 1 : undefined}
            step={1}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            aria-invalid={!!fe.unitsApproved || undefined}
          />
          <p className={`text-xs ${fe.unitsApproved ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {fe.unitsApproved ??
              (requestedUnits ? `1 to ${requestedUnits - 1} (${requestedUnits} requested)` : "Fewer than requested")}
          </p>
        </div>
      )}

      {kind === "REJECTED" && (
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="code">Reject reason (AAA03 code)</Label>
          <select
            id="code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={!!fe.code || undefined}
            className="h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          >
            <option value="">Choose a code…</option>
            {rejectCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}: {c.text}
              </option>
            ))}
          </select>
          {fe.code && <p className="text-xs font-medium text-destructive">{fe.code}</p>}
        </div>
      )}

      {needsReason && (
        <div className="space-y-1.5">
          <Label htmlFor="reason">
            Reason <span className="font-normal text-muted-foreground">(required, sent to the hospital)</span>
          </Label>
          <Textarea
            id="reason"
            name="reason"
            rows={3}
            maxLength={REASON_MAX + 50}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={!!fe.reason || undefined}
          />
          <p className={`text-xs ${fe.reason ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {fe.reason ?? `${reason.trim().length}/${REASON_MAX} characters`}
          </p>
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="submit" disabled={pending} variant={kind === "DENIED" ? "destructive" : "default"}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {pending ? "Sending…" : selected.confirm}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setKind(null)}>
            Cancel
          </Button>
        </div>
      )}

      {!pending && state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-600/20">
          {state.error}
        </p>
      )}
    </form>
  );
}
