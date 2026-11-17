"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard and briefly confirms (or reports failure). */
export function CopyButton({ text, label = "Copy", ariaLabel }: { text: string; label?: string; ariaLabel?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={ariaLabel}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
        } catch {
          // Clipboard API needs a secure context (https or localhost) and permission
          setStatus("failed");
        }
      }}
    >
      {status === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}
