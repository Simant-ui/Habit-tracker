import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";

const weekdayIndexMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function getDatePartsInTZ(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

export function toDateStringInTZ(date: Date, timeZone: string) {
  const { year, month, day } = getDatePartsInTZ(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function getWeekdayIndexInTZ(
  year: number,
  monthIndex0: number,
  day: number,
  timeZone: string
) {
  const dt = new Date(Date.UTC(year, monthIndex0, day, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  }).format(dt);
  return weekdayIndexMap[weekday] ?? 0;
}

export function daysInMonthUTC(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function dateStringAddDays(dateString: string, days: number) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function toDateStringLocal(d: Date) {
  // timezone-safe: local date formatting
  return format(d, "yyyy-MM-dd");
}

export function fromDateStringLocal(s: string) {
  // s = yyyy-mm-dd
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function lastNDaysStrings(end: Date, n: number) {
  const arr: string[] = [];
  for (let i = n - 1; i >= 0; i--) arr.push(toDateStringLocal(addDays(end, -i)));
  return arr;
}

export function weekRangeFromDate(d: Date) {
  const start = startOfWeek(d, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(d, { weekStartsOn: 1 });
  return { start, end };
}

export function monthRange(year: number, monthIndex0: number) {
  const start = startOfMonth(new Date(year, monthIndex0, 1));
  const end = endOfMonth(start);
  return { start, end };
}

export function yearRange(year: number) {
  const start = startOfYear(new Date(year, 0, 1));
  const end = endOfYear(start);
  return { start, end };
}
