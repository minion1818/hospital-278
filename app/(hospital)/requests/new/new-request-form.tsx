"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DIAGNOSES, PROCEDURES, PROVIDERS, findProcedure } from "@/lib/catalog";
import {
  EMPTY_NEW_REQUEST_VALUES,
  type NewRequestField,
  type NewRequestValues,
} from "@/lib/validation/request";
import { createDraftRequest, type NewRequestState } from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PatientOption = { value: string; label: string };
type Option = { value: string; label: string };

const PROVIDER_OPTIONS: Option[] = PROVIDERS.map((p) => ({
  value: p.npi,
  label: `${p.name} (NPI ${p.npi})`,
}));
const DIAGNOSIS_OPTIONS: Option[] = DIAGNOSES.map((d) => ({
  value: d.code,
  label: `${d.code} · ${d.label}`,
}));
const PROCEDURE_OPTIONS: Option[] = PROCEDURES.map((p) => ({
  value: p.code,
  label: `${p.code} · ${p.label}`,
}));

const initialState: NewRequestState = {
  values: EMPTY_NEW_REQUEST_VALUES,
  errors: {},
  attempt: 0,
};

export function NewRequestForm({
  patients,
  minServiceDate,
}: {
  patients: PatientOption[];
  minServiceDate: string;
}) {
  const [state, formAction, pending] = useActionState(async (prev: NewRequestState, fd: FormData) => {
    try {
      return await createDraftRequest(prev, fd);
    } catch (e) {
      // On success the action redirects to the new request. Next signals that by
      // throwing its redirect error, which must be rethrown for the navigation.
      if (isRedirect(e)) toast.success("Draft saved", { description: "Review it, then submit it for review." });
      throw e;
    }
  }, initialState);

  return (
    // The key remounts the fields after each failed submit, so their default
    // values come from what the server echoed back instead of being reset.
    <form action={formAction} key={state.attempt} noValidate>
      <Card className="overflow-visible">
        <CardContent>
          {state.message && (
            <p
              role="alert"
              className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-600/20"
            >
              {state.message}
            </p>
          )}
          <FormFields state={state} patients={patients} minServiceDate={minServiceDate} />
        </CardContent>
        <CardFooter className="sticky bottom-0 z-10 flex-wrap justify-between gap-3 rounded-b-xl bg-card/95 backdrop-blur">
          <p className="text-xs text-muted-foreground">Saved as a draft. Nothing is sent to the payer until a reviewer approves it.</p>
          <div className="flex gap-2">
            <Link href="/requests" className={buttonVariants({ variant: "outline" })}>
              Cancel
            </Link>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {pending ? "Saving…" : "Save as draft"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}

function FormFields({
  state,
  patients,
  minServiceDate,
}: {
  state: NewRequestState;
  patients: PatientOption[];
  minServiceDate: string;
}) {
  const { values, errors } = state;
  // Tracked only to show the unit limit hint for the chosen procedure
  const [procedureCode, setProcedureCode] = useState(values.procedureCode);
  const maxUnits = findProcedure(procedureCode)?.maxUnits;

  const err = (f: NewRequestField) => errors[f]?.[0];

  return (
    <div className="divide-y">
      <Section title="Patient" description="Who the service is for. Coverage details come from the patient record.">
        <Field id="patientId" label="Patient" error={err("patientId")} className="md:col-span-2">
          <SelectField
            name="patientId"
            items={patients}
            values={values}
            placeholder={patients.length ? "Select a patient" : "No patients found"}
            invalid={!!err("patientId")}
          />
        </Field>
      </Section>

      <Section title="Provider and service" description="The ordering provider and what they are requesting.">
        <Field id="providerNpi" label="Requesting provider" error={err("providerNpi")}>
          <SelectField
            name="providerNpi"
            items={PROVIDER_OPTIONS}
            values={values}
            placeholder="Select a provider"
            invalid={!!err("providerNpi")}
          />
        </Field>

        <Field id="diagnosisCode" label="Diagnosis (ICD-10)" error={err("diagnosisCode")}>
          <SelectField
            name="diagnosisCode"
            items={DIAGNOSIS_OPTIONS}
            values={values}
            placeholder="Select a diagnosis"
            invalid={!!err("diagnosisCode")}
          />
        </Field>

        <Field id="procedureCode" label="Procedure (CPT)" error={err("procedureCode")}>
          <SelectField
            name="procedureCode"
            items={PROCEDURE_OPTIONS}
            values={values}
            placeholder="Select a procedure"
            invalid={!!err("procedureCode")}
            onChange={setProcedureCode}
          />
        </Field>

        <Field id="serviceDate" label="Service date" error={err("serviceDate")} hint="Today or later.">
          <Input
            id="serviceDate"
            name="serviceDate"
            type="date"
            min={minServiceDate}
            defaultValue={values.serviceDate}
            aria-invalid={!!err("serviceDate") || undefined}
            aria-describedby={err("serviceDate") ? "serviceDate-error" : "serviceDate-hint"}
          />
        </Field>

        <Field
          id="unitsRequested"
          label="Units requested"
          error={err("unitsRequested")}
          hint={
            maxUnits
              ? `Up to ${maxUnits} unit${maxUnits === 1 ? "" : "s"} for this procedure.`
              : "Between 1 and 99."
          }
        >
          <Input
            id="unitsRequested"
            name="unitsRequested"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxUnits ?? 99}
            step={1}
            defaultValue={values.unitsRequested}
            aria-invalid={!!err("unitsRequested") || undefined}
            aria-describedby={err("unitsRequested") ? "unitsRequested-error" : "unitsRequested-hint"}
          />
        </Field>
      </Section>

      <Section
        title="Clinical documentation"
        description="Payers usually ask for clinical notes, and for evidence that conservative treatment was tried first."
      >
        <div className="space-y-4 md:col-span-2">
          <CheckboxField
            name="clinicalNotesAttached"
            label="Clinical notes attached"
            hint="Documentation will be sent with this request."
            defaultChecked={values.clinicalNotesAttached === "true"}
          />
          <CheckboxField
            name="conservativeTreatmentTried"
            label="Conservative treatment tried"
            hint="For example physical therapy, medication or injections, documented in the notes."
            defaultChecked={values.conservativeTreatmentTried === "true"}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 py-6 first:pt-2 last:pb-2 lg:grid-cols-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:col-span-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SelectField({
  name,
  items,
  values,
  placeholder,
  invalid,
  onChange,
}: {
  name: NewRequestField;
  items: Option[];
  values: NewRequestValues;
  placeholder: string;
  invalid: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <Select
      name={name}
      items={items}
      defaultValue={values[name] || null}
      onValueChange={(v) => onChange?.(typeof v === "string" ? v : "")}
    >
      <SelectTrigger
        id={name}
        className="w-full"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${name}-error` : undefined}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: NewRequestField;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={name}
        name={name}
        value="true"
        uncheckedValue="false"
        defaultChecked={defaultChecked}
        aria-describedby={`${name}-hint`}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <Label htmlFor={name}>{label}</Label>
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}

/** Next signals a successful redirect() from a Server Action by throwing this error. */
function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
