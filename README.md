This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 278 generation

When a reviewer clicks **Approve and send to payer**, the app builds an X12 278
(Health Care Services Review: Request) for the request, stores it in
`PriorAuthRequest.raw278Request`, and logs "Submitted to payer" with the control
number. The detail page shows it with **Copy** and **Download .edi**
(`/requests/<id>/278`).

> **Demonstration only.** The output follows the **005010X217** loop structure in a
> simplified form (one patient event, one service line). It has **not** been
> validated or certified against any payer's companion guide, and everything in this
> project (patients, members, providers, payer IDs, sender ID) is **synthetic**.

- **Code:** `lib/x12/generate278.ts` (pure generator), `lib/x12/parse278.ts` (parser and
  validator), `lib/x12/from-request.ts` (maps a stored request to generator input).
  Simulated payer IDs and the sender ID live in `lib/catalog.ts`.
- **Tests:** `npm test` (Vitest, `lib/x12/__tests__`). Covers parser validation, the SE01
  count, the 106-character ISA, envelope control numbers, ICD decimal stripping, a
  generate-then-parse round trip, and separator sanitizing.
- **Delimiters:** `*` element, `:` component, `^` repetition, `~` segment, with one
  segment per line. ISA15 = `T` (test data).
- **Control numbers:** `PriorAuthRequest.controlNumber` (a database sequence) is used for
  ISA13 (9 digits), GS06, and ST02/SE02 (at least 4 digits). If a reopened request is
  sent again, it gets a new number from the same sequence, because interchange control
  numbers must not be reused.
- **Dates:** taken from the request's creation time and formatted in **UTC**. Date-only
  values (date of birth, service date) are stored at UTC midnight, so they don't shift by
  time zone.

Generated structure:

```
ISA … GS*HI … ST*278*…*005010X217
BHT*0007*13*<request id>*<date>*<time>
HL*1**20*1     NM1*X3   payer (UMO)                    2000A/2010A
HL*2*1*21*1    NM1*1P   requesting provider (NPI)      2000B/2010B
HL*3*2*22*1    NM1*IL   subscriber/patient + DMG       2000C/2010C
HL*4*3*EV*1    TRN UM DTP HI   patient event           2000E
HL*5*4*SS*0    TRN SV1 DTP     service                 2000F
SE … GE … IEA
```

### Segments and elements I'm not certain about

- **SV1 unit count:** written as `SV1*HC:<code>**UN*<units>` (SV103 = unit basis `UN`,
  SV104 = count), following the professional-service SV1 layout. The earlier sample put
  the count in SV106, which I believe is wrong for 005010X217.
- **2000E `DTP*472`:** kept from the sample. I believe 005010X217 expects the patient
  event date in 2000E as `DTP*AAH` (event date), with `472` used in the 2000F service
  loop. This is a likely fix if a validator flags it.
- **`UM*HS*I*3*11:B`:** fixed values for every request. UM03 service type `3`
  (consultation) and place of service `11` (office) don't fit procedures like knee
  replacement or cardiac catheterization. A fuller version would map them per procedure.
- **TRN03:** `9` + the 9-character sender ID makes the required 10-character originating
  company ID. Trace numbers are `<request id>-EV` and `<request id>-SV1`.
- **No 2010B address or contact segments, no 2000D dependent loop** (the patient is
  always the subscriber), and **no SV102 charge amount**. Some payers require these.
- **ISA/GS dates use the request's creation time**, not the transmission time, so a
  resubmitted request carries its original date with a new control number.
- **ISA05/07 = `ZZ`** (mutually defined IDs). Real trading partners agree on these.

## Mock payer rules (simulated)

> **These rules are invented for this demo.** They are not any insurer's coverage
> criteria or medical policy, and the 278 response is not a certified 005010X217
> implementation. All data is synthetic.

The mock payer decides using only what arrives in the 278 request, plus a separate
`attachments` object (`clinicalNotesAttached`, `conservativeTreatmentDocumented`)
standing in for documentation that in real life travels separately (for example an
X12 275). It never reads the hospital's database. Eligibility comes from a `roster`
(member id → `{ active }`) supplied by the caller, and "today" is passed in.

- **Code:** `lib/payer/rules.ts` (`PROCEDURE_RULES`, `evaluateRequest`,
  `payerRequestFromParsed`), `lib/x12/generate278Response.ts`,
  `lib/x12/parse278Response.ts`, `lib/x12/envelope.ts` (envelope shared with the request
  generator), `lib/x12/reject-reasons.ts`.
- **Tests:** `lib/payer/__tests__/rules.test.ts` and
  `lib/x12/__tests__/generate278Response.test.ts`.

### Procedure rules

| CPT | Procedure | Allowed diagnoses (ICD-10 groups) | Clinical notes | Conservative treatment | Max units |
|---|---|---|---|---|---|
| 72148 | MRI lumbar spine | M54 | — | Required | 1 |
| 73721 | MRI knee | M17, M25 | Required | — | 1 |
| 70553 | MRI brain | G43, R51 | Required | — | 1 |
| 43239 | Upper GI endoscopy | K21, K25, R10 | — | — | 1 |
| 93458 | Cardiac catheterization | I25, I20 | Required | — | 1 |
| 27447 | Total knee replacement | M17 | Required | Required | 1 |
| 97110 | Physical therapy, per visit | M54, M25, M17 | Required | — | 12 |
| 64483 | Epidural steroid injection | M54 | — | Required | 1 |

Diagnosis codes match by prefix with or without the decimal point (`M54.16` and `M5416`
both match `M54`). Every procedure/diagnosis pair in `prisma/seed.ts` is allowed.

### Evaluation order

Checks run in a strict order, and the first failure decides the outcome:

1. **REJECTED** (data problems), checked in loop order:
   - payer id missing or not handled → `79`
   - member id missing → `72`
   - member not on roster → `75`
   - NPI missing, not 10 digits, or failing its check digit → `43`
   - service date missing or invalid → `57`
   - service date before today → `56`
   - diagnosis missing or not ICD-10 shaped → `AF`
   - procedure missing or not in the rules → `AG`
   - units missing → `15`
   - units not a whole number ≥ 1 → `33`
2. **PENDED:** clinical notes required but not attached.
3. **DENIED:** coverage inactive, then diagnosis not allowed for the procedure (medical
   necessity), then conservative treatment required but not documented.
4. **PARTIAL:** units above the limit; approves the limit.
5. **APPROVED:** approves the requested units.

Only the first failing check is reported, even for rejections. Because PENDED is checked
before DENIED, a member with inactive coverage whose notes are missing is pended, not
denied.

### Outcomes in the 278 response

| Decision | Response | Parsed as |
|---|---|---|
| APPROVED | `HCR*A1*<auth no.>` in the event loop; `SV1 … UN*<approved units>` in the service loop | `APPROVED` |
| PARTIAL | `HCR*A2*<auth no.>`, `MSG` reason, `SV1` with the approved units | `PARTIALLY_APPROVED` |
| DENIED | `HCR*A3`, `MSG` reason | `DENIED` |
| PENDED | `HCR*A4`, `MSG` reason | `PENDED` |
| REJECTED | `AAA*N**<code>*C` in the loop where the problem is (payer, requester, subscriber, event or service), `MSG` with the explanation, no `HCR` | `REJECTED` |

The response mirrors the request's HL hierarchy and swaps sender and receiver.
`BHT02 = 11` marks a response, and `BHT03` echoes the request's reference. The request's
TRN traces come back as `TRN*2*…` (referenced trace). It uses the same delimiters,
106-character ISA, computed SE01 and `ISA15 = T` as the request. Reason texts contain no
X12 delimiter characters, so they come back unchanged. MSG is cut to 264 characters.

### Things I'm unsure about

- **HCR placement:** the decision sits in the event loop (2000E), as specified. I believe
  real 005010X217 responses also, or instead, carry an HCR per service line (2000F).
- **HCR03 (decision reason code) is left out:** its values come from an external code
  list I can't reproduce reliably, so the reason only appears as text in MSG.
- **HCR02:** I put the authorization number here (review identification number) for
  A1/A2 only. Payers may also send it in a REF segment, and may give pended requests a
  tracking number.
- **MSG:** I believe it's allowed in 2000E and used for free-form text. Its exact position
  among the 2000E segments isn't confirmed.
- **AAA02 left empty and AAA04 = `C`** ("please correct and resubmit"). I'm fairly
  confident of AAA01 = `N` and AAA04 = `C`.
- **AAA position:** placed after NM1 in the payer, requester and subscriber loops (and
  before DMG in the subscriber loop), and right after TRN in the event and service loops.
  The exact segment order in the guide isn't confirmed.
- **Reject codes, most sure to least:**
  - Confident: `72`, `75`, `43`, `57`.
  - Plausible, not confirmed for these 278 loops:
    - `56` (inappropriate date) for a past service date
    - `79` (invalid participant identification) for an unknown payer
    - `AF` / `AG` (invalid/missing diagnosis or procedure)
    - `15` (required data missing) and `33` (input errors) for units
- **`TRN01 = 2`** for echoed traces (my understanding of how responses reference request
  traces).
- **Echoed segments:** the response repeats the request's UM, DTP, HI, DMG and the
  requested SV1 for non-certified outcomes. A real payer may send fewer.
- Plus the request-side uncertainties listed under "278 generation" (`DTP*472` vs `AAH`
  in 2000E, the fixed `UM` values).
