// Display formatting shared by every page. Presentation only.

/** Date-only values (service date, date of birth) are stored at UTC midnight, so format them in UTC. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Nov 15, 2026, 1:13 PM" in the server's time zone. */
export function formatDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full timestamp with seconds and zone, for tooltips: "Nov 15, 2026, 1:13:05 PM EST". */
export function formatDateTimeLong(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/** Short zone name for captions, e.g. "EST". */
export function timeZoneLabel(at: Date = new Date(0)): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "local time"
  );
}

/** "2026-11-20" (an ISO date string from parsed EDI) -> "Nov 20, 2026". */
export function formatIsoDate(iso: string | undefined): string | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return formatDate(new Date(`${iso}T00:00:00Z`));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
