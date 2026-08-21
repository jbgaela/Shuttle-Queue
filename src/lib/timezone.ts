type DateTimePartValues = Record<string, string>;

function parts(value: Date | string, timeZone: string): DateTimePartValues {
  const result = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  return Object.fromEntries(result.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function dateTimeInputForTimezone(value: Date | string | null | undefined, timeZone: string) {
  if (!value) return "";
  const result = parts(value, timeZone);
  return `${result.year}-${result.month}-${result.day}T${result.hour}:${result.minute}`;
}

export function currentDateTimeForTimezone(timeZone: string, value = new Date()) {
  return dateTimeInputForTimezone(value, timeZone);
}

export function currentClockForTimezone(timeZone: string, value = new Date()) {
  const result = parts(value, timeZone);
  return `${result.hour}:${result.minute}`;
}

function secondParts(value: Date, timeZone: string) {
  const result = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  return Object.fromEntries(result.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function instantForLocalDateTime(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("The cutoff time is invalid.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = secondParts(new Date(candidate), timeZone);
    const offset = Date.UTC(actual.year!, actual.month! - 1, actual.day!, actual.hour!, actual.minute!, actual.second!) - candidate;
    candidate = desired - offset;
  }
  const result = new Date(candidate);
  const actual = secondParts(result, timeZone);
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute) throw new Error("The cutoff time is invalid.");
  return result.toISOString();
}

export function datePartsForInstant(value: Date, timeZone: string) {
  const result = parts(value, timeZone);
  return `${result.year}-${result.month}-${result.day}`;
}

export function inclusiveMinuteInstantForLocalDateTime(value: string, timeZone: string) {
  return new Date(Date.parse(instantForLocalDateTime(value, timeZone)) + 59_999).toISOString();
}
