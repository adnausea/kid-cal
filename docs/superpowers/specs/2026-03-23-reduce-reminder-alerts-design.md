# Design: Reduce Reminder Alert Frequency

**Date:** 2026-03-23
**Status:** Approved

## Overview

Reduce alerts per item from up to 4 (events) or 3 (action items) to the minimum useful set: morning-of + 15-min heads-up for events, due-today only for action items.

## Current vs Target

| Type | Current | Target |
|---|---|---|
| Events | `week_before`, `day_before`, `morning_of`, `fifteen_min_before` | `morning_of`, `fifteen_min_before` |
| Action items | `deadline_approaching`, `day_before`, `deadline_today` | `deadline_today` |

## Changes

### `src/state/manager.ts` — `getDueReminders`

**Events loop:** Remove `week_before` and `day_before` conditions. Keep only `morning_of`:

```ts
this.pushDueReminders(reminders, [
  { type: 'morning_of', condition: days <= 0 && days > -1 },
], event.id, null, { ... });
```

Shrink the lookahead from 8 days to 1: `getUpcomingEvents(1)`.

**Action items loop:** Remove `deadline_approaching` and `day_before` conditions. Keep only `deadline_today`:

```ts
this.pushDueReminders(reminders, [
  { type: 'deadline_today', condition: days <= 0 && days > -1 },
], null, item.id, { ... });
```

Shrink the lookahead from 3 days to 1: `getUpcomingActionItems(1)`.

The `fifteen_min_before` pass is unchanged.

### No other changes

- `ReminderType` union in `src/types.ts`: unchanged (unused values are harmless)
- `src/reminders/templates.ts`: unchanged
- Database schema: unchanged
- Existing `sent_reminders` rows for removed types: harmless (no new rows will be written)

## Tests

- Delete test cases for `week_before`, `day_before` (event), `deadline_approaching`, `day_before` (action item) in `tests/state/manager.test.ts`
- Add/keep test cases confirming `morning_of` and `deadline_today` still fire
- Confirm `week_before` and `deadline_approaching` no longer fire

## Files Changed

| File | Change |
|---|---|
| `src/state/manager.ts` | Remove 4 conditions from `getDueReminders`; shrink lookahead windows |
| `tests/state/manager.test.ts` | Remove tests for dropped types; add/verify tests for kept types |
