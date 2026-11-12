// Maps a stored PriorAuthRequest (+ patient) to generate278Request input.
// Pure (no DB access), shared by the APPROVE_AND_SEND workflow step and the seed.

import { SENDER, findPayer } from "@/lib/catalog";
import type { Generate278Input } from "@/lib/x12/generate278";

export type RequestFor278 = {
  id: string;
  controlNumber: number;
  createdAt: Date;
  providerName: string;
  providerNpi: string;
  diagnosisCode: string;
  procedureCode: string;
  unitsRequested: number;
  serviceDate: Date;
  patient: {
    firstName: string;
    lastName: string;
    memberId: string;
    dob: Date;
    gender: string;
    payerName: string;
  };
};

/** "Jane Smith" -> { firstName: "Jane", lastName: "Smith" }; the last word is the last name. */
export function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  const lastName = parts.pop() ?? "";
  return { firstName: parts.join(" "), lastName };
}

export function build278Input(request: RequestFor278): Generate278Input {
  const payer = findPayer(request.patient.payerName);
  if (!payer) {
    throw new Error(`No simulated payer id configured for "${request.patient.payerName}" (see lib/catalog.ts PAYERS)`);
  }
  return {
    controlNumber: request.controlNumber,
    createdAt: request.createdAt,
    requestReference: request.id,
    usage: "T",
    sender: { id: SENDER.id },
    payer: { name: payer.name, payerId: payer.payerId },
    provider: { ...splitName(request.providerName), npi: request.providerNpi },
    patient: {
      firstName: request.patient.firstName,
      lastName: request.patient.lastName,
      memberId: request.patient.memberId,
      dob: request.patient.dob,
      gender: request.patient.gender,
    },
    service: {
      diagnosisCode: request.diagnosisCode,
      procedureCode: request.procedureCode,
      units: request.unitsRequested,
      serviceDate: request.serviceDate,
    },
  };
}
