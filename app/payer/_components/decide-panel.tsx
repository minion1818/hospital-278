"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decide, type DecideState } from "../actions";

type Kind = "APPROVED" | "PARTIAL" | "DENIED" | "PENDED" | "REJECTED";

const ACTIONS: { kind: Kind; label: string; confirm: string }[] = [
  { kind: "APPROVED", label: "Approve", confirm: "Approve" },
  { kind: "PARTIAL", label: "Approve part", confirm: "Approve part" },
  { kind: "DENIED", label: "Deny", confirm: "Deny" },
  { kind: "PENDED", label: "Pend", confirm: "Pend" },
  { kind: "REJECTED", label: "Reject", confirm: "Reject" },
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
  const [state, formAction, pending] = useActionState(decide, {
    ok: false,
    fieldErrors: {},
    attempt: 0,
  } satisfies DecideState);
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
            className={kind === a.kind ? "bg-emerald-700 hover:bg-emerald-800" : undefined}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {fe.kind && <p className="text-xs text-red-700">{fe.kind}</p>}

      {kind === "APPROVED" && (
        <p className="text-sm text-gray-700">
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
          <p className={`text-xs ${fe.unitsApproved ? "text-red-700" : "text-gray-500"}`}>
            {fe.unitsApproved ??
              (requestedUnits ? `1 to ${requestedUnits - 1} (${requestedUnits} requested)` : "Fewer than requested")}
          </p>
        </div>
      )}

      {kind === "REJECTED" && (
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="code">Reject reason code (AAA03)</Label>
          <select
            id="code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={!!fe.code || undefined}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Choose a code…</option>
            {rejectCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}: {c.text}
              </option>
            ))}
          </select>
          {fe.code && <p className="text-xs text-red-700">{fe.code}</p>}
        </div>
      )}

      {needsReason && (
        <div className="space-y-1.5">
          <Label htmlFor="reason">
            Reason <span className="font-normal text-gray-500">(required, sent to the hospital)</span>
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
          <p className={`text-xs ${fe.reason ? "text-red-700" : "text-gray-500"}`}>
            {fe.reason ?? `${reason.trim().length}/${REASON_MAX} characters`}
          </p>
        </div>
      )}

      {selected && (
        <Button type="submit" disabled={pending} className="bg-emerald-700 hover:bg-emerald-800">
          {pending ? "Sending…" : `Confirm: ${selected.confirm}`}
        </Button>
      )}

      {!pending && state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
