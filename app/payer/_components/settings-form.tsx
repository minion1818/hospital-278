"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSettings, type SettingsState } from "../actions";

type Mode = "AUTO" | "MANUAL";

export function SettingsForm({
  initial,
}: {
  initial: { mode: Mode; ackDelaySeconds: number; responseDelaySeconds: number };
}) {
  const [state, formAction, pending] = useActionState(saveSettings, {
    ok: false,
    errors: {},
    attempt: 0,
  } satisfies SettingsState);
  // Controlled, so values survive a failed save
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [ack, setAck] = useState(String(initial.ackDelaySeconds));
  const [respond, setRespond] = useState(String(initial.responseDelaySeconds));

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Mode</legend>
        <div role="radiogroup" className="inline-flex rounded-lg border border-emerald-200 bg-white p-0.5">
          {(["AUTO", "MANUAL"] as const).map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                mode === m ? "bg-emerald-700 text-white" : "text-gray-700 hover:bg-emerald-50"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="sr-only"
              />
              {m === "AUTO" ? "AUTO" : "MANUAL"}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          {mode === "AUTO"
            ? "Rules decide each request automatically after the response delay."
            : "Requests are acknowledged, then wait in the inbox for you to decide."}
        </p>
        {state.errors.mode && <p className="mt-1 text-xs text-red-700">{state.errors.mode}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <DelayField
          id="ackDelaySeconds"
          label="Acknowledge after (seconds)"
          hint="RECEIVED to IN_REVIEW"
          value={ack}
          onChange={setAck}
          error={state.errors.ackDelaySeconds}
        />
        <DelayField
          id="responseDelaySeconds"
          label="Respond after (seconds, AUTO)"
          hint="Time from receipt to the rules' decision"
          value={respond}
          onChange={setRespond}
          error={state.errors.responseDelaySeconds}
        />
      </div>
      <p className="text-xs text-gray-500">New delays apply to requests received after saving.</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="bg-emerald-700 hover:bg-emerald-800">
          {pending ? "Saving…" : "Save"}
        </Button>
        {!pending && state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-emerald-800" : "text-red-700"}`}>
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
      />
      <p id={`${id}-help`} className={`text-xs ${error ? "text-red-700" : "text-gray-500"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}
