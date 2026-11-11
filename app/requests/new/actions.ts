"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { findProcedure, findProvider } from "@/lib/catalog";
import {
  EMPTY_NEW_REQUEST_VALUES,
  newRequestSchema,
  type NewRequestField,
  type NewRequestFieldErrors,
  type NewRequestValues,
} from "@/lib/validation/request";

export type NewRequestState = {
  values: NewRequestValues;
  errors: NewRequestFieldErrors;
  message?: string;
  /** Increments on every failed submit so the form remounts with the returned values. */
  attempt: number;
};

const FIELDS = Object.keys(EMPTY_NEW_REQUEST_VALUES) as NewRequestField[];

export async function createDraftRequest(
  prevState: NewRequestState,
  formData: FormData,
): Promise<NewRequestState> {
  // Echo back exactly what the user submitted so nothing is lost on error
  const values = Object.fromEntries(
    FIELDS.map((f) => [f, String(formData.get(f) ?? EMPTY_NEW_REQUEST_VALUES[f])]),
  ) as NewRequestValues;
  const fail = (errors: NewRequestFieldErrors, message?: string): NewRequestState => ({
    values,
    errors,
    message,
    attempt: prevState.attempt + 1,
  });

  const parsed = newRequestSchema.safeParse(values);
  if (!parsed.success) {
    return fail(
      z.flattenError(parsed.error).fieldErrors,
      "Please fix the highlighted fields.",
    );
  }
  const data = parsed.data;

  // Both are guaranteed by the schema; looked up again for the name and label
  const provider = findProvider(data.providerNpi)!;
  const procedure = findProcedure(data.procedureCode)!;

  const patient = await db.patient.findUnique({ where: { id: data.patientId }, select: { id: true } });
  if (!patient) {
    return fail({ patientId: ["That patient no longer exists. Pick another."] });
  }

  // TODO(auth): real authentication comes later. Until then every draft is
  // created by the seeded staff user.
  const staff = await db.user.findUnique({ where: { email: "staff@demo.test" } });
  if (!staff) {
    return fail({}, "Demo staff user not found. Run `npx prisma db seed` and try again.");
  }

  const created = await db.$transaction(async (tx) => {
    const request = await tx.priorAuthRequest.create({
      data: {
        status: "DRAFT",
        patientId: data.patientId,
        providerName: provider.name,
        providerNpi: provider.npi,
        diagnosisCode: data.diagnosisCode,
        procedureCode: data.procedureCode,
        serviceDate: data.serviceDate,
        unitsRequested: data.unitsRequested,
        clinicalNotesAttached: data.clinicalNotesAttached,
        conservativeTreatmentTried: data.conservativeTreatmentTried,
        createdById: staff.id,
      },
    });
    await tx.auditLog.create({
      data: {
        requestId: request.id,
        actor: staff.name,
        action: "CREATED",
        details: `Draft created for ${procedure.label}`,
      },
    });
    return request;
  });

  revalidatePath("/requests");
  // redirect() throws, so it must stay outside any try/catch
  redirect(`/requests/${created.id}`);
}
