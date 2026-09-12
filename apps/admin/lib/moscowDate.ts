const MOSCOW_TZ = 'Europe/Moscow';

const CALENDAR_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOSCOW_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getMoscowCalendarDate(date: Date = new Date()): string {
  return CALENDAR_DATE_FORMAT.format(date);
}

/** UTC-midnight of the Moscow calendar date — matches how the bot buckets `GroupActivity.date`. */
export function getMoscowCalendarDateKey(reference: Date = new Date()): Date {
  return new Date(`${getMoscowCalendarDate(reference)}T00:00:00.000Z`);
}

export function getMoscowDayBounds(reference: Date = new Date()): { start: Date; end: Date } {
  const calendarDate = getMoscowCalendarDate(reference);
  return {
    start: new Date(`${calendarDate}T00:00:00+03:00`),
    end: new Date(`${calendarDate}T23:59:59.999+03:00`),
  };
}

export function getMoscowMonthBounds(reference: Date = new Date()): { start: Date; end: Date } {
  const [year, month] = getMoscowCalendarDate(reference).split('-').map(Number) as [
    number,
    number,
  ];
  const start = new Date(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01T00:00:00+03:00`);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(
    `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+03:00`,
  );
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
}

/** Moscow calendar-day keys for the last `days` days, oldest first, ending on `reference`'s day. */
export function lastNMoscowDateKeys(days: number, reference: Date = new Date()): Date[] {
  const todayKey = getMoscowCalendarDateKey(reference);
  const keys: Date[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(new Date(todayKey.getTime() - i * 24 * 60 * 60 * 1000));
  }
  return keys;
}
