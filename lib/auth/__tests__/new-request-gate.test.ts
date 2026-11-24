import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ACCOUNTS } from "@/lib/auth/roles";
import { EMPTY_NEW_REQUEST_VALUES, todayIsoDate } from "@/lib/validation/request";

// The new-request Server Action, run with mocked cookies and database
const h = vi.hoisted(() => {
  const tx = { priorAuthRequest: { create: vi.fn() }, auditLog: { create: vi.fn() } };
  return {
    cookie: { value: undefined as string | undefined },
    tx,
    db: {
      user: { findUnique: vi.fn() },
      patient: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookie.value !== undefined ? { name, value: h.cookie.value } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: h.db }));

const { createDraftRequest } = await import("@/app/(hospital)/requests/new/actions");

const validForm = () => {
  const fd = new FormData();
  const values = {
    ...EMPTY_NEW_REQUEST_VALUES,
    patientId: "patient-1",
    providerNpi: "1234567893",
    diagnosisCode: "M17.11",
    procedureCode: "73721",
    serviceDate: todayIsoDate(),
    unitsRequested: "1",
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const initial = { values: EMPTY_NEW_REQUEST_VALUES, errors: {}, attempt: 0 };
const nothingWritten = () => {
  expect(h.db.$transaction).not.toHaveBeenCalled();
  expect(h.tx.priorAuthRequest.create).not.toHaveBeenCalled();
  expect(h.tx.auditLog.create).not.toHaveBeenCalled();
};

describe("createDraftRequest role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.db.patient.findUnique.mockResolvedValue({ id: "patient-1" });
    h.db.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
      where.email === ROLE_ACCOUNTS.STAFF.email
        ? { id: "staff-1", name: ROLE_ACCOUNTS.STAFF.name, role: "STAFF" }
        : { id: "rev-1", name: ROLE_ACCOUNTS.REVIEWER.name, role: "REVIEWER" },
    );
    h.tx.priorAuthRequest.create.mockResolvedValue({ id: "req-1" });
  });

  it("refuses the Utilization Reviewer and creates nothing", async () => {
    h.cookie.value = "REVIEWER";
    const state = await createDraftRequest(initial, validForm());
    expect(state.message).toMatch(/Only the Authorization Specialist can create requests/);
    nothingWritten();
  });

  it.each([["missing", undefined], ["tampered", "ADMIN"]])(
    "sends a %s role cookie to /login and creates nothing",
    async (_label, value) => {
      h.cookie.value = value;
      await expect(createDraftRequest(initial, validForm())).rejects.toThrow("REDIRECT /login");
      nothingWritten();
    },
  );

  it("lets the Authorization Specialist create a draft as the role account", async () => {
    h.cookie.value = "STAFF";
    await expect(createDraftRequest(initial, validForm())).rejects.toThrow("REDIRECT /requests/req-1");
    expect(h.tx.priorAuthRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", createdById: "staff-1" }) }),
    );
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actor: "Authorization Specialist", action: "CREATED" }) }),
    );
  });
});
