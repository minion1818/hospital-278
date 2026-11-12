import { z } from "zod";
import { findDiagnosis, findProcedure, findProvider } from "@/lib/catalog";

/** Today's date as YYYY-MM-DD in the server's local time zone. */
export function todayIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parses YYYY-MM-DD into a Date at UTC midnight, or null if it isn't a real calendar date.
 * Date-only values (service date, DOB) are stored at UTC midnight and formatted in
 * UTC everywhere (UI and X12), so they never shift by a day across time zones.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects rollovers like 2026-02-30 -> March 2
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

// FormData values arrive as strings (or null when a field is missing entirely).
const requiredText = (message: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, { error: message }));

// Base UI checkboxes submit "true"/"false"; a plain HTML checkbox submits "on" or nothing.
const checkbox = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());

export const newRequestSchema = z
  .object({
    patientId: requiredText("Select a patient."),

    providerNpi: requiredText("Select a requesting provider.").refine((npi) => npi === "" || !!findProvider(npi), {
      error: "Select a provider from the list; that NPI isn't on file.",
    }),

    diagnosisCode: requiredText("Select a diagnosis.").refine((c) => c === "" || !!findDiagnosis(c), {
      error: "Select a diagnosis from the list; that code isn't in the catalog.",
    }),

    procedureCode: requiredText("Select a procedure.").refine((c) => c === "" || !!findProcedure(c), {
      error: "Select a procedure from the list; that code isn't in the catalog.",
    }),

    serviceDate: requiredText("Enter the planned service date.")
      .refine((v) => v === "" || parseIsoDate(v) !== null, { error: "Enter a valid date (YYYY-MM-DD)." })
      .refine((v) => parseIsoDate(v) === null || v >= todayIsoDate(), {
        error: "The service date can't be in the past.",
      })
      .transform((v) => parseIsoDate(v)!),

    unitsRequested: requiredText("Enter the number of units.")
      .transform(Number)
      .pipe(
        z
          .number({ error: "Units must be a whole number." })
          .int({ error: "Units must be a whole number." })
          .min(1, { error: "Request at least 1 unit." })
          .max(99, { error: "Request no more than 99 units." }),
      ),

    clinicalNotesAttached: checkbox,
    conservativeTreatmentTried: checkbox,
  })
  .superRefine((data, ctx) => {
    // Per-procedure limit from the catalog (e.g. 1 for an MRI, 24 PT visits)
    const procedure = findProcedure(data.procedureCode);
    if (procedure && data.unitsRequested > procedure.maxUnits) {
      ctx.addIssue({
        code: "custom",
        path: ["unitsRequested"],
        message: `${procedure.label} allows at most ${procedure.maxUnits} unit${procedure.maxUnits === 1 ? "" : "s"} per request.`,
      });
    }
  });

export type NewRequestInput = z.output<typeof newRequestSchema>;
export type NewRequestField = keyof z.input<typeof newRequestSchema>;
export type NewRequestFieldErrors = Partial<Record<NewRequestField, string[]>>;

/** Raw form values echoed back to the form so nothing is lost on a validation error. */
export type NewRequestValues = Record<NewRequestField, string>;

export const EMPTY_NEW_REQUEST_VALUES: NewRequestValues = {
  patientId: "",
  providerNpi: "",
  diagnosisCode: "",
  procedureCode: "",
  serviceDate: "",
  unitsRequested: "1",
  clinicalNotesAttached: "false",
  conservativeTreatmentTried: "false",
};
