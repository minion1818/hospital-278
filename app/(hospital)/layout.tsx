import { SiteHeader } from "@/components/site-header";

// Hospital side of the demo: dashboard header with the "Acting as" switcher.
// The simulated payer console (/payer) has its own layout and header.
export default function HospitalLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
