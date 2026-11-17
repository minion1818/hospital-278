"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveSettings, type SettingsState } from "../actions";

type Mode = "AUTO" | "MANUAL";

const MODE_LABELS: Record<Mode, { label: string; help: string }> = {
  AUTO: { label: "Automatic", help: "Rules decide each request after the response delay." },
  MANUAL: { label: "Manual review", help: "Requests are acknowledged, then wait in the inbox for you to decide." },
};

export function SettingsForm({
  initial,
}: {
  initial: { mode: Mode; ackDelaySeconds: number; responseDelaySeconds: number };
}) {
  const [state, formAction, pending] = useActionState(async (prev: SettingsState, fd: FormData) => {
    const result = await saveSettings(prev, fd);
    if (result.ok) toast.success("Payer settings saved", { description: result.message });
    return result;
  }, { ok: false, errors: {}, attempt: 0 } satisfies SettingsState);
  // Controlled, so values survive a failed save
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [ack, setAck] = useState(String(initial.ackDelaySeconds));
  const [respond, setRespond] = useState(String(initial.responseDelaySeconds));

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Decision mode</legend>
        <div role="radiogroup" aria-label="Decision mode" className="grid grid-cols-2 rounded-lg bg-muted p-0.5">
          {(["AUTO", "MANUAL"] as const).map((m) => (
            <label
              key={m}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                mode === m
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="sr-only"
              />
              {MODE_LABELS[m].label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{MODE_LABELS[mode].help}</p>
        {state.errors.mode && <p className="mt-1 text-xs font-medium text-destructive">{state.errors.mode}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <DelayField
          id="ackDelaySeconds"
          label="Acknowledge after"
          hint="Seconds until a new request moves to In review."
          value={ack}
          onChange={setAck}
          error={state.errors.ackDelaySeconds}
        />
        <DelayField
          id="responseDelaySeconds"
          label="Respond after"
          hint="Seconds from receipt to the automatic decision."
          value={respond}
          onChange={setRespond}
          error={state.errors.responseDelaySeconds}
        />
      </div>

      <div className="space-y-2 border-t pt-4">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto xl:w-full">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {pending ? "Saving…" : "Save settings"}
        </Button>
        <p className="text-xs text-muted-foreground">New delays apply to requests received after saving.</p>
        {!pending && state.message && !state.ok && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

function DelayField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={`${id}-help`}
          className="pr-10"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          sec
        </span>
      </div>
      <p id={`${id}-help`} className={cn("text-xs", error ? "font-medium text-destructive" : "text-muted-foreground")}>
        {error ?? hint}
      </p>
    </div>
  );
}
