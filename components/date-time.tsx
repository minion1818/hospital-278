import { formatDate, formatDateTime, formatDateTimeLong } from "@/lib/format";

/**
 * A timestamp in the consistent short format ("Nov 15, 2026, 1:13 PM").
 * Hovering shows seconds and the time zone.
 */
export function DateTime({ value, dateOnly = false }: { value: Date; dateOnly?: boolean }) {
  return (
    <time dateTime={value.toISOString()} title={dateOnly ? undefined : formatDateTimeLong(value)}>
      {dateOnly ? formatDate(value) : formatDateTime(value)}
    </time>
  );
}
