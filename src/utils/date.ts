import { addDays, isSaturday, parse, isValid } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { enGB } from "date-fns/locale";
import { DateType } from "../agents/types.js";

export const PRIORITY_LEVELS = [
  // The "p" priority levels are for community posts.
  "p1",
  "p2",
  "p3",
  // The "r" priority levels are for repurposed posts.
  "r1",
  "r2",
  "r3",
];

/** Format of schedule dates shown in the inbox and accepted back. */
export const SCHEDULE_DATE_FORMAT = "MM/dd/yyyy hh:mm a";

/** Timezone abbreviations accepted in schedule dates -> IANA zone. */
const TIMEZONE_ABBREVIATIONS: Record<string, string> = {
  // North America
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  AKST: "America/Anchorage",
  AKDT: "America/Anchorage",
  HST: "Pacific/Honolulu",
  // Europe. CET/CEST both mean "Central European wall-clock time" (DST
  // applied automatically), so typing CET in summer does what you expect.
  UTC: "UTC",
  GMT: "Etc/GMT",
  BST: "Europe/London",
  CET: "Europe/Rome",
  CEST: "Europe/Rome",
  EET: "Europe/Helsinki",
  EEST: "Europe/Helsinki",
  // Asia/Pacific
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  IST: "Asia/Kolkata",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
  AWST: "Australia/Perth",
  NZST: "Pacific/Auckland",
  NZDT: "Pacific/Auckland",
};

/** A trailing zone: 2-5 letter abbreviation or an IANA name like Europe/Rome. */
const ZONE_SUFFIX = / ([A-Z]{2,5}|[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_]+)?)$/;

function splitZone(
  dateString: string,
): { local: string; zone: string } | undefined {
  const m = dateString.trim().match(ZONE_SUFFIX);
  if (!m) return undefined;
  const zone = TIMEZONE_ABBREVIATIONS[m[1]] ?? m[1];
  return { local: dateString.trim().slice(0, m.index).trim(), zone };
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts 'MM/dd/yyyy hh:mm a <ZONE>' to a UTC Date. ZONE can be an
 * abbreviation (CET, CEST, PST, …) or an IANA name (Europe/Rome).
 */
export function timezoneToUtc(dateString: string): Date | undefined {
  const parts = splitZone(dateString);
  if (!parts || !isKnownZone(parts.zone)) {
    console.error("No valid timezone found in date string");
    return undefined;
  }
  const local = parse(parts.local, SCHEDULE_DATE_FORMAT, new Date(0));
  if (!isValid(local)) return undefined;
  // `local` holds the wall-clock fields; interpret them in the given zone.
  const wallClock = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}T${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}:00`;
  const utc = fromZonedTime(wallClock, parts.zone);
  return isNaN(utc.getTime()) ? undefined : utc;
}

/**
 * Format a date for the inbox in the given zone, e.g. "10/18/2026 06:20 PM CEST".
 * Uses the zone's abbreviation when one exists, otherwise its IANA name, so
 * the string can always be submitted back unchanged.
 */
export function formatScheduleDate(date: Date, timeZone: string): string {
  const local = formatInTimeZone(date, timeZone, SCHEDULE_DATE_FORMAT);
  const abbr = formatInTimeZone(date, timeZone, "zzz", { locale: enGB });
  const zone =
    /^[A-Z]{2,5}$/.test(abbr) && TIMEZONE_ABBREVIATIONS[abbr] ? abbr : timeZone;
  return `${local} ${zone}`;
}

/**
 * Next Saturday (after today, in `timeZone`) at hour:minute wall-clock time
 * in `timeZone`, as an absolute Date.
 */
export function getNextSaturdayDate(
  hour = 12,
  minute = 0,
  timeZone = "America/Los_Angeles",
): Date {
  let day = toZonedTime(new Date(), timeZone);
  do {
    day = addDays(day, 1);
  } while (!isSaturday(day));
  const wallClock = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(wallClock, timeZone);
}

/** Validates 'MM/dd/yyyy hh:mm a <ZONE>' (zone optional for this check). */
export function isValidDateString(dateString: string): boolean {
  try {
    const parts = splitZone(dateString);
    if (parts && !isKnownZone(parts.zone)) return false;
    const local = parts ? parts.local : dateString.trim();
    return isValid(parse(local, SCHEDULE_DATE_FORMAT, new Date()));
  } catch (e) {
    console.error("Failed to parse date string:", e);
    return false;
  }
}

/**
 * Parses a priority value (p1…r3) or a 'MM/dd/yyyy hh:mm a <ZONE>' date.
 * @returns Priority value, UTC Date, or undefined if invalid
 */
export function parseDateResponse(dateString: string): DateType | undefined {
  const cleanedDate = dateString.toLowerCase().trim();
  if (PRIORITY_LEVELS.find((p) => cleanedDate === p)) {
    return cleanedDate as DateType;
  }
  if (!isValidDateString(dateString)) {
    return undefined;
  }
  return timezoneToUtc(dateString);
}
