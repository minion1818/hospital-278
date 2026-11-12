// Simulated demo catalogs. These are small, hand-picked lists for a synthetic
// portfolio dashboard, not a real CPT/ICD-10 code set or provider directory.

export type Procedure = { code: string; label: string; maxUnits: number };
export type Diagnosis = { code: string; label: string };
export type Provider = { name: string; npi: string };

/** CPT procedure codes (simulated). maxUnits is the most units one request may ask for. */
export const PROCEDURES = [
  { code: "72148", label: "MRI lumbar spine", maxUnits: 1 },
  { code: "73721", label: "MRI knee", maxUnits: 1 },
  { code: "70553", label: "MRI brain", maxUnits: 1 },
  { code: "43239", label: "Upper GI endoscopy", maxUnits: 1 },
  { code: "93458", label: "Cardiac catheterization", maxUnits: 1 },
  { code: "27447", label: "Total knee replacement", maxUnits: 1 },
  { code: "97110", label: "Physical therapy, per visit", maxUnits: 24 },
  { code: "64483", label: "Epidural steroid injection", maxUnits: 3 },
] as const satisfies readonly Procedure[];

/** ICD-10-CM diagnosis codes (simulated subset; covers every code used in prisma/seed.ts). */
export const DIAGNOSES = [
  { code: "M54.16", label: "Radiculopathy, lumbar region" },
  { code: "M54.50", label: "Low back pain, unspecified" },
  { code: "M17.11", label: "Primary osteoarthritis, right knee" },
  { code: "G43.909", label: "Migraine, unspecified" },
  { code: "K21.9", label: "Gastro-esophageal reflux disease without esophagitis" },
  { code: "I25.10", label: "Atherosclerotic heart disease of native coronary artery" },
] as const satisfies readonly Diagnosis[];

/** Requesting providers (simulated; same names and NPIs as prisma/seed.ts). */
export const PROVIDERS = [
  { name: "Jane Smith", npi: "1234567893" },
  { name: "Alan Brooks", npi: "1245319599" },
  { name: "Priya Patel", npi: "1679576722" },
] as const satisfies readonly Provider[];

export const findProcedure = (code: string): Procedure | undefined =>
  PROCEDURES.find((p) => p.code === code);

export const findDiagnosis = (code: string): Diagnosis | undefined =>
  DIAGNOSES.find((d) => d.code === code);

export const findProvider = (npi: string): Provider | undefined =>
  PROVIDERS.find((p) => p.npi === npi);

/**
 * Payers (SIMULATED). The payer IDs are made up for this demo; real payer IDs
 * come from the payer or clearinghouse. Keyed by the payerName stored on Patient.
 */
export const PAYERS = [
  { name: "ACME Health Plan", payerId: "SIMACME01" },
  { name: "Summit Insurance", payerId: "SIMSUMMT2" },
  { name: "Northwind Health", payerId: "SIMNWIND3" },
] as const satisfies readonly { name: string; payerId: string }[];

export type Payer = (typeof PAYERS)[number];

export const findPayer = (name: string): Payer | undefined =>
  PAYERS.find((p) => p.name === name);

/**
 * Submitter / sender (SIMULATED). SENDER_ID is used in ISA06/GS02 and, prefixed
 * with "9" (user-assigned), as the 10-character TRN03 originating company id,
 * so it must be exactly 9 characters.
 */
export const SENDER = {
  id: "DEMOHOSP1",
  name: "Demo General Hospital",
} as const;
