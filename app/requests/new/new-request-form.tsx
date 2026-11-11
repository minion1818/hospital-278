"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { DIAGNOSES, PROCEDURES, PROVIDERS, findProcedure } from "@/lib/catalog";
import {
  EMPTY_NEW_REQUEST_VALUES,
  type NewRequestField,
  type NewRequestValues,
} from "@/lib/validation/request";
import { createDraftRequest, type NewRequestState } from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [state, formAction, pending] = useActionState(createDraftRequest, initialState);

  return (
    // The key remounts the fields after each failed submit, so their default
    // values come from what the server echoed back instead of being reset.
    <form action={formAction} key={state.attempt} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Request details</CardTitle>
        </CardHeader>
        <CardContent>
          {state.message && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {state.message}
            </p>
          )}
          <FormFields state={state} patients={patients} minServiceDate={minServiceDate} />
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t pt-4">
          <Link href="/requests" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
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
    <div className="grid gap-5 md:grid-cols-2">
      <Field id="patientId" label="Patient" error={err("patientId")} className="md:col-span-2">
        <SelectField
          name="patientId"
          items={patients}
          values={values}
          placeholder={patients.length ? "Select a patient" : "No patients found"}
          invalid={!!err("patientId")}
        />
      </Field>

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

      <Field id="serviceDate" label="Service date" error={err("serviceDate")}>
        <Input
          id="serviceDate"
          name="serviceDate"
          type="date"
          min={minServiceDate}
          defaultValue={values.serviceDate}
          aria-invalid={!!err("serviceDate") || undefined}
          aria-describedby={err("serviceDate") ? "serviceDate-error" : undefined}
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
          aria-describedby="unitsRequested-hint"
        />
      </Field>

      <fieldset className="space-y-3 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">Supporting documentation</legend>
        <p className="text-xs text-gray-500">
          The simulated payer checks these when it decides. Missing clinical notes usually
          lead to a pend; no documented conservative treatment can lead to a denial.
        </p>
        <CheckboxField
          name="clinicalNotesAttached"
          label="Clinical notes attached"
          defaultChecked={values.clinicalNotesAttached === "true"}
        />
        <CheckboxField
          name="conservativeTreatmentTried"
          label="Conservative treatment tried (e.g. PT, medication, injections)"
          defaultChecked={values.conservativeTreatmentTried === "true"}
        />
      </fieldset>
    </div>
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
        <p id={`${id}-hint`} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-700">
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
  defaultChecked,
}: {
  name: NewRequestField;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox
        id={name}
        name={name}
        value="true"
        uncheckedValue="false"
        defaultChecked={defaultChecked}
      />
      <Label htmlFor={name} className="font-normal">
        {label}
      </Label>
    </div>
  );
}
