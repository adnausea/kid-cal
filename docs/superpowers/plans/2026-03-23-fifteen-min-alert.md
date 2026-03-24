# 15-Minute Pre-Meeting Telegram Alert Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a Telegram notification 15 minutes before any timed calendar event starts, firing at any time of day with a 30-minute catch-up window for daemon downtime.

**Architecture:** Add a `fifteen_min_before` reminder type and a new private `getEventsInMinuteWindow` SQL helper using `strftime` with `localtime` for correct T-separator comparison. The scheduler is restructured to always call `getDueReminders` and split results into pre-event (always send) vs morning-window reminders (all non-`fifteen_min_before` types, gated by morning window).

**Tech Stack:** TypeScript, SQLite via better-sqlite3, Vitest, date-fns-tz

**Spec:** `docs/superpowers/specs/2026-03-23-telegram-15min-meeting-alert-design.md`

**Note:** Notifications go via Telegram (`src/reminders/telegram.ts`), not SMS. Twilio was removed in commit `cc15754`.

---

## Chunk 1: Types + Template

### Task 1: Add `fifteen_min_before` to `ReminderType`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the new type**

In `src/types.ts`, find the `ReminderType` union (line 75–80) and add `'fifteen_min_before'`:

```ts
export type ReminderType =
  | 'week_before'
  | 'day_before'
  | 'morning_of'
  | 'deadline_approaching'
  | 'deadline_today'
  | 'fifteen_min_before';
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: no errors. TypeScript will not error on missing switch cases (the `default` branch in `formatReminderMessage` catches it), but the next task adds the explicit case.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add fifteen_min_before to ReminderType"
```

---

### Task 2: Add message template for `fifteen_min_before`

**Files:**
- Modify: `src/reminders/templates.ts`
- Test: `tests/reminders/templates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/reminders/templates.test.ts` inside `describe('formatReminderMessage', ...)`:

```ts
it('formats fifteen_min_before reminder with location', () => {
  const msg = formatReminderMessage({
    type: 'event',
    reminderType: 'fifteen_min_before',
    itemId: 1,
    title: 'Staff Meeting',
    description: 'Weekly sync',
    date: '2026-03-23T14:30:00',
    location: 'Room 101',
  });
  expect(msg).toContain('🔔');
  expect(msg).toContain('STARTING SOON');
  expect(msg).toContain('Staff Meeting');
  expect(msg).toContain('2:30 PM');
  expect(msg).toContain('📍');
  expect(msg).toContain('Room 101');
  expect(msg).toContain('Weekly sync');
});

it('formats fifteen_min_before reminder without location', () => {
  const msg = formatReminderMessage({
    type: 'event',
    reminderType: 'fifteen_min_before',
    itemId: 1,
    title: 'Zoom Call',
    description: 'Parent-teacher conference',
    date: '2026-03-23T09:00:00',
    location: null,
  });
  expect(msg).toContain('STARTING SOON');
  expect(msg).not.toContain('📍');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- templates
```

Expected: 2 new tests FAIL — they hit the `default` branch and return `📋 Reminder:` instead of `🔔 STARTING SOON:`.

- [ ] **Step 3: Add the `case 'fifteen_min_before':` branch**

In `src/reminders/templates.ts`, inside the `switch` in `formatReminderMessage`, add after the `case 'morning_of':` block and before `case 'deadline_approaching':`:

```ts
case 'morning_of':
  return `📅 TODAY: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

case 'fifteen_min_before':
  return `🔔 STARTING SOON: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

case 'deadline_approaching':
```

`dateStr` uses `formatDateTime` (since `fifteen_min_before` only fires for timed events, the date will always contain `T`). `locationStr` follows the existing pattern already in the function: `reminder.location ? \`\n📍 ${reminder.location}\` : ''`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- templates
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/templates.ts tests/reminders/templates.test.ts
git commit -m "feat: add fifteen_min_before message template"
```

---

## Chunk 2: StateManager Detection

### Task 3: Add `getEventsInMinuteWindow` and `fifteen_min_before` detection

**Files:**
- Modify: `src/state/manager.ts`
- Test: `tests/state/manager.test.ts`

**Important context:**
- `getEventsInMinuteWindow` is a **private** method; it is only testable indirectly via `getDueReminders` — do not try to call it directly in tests.
- `getEventsInMinuteWindow` uses `strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ...)` which resolves at query time using the OS timezone. This matches `config.TIMEZONE` for this project (a home daemon where the OS and config timezone are always the same). Tests must insert events with `start_date` values relative to `Date.now()`, not fixed strings — otherwise the SQL window predicate will exclude them. Use `new Date(Date.now() + N * 60_000).toISOString().slice(0, 19)` to produce unzoned ISO strings matching the real data format (e.g. `2026-03-23T09:00:00`).
- The `condition` in `pushDueReminders` for `fifteen_min_before` is `minutesUntil >= -30 && minutesUntil <= 20`. This is intentionally redundant with the SQL window — it provides a defense-in-depth check using JavaScript Date arithmetic, which is independent of the SQLite `localtime` resolution.

- [ ] **Step 1: Write all failing tests**

Add a new `describe('getDueReminders - fifteen_min_before', ...)` block to `tests/state/manager.test.ts`, inside the outer `describe('StateManager', ...)`, after the existing `getDueReminders` describe block:

```ts
describe('getDueReminders - fifteen_min_before', () => {
  beforeEach(() => {
    manager.saveProcessedEmail({
      messageId: 'email-fmb',
      from: 'teacher@school.org',
      subject: 'Meeting',
      processedAt: new Date().toISOString(),
      status: 'success',
      errorMessage: null,
      eventCount: 1,
      actionItemCount: 0,
    });
  });

  // Inserts a timed event (all_day=false) starting N minutes from now.
  // start_date must be local time (YYYY-MM-DDTHH:MM:SS, no timezone suffix) to match the
  // stored format AND the SQL strftime('now', 'localtime') comparison.
  // Do NOT use toISOString() — that returns UTC and will produce wrong comparisons in non-UTC environments.
  function toLocalISO(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function insertTimedEvent(minutesFromNow: number): ReturnType<typeof manager.saveEvent> {
    const startDate = toLocalISO(new Date(Date.now() + minutesFromNow * 60_000));
    return manager.saveEvent({
      title: `Event in ${minutesFromNow}min`,
      description: 'Test event',
      startDate,
      endDate: null,
      allDay: false,
      location: 'Room 1',
      sourceEmailId: 'email-fmb',
    });
  }

  it('fires fifteen_min_before for a timed event starting in 10 minutes', () => {
    insertTimedEvent(10);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    const r = reminders.find(r => r.reminderType === 'fifteen_min_before');
    expect(r).toBeDefined();
    expect(r!.title).toBe('Event in 10min');
  });

  it('fires fifteen_min_before at exactly +20 minutes (closed upper bound)', () => {
    insertTimedEvent(20);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
  });

  it('does NOT fire at +21 minutes', () => {
    insertTimedEvent(21);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
  });

  it('fires fifteen_min_before at exactly -30 minutes (closed lower bound, catch-up)', () => {
    insertTimedEvent(-30);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
  });

  it('does NOT fire at -31 minutes (outside catch-up window)', () => {
    insertTimedEvent(-31);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
  });

  it('fires for an event that started 15 minutes ago (within catch-up)', () => {
    insertTimedEvent(-15);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
  });

  it('does NOT fire for an all-day event even if its start_date is within the window', () => {
    // Insert with allDay=true but start_date within window — SQL all_day=0 guard must exclude it.
    // Must use toLocalISO (not toISOString) so the stored value matches the localtime SQL window.
    const startDate = toLocalISO(new Date(Date.now() + 10 * 60_000));
    manager.saveEvent({
      title: 'All Day Event',
      description: 'No time',
      startDate,
      endDate: null,
      allDay: true,
      location: null,
      sourceEmailId: 'email-fmb',
    });
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
  });

  it('does NOT fire if already sent', () => {
    const event = insertTimedEvent(10);
    manager.saveReminder(event.id, null, 'fifteen_min_before', 'MSG_old');
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
  });

  it('returns both morning_of and fifteen_min_before for a timed event starting in 10 minutes', () => {
    // This test covers two code paths: getUpcomingEvents(8) produces morning_of,
    // getEventsInMinuteWindow(-30, 20) produces fifteen_min_before — both run in getDueReminders.
    insertTimedEvent(10);
    const reminders = manager.getDueReminders(new Date(), 'America/New_York');
    expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
    expect(reminders.find(r => r.reminderType === 'morning_of')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- manager
```

Expected: all 9 new tests FAIL — `fifteen_min_before` reminders are never returned.

- [ ] **Step 3: Add `getEventsInMinuteWindow` private method**

In `src/state/manager.ts`, add after `getUpcomingActionItems` and before `getEmailSubject` (around line 184):

```ts
private getEventsInMinuteWindow(fromMinutes: number, toMinutes: number): StoredEvent[] {
  return this.db.prepare(`
    SELECT * FROM events
    WHERE all_day = 0
      AND start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
      AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
    ORDER BY start_date ASC
  `).all(fromMinutes, toMinutes) as StoredEvent[];
}
```

Note: passing `-30` and `20` as integers. SQLite's `||` coerces integers to strings, so `-30 || ' minutes'` → `'-30 minutes'`, which is a valid SQLite modifier.

- [ ] **Step 4: Add `fifteen_min_before` pass to `getDueReminders`**

In `src/state/manager.ts`, inside `getDueReminders`, after the action items loop's closing `}` (after line ~243), add:

```ts
// fifteen_min_before: timed events starting within next 20 min or up to 30 min ago.
// The SQL window is a coarse filter; the minutesUntil check is defense-in-depth using
// JS Date arithmetic (both use local time via new Date(unzoned string)).
const nearEvents = this.getEventsInMinuteWindow(-30, 20);
for (const event of nearEvents) {
  const minutesUntil = (new Date(event.start_date).getTime() - now.getTime()) / 60_000;
  this.pushDueReminders(reminders, [
    { type: 'fifteen_min_before', condition: minutesUntil >= -30 && minutesUntil <= 20 },
  ], event.id, null, {
    type: 'event',      // <-- must be 'event', not 'action_item'
    itemId: event.id,
    title: event.title,
    description: event.description,
    date: event.start_date,
    location: event.location,
  });
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- manager
```

Expected: all tests pass including the 9 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/state/manager.ts tests/state/manager.test.ts
git commit -m "feat: detect fifteen_min_before reminders via getEventsInMinuteWindow"
```

---

## Chunk 3: Scheduler Restructure

### Task 4: Restructure `checkAndSendReminders` to support any-time-of-day sending

**Files:**
- Modify: `src/reminders/scheduler.ts`
- Test: `tests/reminders/scheduler.test.ts`

**Important context:**
- All non-`fifteen_min_before` reminder types (`week_before`, `day_before`, `morning_of`, `deadline_approaching`, `deadline_today`) are treated as `morningReminders` — gated by the morning window. The split is `r.reminderType === 'fifteen_min_before'` vs everything else.
- The existing tests `'returns 0 when outside reminder window (too early)'` (hour=5) and `'returns 0 when outside reminder window (too late)'` (hour=13) assert `getDueReminders` is NOT called. After the refactor, `getDueReminders` is always called. Both tests must be updated.
- `makeStateManager` in the test file creates a mock object with `getDueReminders` and `saveReminder` — it already supports returning any `DueReminder[]`. No changes to the factory are needed.

- [ ] **Step 1: Write the new failing tests**

Add to `tests/reminders/scheduler.test.ts` inside `describe('checkAndSendReminders', ...)`:

```ts
it('sends fifteen_min_before reminder outside morning window (3pm)', async () => {
  mockToZonedTime.mockReturnValue({ getHours: () => 15 }); // 3pm, outside window
  mockSendNotification.mockResolvedValue('MSG_pre');

  const dueReminders: DueReminder[] = [
    {
      type: 'event',
      reminderType: 'fifteen_min_before',
      itemId: 10,
      title: 'Afternoon Meeting',
      description: 'Weekly sync',
      date: '2026-03-23T15:10:00',
      location: null,
    },
  ];

  const sm = makeStateManager(dueReminders);
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(1);
  expect(mockSendNotification).toHaveBeenCalledOnce();
  expect(sm.saveReminder).toHaveBeenCalledWith(10, null, 'fifteen_min_before', 'MSG_pre');
});

it('does NOT send morning_of reminder outside morning window (3pm)', async () => {
  mockToZonedTime.mockReturnValue({ getHours: () => 15 }); // 3pm, outside window

  const dueReminders: DueReminder[] = [
    {
      type: 'event',
      reminderType: 'morning_of',
      itemId: 11,
      title: 'Some Event',
      description: 'Desc',
      date: '2026-03-23T08:00:00',
      location: null,
    },
  ];

  const sm = makeStateManager(dueReminders);
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(0);
  expect(mockSendNotification).not.toHaveBeenCalled();
});

it('sends both morning_of and fifteen_min_before inside morning window (9am)', async () => {
  mockToZonedTime.mockReturnValue({ getHours: () => 9 }); // 9am, inside window
  mockSendNotification.mockResolvedValue('MSG_both');

  const dueReminders: DueReminder[] = [
    {
      type: 'event',
      reminderType: 'morning_of',
      itemId: 20,
      title: 'Morning Event',
      description: '',
      date: '2026-03-23T09:00:00',
      location: null,
    },
    {
      type: 'event',
      reminderType: 'fifteen_min_before',
      itemId: 20,
      title: 'Morning Event',
      description: '',
      date: '2026-03-23T09:00:00',
      location: null,
    },
  ];

  const sm = makeStateManager(dueReminders);
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(2);
  expect(mockSendNotification).toHaveBeenCalledTimes(2);
});

it('sends fifteen_min_before at midnight (outside morning window)', async () => {
  mockToZonedTime.mockReturnValue({ getHours: () => 0 }); // midnight

  mockSendNotification.mockResolvedValue('MSG_midnight');

  const dueReminders: DueReminder[] = [
    {
      type: 'event',
      reminderType: 'fifteen_min_before',
      itemId: 30,
      title: 'Late Event',
      description: '',
      date: '2026-03-23T00:10:00',
      location: null,
    },
  ];

  const sm = makeStateManager(dueReminders);
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(1);
  expect(mockSendNotification).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Update the two existing outside-window tests**

Replace the two tests that assert `getDueReminders` is NOT called:

```ts
it('returns 0 when outside morning window with no pre-event reminders (too early)', async () => {
  mockToZonedTime.mockReturnValue({ getHours: () => 5 }); // 5am, before 7am window

  const sm = makeStateManager(); // no due reminders
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(0);
  expect(sm.getDueReminders).toHaveBeenCalled(); // always called after refactor
  expect(mockSendNotification).not.toHaveBeenCalled();
});

it('returns 0 when outside morning window with only morning reminders (too late)', async () => {
  // hour=13 is past windowEnd (MORNING_REMINDER_HOUR=7, windowEnd=12).
  // getDueReminders IS called (always now), but the morning_of reminder is filtered out.
  // count is 0, sendNotification is never called.
  mockToZonedTime.mockReturnValue({ getHours: () => 13 }); // 1pm, after window ends at noon

  const dueReminders: DueReminder[] = [
    {
      type: 'event',
      reminderType: 'morning_of',
      itemId: 1,
      title: 'Event',
      description: '',
      date: '2026-03-23T09:00:00',
      location: null,
    },
  ];

  const sm = makeStateManager(dueReminders);
  const count = await checkAndSendReminders(sm);

  expect(count).toBe(0);
  expect(sm.getDueReminders).toHaveBeenCalled(); // always called after refactor
  expect(mockSendNotification).not.toHaveBeenCalled(); // morning_of is skipped outside window
});
```

- [ ] **Step 3: Run tests to confirm all new/updated tests fail**

```bash
npm test -- scheduler
```

Expected: 4 new tests FAIL + 2 updated tests FAIL (due to `not.toHaveBeenCalled` assertions still present in the old code path).

- [ ] **Step 4: Replace `checkAndSendReminders` body in `src/reminders/scheduler.ts`**

Replace the entire function with:

```ts
export async function checkAndSendReminders(stateManager: StateManager): Promise<number> {
  const config = getConfig();
  const now = new Date();
  const zonedNow = toZonedTime(now, config.TIMEZONE);
  const currentHour = zonedNow.getHours();
  const windowEnd = config.MORNING_REMINDER_HOUR + 5; // e.g., 7am–12pm

  const dueReminders = stateManager.getDueReminders(now, config.TIMEZONE);

  if (dueReminders.length === 0) {
    logger.debug('No due reminders');
    return 0;
  }

  // fifteen_min_before fires any time of day; all other types are morning-window only
  const preEventReminders = dueReminders.filter(r => r.reminderType === 'fifteen_min_before');
  const morningReminders  = dueReminders.filter(r => r.reminderType !== 'fifteen_min_before');

  const withinMorningWindow =
    currentHour >= config.MORNING_REMINDER_HOUR && currentHour < windowEnd;

  if (!withinMorningWindow && morningReminders.length > 0) {
    logger.debug(
      { currentHour, morningHour: config.MORNING_REMINDER_HOUR, windowEnd, count: morningReminders.length },
      'Outside morning window, skipping morning reminders',
    );
  }

  const remindersToSend = withinMorningWindow
    ? [...preEventReminders, ...morningReminders]
    : preEventReminders;

  if (remindersToSend.length === 0) {
    return 0;
  }

  logger.info({ count: remindersToSend.length }, 'Found due reminders');

  let sentCount = 0;
  for (const reminder of remindersToSend) {
    try {
      const message = formatReminderMessage(reminder);
      const sid = await sendNotification(message);

      const eventId = reminder.type === 'event' ? reminder.itemId : null;
      const actionItemId = reminder.type === 'action_item' ? reminder.itemId : null;

      stateManager.saveReminder(eventId, actionItemId, reminder.reminderType, sid);
      sentCount++;

      logger.info(
        { reminderType: reminder.reminderType, title: reminder.title, sid },
        'Reminder sent',
      );
    } catch (error) {
      logger.error(
        { error, reminderType: reminder.reminderType, title: reminder.title },
        'Failed to send reminder',
      );
    }
  }

  return sentCount;
}
```

- [ ] **Step 5: Run all tests to confirm they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/reminders/scheduler.ts tests/reminders/scheduler.test.ts
git commit -m "feat: restructure scheduler to send fifteen_min_before at any time of day"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Deploy and verify daemon starts cleanly**

```bash
npm run build && launchctl stop com.kid-cal && launchctl start com.kid-cal
```

```bash
tail -20 kid-cal.log
```

Expected: `kid-cal starting up` → `Database initialized` → `IMAP connected` with no errors.
