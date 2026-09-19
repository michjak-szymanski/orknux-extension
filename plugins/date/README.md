# Dates & Working Calendar

The commonest thing a workflow wants to gate on is time — is it a working day,
is the office open, is this ticket three business days old, when is it due —
and every one of those is a question a workflow expression answers badly or not
at all. They are also questions a model gets wrong with confidence: arithmetic
across month ends, weekends and daylight saving looks right and is off by one.

So this is arithmetic and nothing else. It reaches nothing, asks for no
capability, and cannot break because somebody's API changed.

## The working calendar is configuration

Which days are the weekend, which dates are holidays, and when the office opens
are facts about the workspace rather than about a call — a workflow should not
pass the holiday list to every question. `weekend` takes day names or numbers
(`sat,sun`, `fri,sat`, `5,6`), because the weekend is not Saturday and Sunday
everywhere. Point `holidays` at a variable and the year is one edit.

| Parameter | |
|-----------|---|
| `timezone` | The working timezone as an IANA name. Empty is UTC, which is rarely what an office means. |
| `weekend` | Days not worked. Empty is Saturday and Sunday. |
| `holidays` | ISO dates the office is closed, comma-separated. |
| `opensAt` / `closesAt` | The working day, as `HH:MM`. Empty is 09:00 and 17:00. |

## What it offers

All seven are fronted to agents as tools, because date arithmetic is exactly
what a model should not be doing in its head.

| Function | |
|----------|---|
| `now(timezone)` | What the date and time are now — and whether today is a weekend, a holiday or a business day. |
| `describe(when, timezone)` | The same account of any date: weekday, ISO week, quarter, and the three flags. |
| `shift(when, amount, unit)` | Move by seconds through years. Months clamp: 31 January plus one month is 28 February. |
| `shiftBusinessDays(when, days)` | Move by working days, skipping the weekend and the holidays. The one to use for a due date. |
| `businessDaysBetween(from, to)` | How many working days lie between two dates. |
| `between(from, to, unit)` | How much time lies between two dates, counted by the calendar rather than by an average month. |
| `isBusinessHours(when, timezone)` | The gate to put in front of anything that should wait until somebody is at their desk. |

## Two things worth knowing

**Whole days move the wall clock, not the instant.** A day across a
daylight-saving boundary is 23 hours or 25, so adding 86,400,000 milliseconds
to it lands an hour out. `shift` moves the calendar day and rebuilds the
instant from the zone, which is why it needs `INTL` as well as `TEMPORAL` —
`Intl.DateTimeFormat` is what knows Warsaw was two hours ahead in July and one
in November, and hand-rolling that would mean shipping a copy of the world's
timezone rules that goes stale.

**A bare date means midnight in the working timezone**, not in UTC — those are
different instants, and the first is what somebody writing `2026-09-19` means.
An empty `when` is now.

`shiftBusinessDays(when, 0)` answers the same day where it is a working one and
the next working day where it is not, which is what "due today" should mean on
a Sunday. `businessDaysBetween` counts from `from` up to but not including
`to`, so Monday to the Tuesday after it is one.
