import { readDelimiters } from "@/lib/x12/parse278";

/** X12 is often stored on one line; put each segment on its own line for display. */
export function formatEdi(raw: string): string {
  if (raw.includes("\n")) return raw;
  let terminator = "~";
  try {
    terminator = readDelimiters(raw).segment; // the ISA declares the real terminator
  } catch {
    // Not a well-formed interchange; fall back to the common "~"
  }
  return raw
    .split(terminator)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}${terminator}`)
    .join("\n");
}
