# Design: Telegram 15-Minute Pre-Meeting Alert

**Date:** 2026-03-23
**Status:** Approved

## Overview

Send a Telegram notification 15 minutes before a timed calendar event starts. Uses the existing polling loop, `sent_reminders` dedup, and Telegram infrastructure. Fires at any time of day (not gated to the morning window).

## Scope

- Applies to **timed events only** (events with a specific start time — `start_date` contains `T`)
- Does **not** apply to all-day events or action item deadlines
- Fires even if the daemon was briefly offline (catch-up window up to 30 min after start)

## Data Model

Add `'fifteen_min_before'` to the `ReminderType` union in `types.ts`:

```ts
export type ReminderType =
  | 'week_before'
  | 'day_before'
  | 'morning_of'
  | 'deadline_approaching'
  | 'deadline_today'
  | 'fifteen_min_before';
```

No database schema changes required. The `sent_reminders` table stores `reminder_type` as a string and already handles any value in the union.

## Reminder Detection (`StateManager.getDueReminders`)

Add a `fifteen_min_before` check inside the existing event loop in `getDueReminders`. The check fires when:

- `event.start_date` contains `T` (timed event, not all-day)
- Event start is between `now - 30min` and `now + 20min`

**Window rationale:**
- `+20min` upper bound: absorbs 5-min poll jitter so the first cycle that sees an event within ~15 min triggers the alert
- `-30min` lower bound: catch-up window if the daemon was offline — sends up to 30 min after the meeting started, then stops

Dedup via `isReminderSent` ensures it fires exactly once per event.

```
minutesUntil = (event.start_date - now) / 60_000
fire if: -30 <= minutesUntil <= 20  AND  not already sent
```

## Scheduler Changes (`scheduler.ts`)

The existing `checkAndSendReminders` function skips all checks outside the morning window (e.g. 7am–noon). The `fifteen_min_before` type must bypass this gate.

Change: call `getDueReminders` unconditionally on every cycle. Split the result:
- Morning-window types (`week_before`, `day_before`, `morning_of`, `deadline_approaching`, `deadline_today`): only send if within the morning window (existing behaviour preserved)
- `fifteen_min_before`: always send, regardless of time of day

## Message Template (`templates.ts`)

Add a `fifteen_min_before` case to `formatReminderMessage`:

```
🔔 STARTING SOON: <title>
<datetime>
📍 <location>   ← omitted if no location
<description>
```

Example: `🔔 STARTING SOON: LS: Printemps des Arts\nFri, Mar 27 at 4:30 PM\n📍 Oak Campus\n...`

## Error Handling

No changes to error handling. Failures to send are already caught and logged per-reminder in the existing scheduler loop.

## Tests

### `getDueReminders` (StateManager)

| Scenario | Expected |
|---|---|
| Timed event starting in 10 min | fires `fifteen_min_before` |
| Timed event starting in 21 min | does NOT fire |
| Timed event started 15 min ago (within catch-up) | fires |
| Timed event started 31 min ago (outside catch-up) | does NOT fire |
| All-day event (`all_day = 1`, no `T` in date) | does NOT fire |
| Already sent (`isReminderSent` returns true) | does NOT fire |

### `formatReminderMessage` (templates)

| Scenario | Expected |
|---|---|
| `fifteen_min_before` with location | correct emoji, "STARTING SOON", includes location |
| `fifteen_min_before` without location | no location line |

### `checkAndSendReminders` (scheduler)

| Scenario | Expected |
|---|---|
| Called at 3pm (outside morning window), timed event in 10 min | `fifteen_min_before` fires |
| Called at 3pm, `morning_of` due | does NOT fire |
| Called at 9am (inside morning window), both `morning_of` and `fifteen_min_before` due | both fire |
| Called at midnight, `fifteen_min_before` due | fires |

## Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Add `'fifteen_min_before'` to `ReminderType` |
| `src/state/manager.ts` | Add `fifteen_min_before` check in `getDueReminders` |
| `src/reminders/scheduler.ts` | Bypass morning-window gate for `fifteen_min_before` |
| `src/reminders/templates.ts` | Add `fifteen_min_before` case to `formatReminderMessage` |
| `tests/state/manager.test.ts` | New test cases |
| `tests/reminders/templates.test.ts` | New test cases |
| `tests/reminders/scheduler.test.ts` | New test cases |
