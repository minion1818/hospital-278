"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard and briefly confirms (or reports failure). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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
      <span aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}
      </span>
    </Button>
  );
}
