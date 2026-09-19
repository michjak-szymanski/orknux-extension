/*
 * Dates and the working calendar, as a plugin.
 *
 * The commonest thing a workflow wants to gate on is time — is it a working
 * day, is the office open, is this ticket three business days old, when is it
 * due — and every one of those is a question a workflow expression answers
 * badly or not at all. They are also questions a model gets wrong with
 * confidence: date arithmetic across month ends, weekends and daylight saving
 * is exactly the sort of thing that looks right and is off by one.
 *
 * So this is arithmetic, and nothing else. It reaches nothing, asks for no
 * capability, and cannot fail because somebody's API changed. What it does
 * need is two permissions: TEMPORAL for a clock at all, and INTL for the
 * zone database — `Intl.DateTimeFormat` is what knows that Warsaw was two
 * hours ahead in July and one in November, and hand-rolling that would mean
 * shipping a copy of the world's timezone rules that goes stale.
 *
 * ## The working calendar is configuration, not an argument
 *
 * Which days are the weekend, which dates are holidays, and when the office
 * opens are facts about the workspace rather than about a call — a workflow
 * should not have to pass the holiday list to every question. They are
 * parameters, answered once, and every function reads them.
 *
 * `weekend` takes day names or numbers (`sat,sun`, `fri,sat`, `5,6`), because
 * the weekend is not Saturday and Sunday everywhere. `holidays` takes ISO
 * dates, and a workspace that keeps them in a variable can edit that variable
 * once a year and have every workflow follow.
 *
 * ## What a date means here
 *
 * Anything ISO-8601: `2026-09-19` is that date at midnight in the working
 * timezone, `2026-09-19T14:30:00Z` is an instant. An empty `when` is now,
 * which is what a workflow asking about today wants and one fewer thing to
 * wire. Answers carry the instant as ISO with its offset, so what comes back
 * can go straight back in.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The days of the week, indexed as `getUTCDay` indexes them. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** What `shift` will move, and by how many milliseconds where that is fixed. */
const FIXED_UNITS = {
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
  days: 86400000,
  weeks: 604800000,
};

/** The units `between` measures in, longest first so a refusal can list them. */
const UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];

/** A date that is not one, said the same way everywhere. */
function parsed(when, label) {
  if (when === undefined || when === null || (typeof when === 'string' && when.trim().length === 0)) {
    return new Date();
  }
  if (typeof when !== 'string') {
    throw new Error(`${label} is not a date: ${String(when)}`);
  }
  const held = when.trim();
  /*
   * A bare date is midnight *in the working timezone*, not in UTC — which is
   * a different instant, and the one somebody writing `2026-09-19` means.
   * Marked here and resolved by the caller, which knows the zone.
   */
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(held) ? `${held}T00:00:00Z` : held);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a date this understands: ${held}`);
  }
  return date;
}

/** Whether a string is a bare calendar date rather than an instant. */
function bare(when) {
  return typeof when === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(when.trim());
}

/** The wall clock in one zone, as numbers. */
function partsIn(date, zone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const held = {};
  for (const part of formatter.formatToParts(date)) {
    held[part.type] = part.value;
  }
  return {
    year: Number(held.year),
    month: Number(held.month),
    day: Number(held.day),
    /* Some engines spell midnight `24` under hour12:false. */
    hour: Number(held.hour) % 24,
    minute: Number(held.minute),
    second: Number(held.second),
  };
}

/** How far ahead of UTC a zone is at one instant, in minutes. */
function offsetAt(date, zone) {
  const parts = partsIn(date, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * The instant at which a zone's wall clock reads these parts.
 *
 * Guessed as though the parts were UTC and then corrected by the offset —
 * twice, because the offset at the guess and the offset at the answer differ
 * across a daylight-saving boundary, and the second reading is the one that
 * belongs to the answer.
 */
function instantOf(parts, zone) {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const first = offsetAt(new Date(guess), zone);
  const corrected = guess - first * 60000;
  const second = offsetAt(new Date(corrected), zone);
  return new Date(second === first ? corrected : guess - second * 60000);
}

/** Two digits, for building the strings below. */
function two(value) {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` of a zone's wall clock. */
function dateOf(parts) {
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}`;
}

/** The whole instant as ISO, carrying the zone's offset rather than a Z. */
function isoOf(date, zone) {
  const parts = partsIn(date, zone);
  const offset = offsetAt(date, zone);
  const sign = offset < 0 ? '-' : '+';
  const size = Math.abs(offset);
  return (
    `${dateOf(parts)}T${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)}` +
    `${sign}${two(Math.floor(size / 60))}:${two(size % 60)}`
  );
}

/** Which day of the week a calendar date falls on, 0 for Sunday. */
function weekdayOf(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** The ISO-8601 week number, which is the one a business quarter is counted in. */
function isoWeekOf(parts) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  /* Thursday decides the year an ISO week belongs to. */
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const opened = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - opened) / 86400000 + 1) / 7);
}

/** A minute of the day from `HH:MM`, or null where that is not one. */
function minuteOf(text) {
  const said = typeof text === 'string' ? text.trim() : '';
  const held = said.match(/^(\d{1,2}):(\d{2})$/);
  if (held === null) {
    return null;
  }
  const hour = Number(held[1]);
  const minute = Number(held[2]);
  return hour > 24 || minute > 59 ? null : hour * 60 + minute;
}

export default class OrknuxDate extends OrknuxPlugin {

  id() {
    return 'date';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'timezone',
        description:
          'The working timezone, as an IANA name (Europe/Warsaw, America/New_York). ' +
          'Left empty it is UTC, which is rarely what an office means.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'weekend',
        description:
          'Which days are not worked, by name or number (sat,sun — or fri,sat where that is the week). ' +
          'Empty is Saturday and Sunday.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'holidays',
        description:
          'The dates the office is closed, ISO and comma-separated (2026-01-01,2026-12-25). ' +
          'Point it at a variable and a year is one edit.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'opensAt',
        description: 'When the working day starts, as HH:MM. Empty is 09:00.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'closesAt',
        description: 'When the working day ends, as HH:MM. Empty is 17:00.',
        type: 'string',
        required: false,
      }),
    ];
  }

  permissions() {
    // A clock, and the world's timezone rules. Nothing else here reaches
    // anything — INTL is a language builtin, not a door.
    return ['TEMPORAL', 'INTL'];
  }

  capabilities() {
    return [];
  }

  /* The agents' surface: all of it. Date arithmetic is exactly what a model should not do in its head. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'now' }),
      new OrknuxFunctionTool({ function: 'describe' }),
      new OrknuxFunctionTool({ function: 'shift' }),
      new OrknuxFunctionTool({ function: 'shiftBusinessDays' }),
      new OrknuxFunctionTool({ function: 'businessDaysBetween' }),
      new OrknuxFunctionTool({ function: 'between' }),
      new OrknuxFunctionTool({ function: 'isBusinessHours' }),
    ];
  }

  /** The working timezone: what a call named, else what the workspace set, else UTC. */
  zoneOf(timezone) {
    const named = typeof timezone === 'string' && timezone.trim().length > 0
      ? timezone.trim()
      : typeof this.settings.timezone === 'string' && this.settings.timezone.trim().length > 0
        ? this.settings.timezone.trim()
        : 'UTC';
    try {
      /* Asked of Intl rather than checked against a list this would have to keep. */
      new Intl.DateTimeFormat('en-GB', { timeZone: named }).format(new Date(0));
    } catch {
      throw new Error(`no timezone called ${named}: it takes an IANA name like Europe/Warsaw`);
    }
    return named;
  }

  /** The days that are not worked, as day numbers. */
  weekendOf() {
    const said = typeof this.settings.weekend === 'string' ? this.settings.weekend.trim() : '';
    if (said.length === 0) {
      return [0, 6];
    }
    return said
      .split(/[,\s]+/)
      .filter((one) => one.length > 0)
      .map((one) => {
        const held = one.toLowerCase();
        if (/^[0-6]$/.test(held)) {
          return Number(held);
        }
        const found = WEEKDAYS.findIndex((name) => name === held || name.slice(0, 3) === held);
        if (found === -1) {
          throw new Error(`the weekend setting says ${one}, which is not a day of the week`);
        }
        return found;
      });
  }

  /** The dates the office is closed, as `YYYY-MM-DD`. */
  holidaysOf() {
    const said = typeof this.settings.holidays === 'string' ? this.settings.holidays : '';
    return said.split(/[,\s]+/).filter((one) => /^\d{4}-\d{2}-\d{2}$/.test(one));
  }

  /** Whether a calendar date is one the office works. */
  isWorked(parts) {
    return !this.weekendOf().includes(weekdayOf(parts)) && !this.holidaysOf().includes(dateOf(parts));
  }

  /** A date argument resolved to an instant, a bare date meaning midnight in the zone. */
  instantOf(when, zone, label) {
    const date = parsed(when, label);
    if (!bare(when)) {
      return date;
    }
    return instantOf(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      zone,
    );
  }

  /** Everything this plugin can say about one instant. */
  described(date, zone) {
    const parts = partsIn(date, zone);
    const day = weekdayOf(parts);
    return {
      iso: isoOf(date, zone),
      date: dateOf(parts),
      time: `${two(parts.hour)}:${two(parts.minute)}`,
      timezone: zone,
      offsetMinutes: offsetAt(date, zone),
      weekday: WEEKDAYS[day],
      weekdayNumber: day,
      week: isoWeekOf(parts),
      month: parts.month,
      quarter: Math.ceil(parts.month / 3),
      year: parts.year,
      weekend: this.weekendOf().includes(day),
      holiday: this.holidaysOf().includes(dateOf(parts)),
      businessDay: this.isWorked(parts),
    };
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'now',
        description:
          'What the date and time are now, in the working timezone - or in timezone when one is ' +
          'passed (an IANA name like Europe/Warsaw; empty for the configured one). Answers iso, ' +
          'date, time, weekday, week, quarter, year, and whether today is a weekend, a holiday or a ' +
          'business day. Ask this rather than assuming what day it is.',
        params: [{ name: 'timezone', type: 'string' }],
        returnType: 'map',
        run: (timezone) => {
          const zone = this.zoneOf(timezone);
          return this.described(new Date(), zone);
        },
      }),

      new OrknuxFunction({
        name: 'describe',
        description:
          'The same account of any date: iso, date, time, weekday, week, quarter, year, and whether ' +
          'it is a weekend, a holiday or a business day. Pass an ISO date (2026-09-19) or an instant ' +
          '(2026-09-19T14:30:00Z) - a bare date means midnight in the working timezone - and a ' +
          'timezone, or empty for the configured one.',
        params: [
          { name: 'when', type: 'string' },
          { name: 'timezone', type: 'string' },
        ],
        returnType: 'map',
        run: (when, timezone) => {
          const zone = this.zoneOf(timezone);
          return this.described(this.instantOf(when, zone, 'when'), zone);
        },
      }),

      new OrknuxFunction({
        name: 'shift',
        description:
          'Moves a date by a plain amount of time and answers the new one as ISO. unit is seconds, ' +
          'minutes, hours, days, weeks, months or years; amount may be negative to go back. Months ' +
          'and years keep the day of the month where they can and clamp where they cannot - 31 ' +
          'January plus one month is 28 February. This counts every day; use shiftBusinessDays to ' +
          'skip weekends and holidays.',
        params: [
          { name: 'when', type: 'string' },
          { name: 'amount', type: 'number' },
          { name: 'unit', type: 'string' },
        ],
        returnType: 'string',
        run: (when, amount, unit) => {
          const zone = this.zoneOf('');
          const from = this.instantOf(when, zone, 'when');
          const by = typeof amount === 'number' ? amount : 0;
          const named = typeof unit === 'string' ? unit.trim().toLowerCase() : '';

          const fixed = FIXED_UNITS[named] ?? FIXED_UNITS[`${named}s`];
          if (fixed !== undefined) {
            /*
             * Whole days and weeks move the wall clock, not the instant: a day
             * across a daylight-saving boundary is 23 hours or 25, and adding
             * 86,400,000 milliseconds to it lands an hour out.
             */
            if (fixed >= FIXED_UNITS.days) {
              const parts = partsIn(from, zone);
              const days = (by * fixed) / FIXED_UNITS.days;
              const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
              return isoOf(
                instantOf(
                  {
                    year: moved.getUTCFullYear(),
                    month: moved.getUTCMonth() + 1,
                    day: moved.getUTCDate(),
                    hour: parts.hour,
                    minute: parts.minute,
                    second: parts.second,
                  },
                  zone,
                ),
                zone,
              );
            }
            return isoOf(new Date(from.getTime() + by * fixed), zone);
          }

          if (named === 'month' || named === 'months' || named === 'year' || named === 'years') {
            const parts = partsIn(from, zone);
            const months = named.startsWith('year') ? by * 12 : by;
            const target = parts.month - 1 + months;
            const year = parts.year + Math.floor(target / 12);
            const month = ((target % 12) + 12) % 12;
            /* Day 0 of the next month is the last day of this one. */
            const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            return isoOf(
              instantOf(
                {
                  year: year,
                  month: month + 1,
                  day: Math.min(parts.day, last),
                  hour: parts.hour,
                  minute: parts.minute,
                  second: parts.second,
                },
                zone,
              ),
              zone,
            );
          }

          throw new Error(`no unit called ${unit}: it takes ${UNITS.join(', ')}`);
        },
      }),

      new OrknuxFunction({
        name: 'shiftBusinessDays',
        description:
          'Moves a date by working days, skipping the weekend and the configured holidays, and ' +
          'answers the date as YYYY-MM-DD. days may be negative to go back. Zero answers the same ' +
          'day where it is a working one and the next working day where it is not - which is what ' +
          '"due today" should mean on a Sunday. This is the one to use for an SLA or a due date.',
        params: [
          { name: 'when', type: 'string' },
          { name: 'days', type: 'number' },
        ],
        returnType: 'string',
        run: (when, days) => {
          const zone = this.zoneOf('');
          const parts = partsIn(this.instantOf(when, zone, 'when'), zone);
          const step = typeof days === 'number' && days < 0 ? -1 : 1;
          let left = typeof days === 'number' ? Math.abs(Math.trunc(days)) : 0;

          let walked = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
          const current = () => ({
            year: walked.getUTCFullYear(),
            month: walked.getUTCMonth() + 1,
            day: walked.getUTCDate(),
          });

          /* Zero still has to land on a working day, so it walks forward too. */
          while (!this.isWorked(current())) {
            walked = new Date(walked.getTime() + step * 86400000);
          }
          while (left > 0) {
            walked = new Date(walked.getTime() + step * 86400000);
            if (this.isWorked(current())) {
              left -= 1;
            }
          }
          return dateOf(current());
        },
      }),

      new OrknuxFunction({
        name: 'businessDaysBetween',
        description:
          'How many working days lie between two dates, skipping the weekend and the configured ' +
          'holidays. Counts from `from` up to but not including `to`, so a Monday to the Tuesday ' +
          'after it is one; negative where `to` is the earlier. Use it to ask how old a ticket is ' +
          'in working days, or whether something is past its deadline.',
        params: [
          { name: 'from', type: 'string' },
          { name: 'to', type: 'string' },
        ],
        returnType: 'number',
        run: (from, to) => {
          const zone = this.zoneOf('');
          const opened = partsIn(this.instantOf(from, zone, 'from'), zone);
          const closed = partsIn(this.instantOf(to, zone, 'to'), zone);

          let walked = new Date(Date.UTC(opened.year, opened.month - 1, opened.day));
          const end = new Date(Date.UTC(closed.year, closed.month - 1, closed.day));
          const step = walked <= end ? 1 : -1;

          let counted = 0;
          while (walked.getTime() !== end.getTime()) {
            const at = {
              year: walked.getUTCFullYear(),
              month: walked.getUTCMonth() + 1,
              day: walked.getUTCDate(),
            };
            /* Counting the day being left, which is what makes the range half-open. */
            if (step === 1 && this.isWorked(at)) {
              counted += 1;
            }
            walked = new Date(walked.getTime() + step * 86400000);
            if (step === -1) {
              const back = {
                year: walked.getUTCFullYear(),
                month: walked.getUTCMonth() + 1,
                day: walked.getUTCDate(),
              };
              if (this.isWorked(back)) {
                counted -= 1;
              }
            }
          }
          return counted;
        },
      }),

      new OrknuxFunction({
        name: 'between',
        description:
          'How much time lies between two dates, in the unit asked for: seconds, minutes, hours, ' +
          'days, weeks, months or years. Whole units, rounded towards zero, and negative where `to` ' +
          'is the earlier. Months and years are counted by the calendar rather than by an average ' +
          'length, so 1 January to 1 March is two months exactly.',
        params: [
          { name: 'from', type: 'string' },
          { name: 'to', type: 'string' },
          { name: 'unit', type: 'string' },
        ],
        returnType: 'number',
        run: (from, to, unit) => {
          const zone = this.zoneOf('');
          const opened = this.instantOf(from, zone, 'from');
          const closed = this.instantOf(to, zone, 'to');
          const named = typeof unit === 'string' ? unit.trim().toLowerCase() : '';

          const fixed = FIXED_UNITS[named] ?? FIXED_UNITS[`${named}s`];
          if (fixed !== undefined) {
            return Math.trunc((closed.getTime() - opened.getTime()) / fixed);
          }
          if (named === 'month' || named === 'months' || named === 'year' || named === 'years') {
            const a = partsIn(opened, zone);
            const b = partsIn(closed, zone);
            let months = (b.year - a.year) * 12 + (b.month - a.month);
            /* A month is not complete until the day of the month comes round. */
            if (months > 0 && b.day < a.day) {
              months -= 1;
            }
            if (months < 0 && b.day > a.day) {
              months += 1;
            }
            return named.startsWith('year') ? Math.trunc(months / 12) : months;
          }
          throw new Error(`no unit called ${unit}: it takes ${UNITS.join(', ')}`);
        },
      }),

      new OrknuxFunction({
        name: 'isBusinessHours',
        description:
          'Whether a moment falls inside the working day: a working day at all - not a weekend, not ' +
          'a configured holiday - and between the configured opening and closing times. Pass an ' +
          'empty when for now, and an empty timezone for the configured one. The gate to put in ' +
          'front of anything that should wait until somebody is at their desk.',
        params: [
          { name: 'when', type: 'string' },
          { name: 'timezone', type: 'string' },
        ],
        returnType: 'boolean',
        run: (when, timezone) => {
          const zone = this.zoneOf(timezone);
          const parts = partsIn(this.instantOf(when, zone, 'when'), zone);
          if (!this.isWorked(parts)) {
            return false;
          }

          const opens = minuteOf(this.settings.opensAt) ?? 9 * 60;
          const closes = minuteOf(this.settings.closesAt) ?? 17 * 60;
          if (typeof this.settings.opensAt === 'string' && this.settings.opensAt.trim().length > 0
            && minuteOf(this.settings.opensAt) === null) {
            throw new Error(`the opensAt setting says ${this.settings.opensAt}, which is not a time like 09:00`);
          }
          if (typeof this.settings.closesAt === 'string' && this.settings.closesAt.trim().length > 0
            && minuteOf(this.settings.closesAt) === null) {
            throw new Error(`the closesAt setting says ${this.settings.closesAt}, which is not a time like 17:00`);
          }

          const at = parts.hour * 60 + parts.minute;
          return at >= opens && at < closes;
        },
      }),
    ];
  }
}
