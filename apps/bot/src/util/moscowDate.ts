const MOSCOW_TZ = 'Europe/Moscow';

const CALENDAR_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOSCOW_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: MOSCOW_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getMoscowCalendarDate(date: Date = new Date()): string {
  return CALENDAR_DATE_FORMAT.format(date);
}

export function getMoscowTimeHHmm(date: Date = new Date()): string {
  const parts = TIME_PARTS_FORMAT.formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export function parseCronTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function cronTimeMatchesNow(cronTime: string, now: Date = new Date()): boolean {
  const parsed = parseCronTime(cronTime);
  if (!parsed) {
    return false;
  }

  const expected = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
  return getMoscowTimeHHmm(now) === expected;
}

/**
 * Calendar-day key for a `@db.Date` column: UTC midnight of the Moscow calendar date, not the
 * real Moscow-midnight instant. A `DATE` column has no timezone of its own, so storing the
 * actual Moscow-midnight instant (e.g. `getMoscowDayBounds().start`, which is `21:00 UTC` the
 * day before) would shift the stored date back by one day.
 */
export function getMoscowCalendarDateKey(reference: Date = new Date()): Date {
  const calendarDate = getMoscowCalendarDate(reference);
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

export function getMoscowDayBounds(reference: Date = new Date()): { start: Date; end: Date } {
  const calendarDate = getMoscowCalendarDate(reference);
  return {
    start: new Date(`${calendarDate}T00:00:00+03:00`),
    end: new Date(`${calendarDate}T23:59:59.999+03:00`),
  };
}
