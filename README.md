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
