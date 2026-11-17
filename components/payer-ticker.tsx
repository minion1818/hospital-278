"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 3000;
/** Stop after this many quiet ticks (~2 min) so a stuck request can't poll forever. */
const MAX_IDLE_TICKS = 40;

type TickResponse = {
  acknowledged: number;
  responded: number;
  /** Hospital requests waiting on the payer */
  pending: number;
  /** Payer messages not yet responded to or not yet delivered */
  payerOpen: number;
};

/**
 * Stand-in for a background worker: while the page shows work in flight,
 * POST /api/payer/tick every few seconds and refresh the page when something
 * changed. Stops when the watched count reaches zero (or after ~2 quiet minutes).
 *
 * Shared by both sides: it imports no hospital or payer code, only the tick URL.
 * Callers should pass a `key` that changes when their work changes, so a ticker
 * that went idle restarts after, e.g., a manual decision.
 */
export function PayerTicker({
  active,
  watch = "requests",
  label = "Waiting for the payer…",
}: {
  active: boolean;
  /** Which count ends polling: hospital requests or payer messages */
  watch?: "requests" | "payer";
  label?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(active);

  // A server re-render after refresh may flip `active` (e.g. the decision
  // arrived, or a new request was sent). Adjust state during render when the
  // prop changes, React's recommended alternative to syncing in an effect.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    setRunning(active);
  }

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let idle = 0;
    let inFlight = false;

    const run = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await fetch("/api/payer/tick", { method: "POST", cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as TickResponse;
        if (cancelled) return;

        if (data.acknowledged > 0 || data.responded > 0) {
          idle = 0;
          router.refresh();
        } else if (++idle >= MAX_IDLE_TICKS) {
          setRunning(false);
        }
        if ((watch === "payer" ? data.payerOpen : data.pending) === 0) {
          router.refresh(); // pick up anything another tab applied
          setRunning(false);
        }
      } catch {
        // network blip: try again next interval
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(run, INTERVAL_MS);
    void run();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, router, watch]);

  if (!running) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 flex items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {label}
    </div>
  );
}
