# kid-cal

School email → calendar + Telegram reminder daemon.

Monitors an email inbox (iCloud, Yahoo, or any IMAP provider) for school communications, uses Claude to extract structured events and action items, syncs them to your calendar (iCloud or Google), and sends Telegram reminders for upcoming deadlines.

Built as a personal productivity tool, but engineered using the same reliability, idempotency, and integration discipline applied to production backend systems.

---

## Why I Built This

Managing school schedules often means:

- Email announcements buried in an inbox
- Manual calendar entry
- Missed updates and deadlines
- Fragmented reminders

Kid-Cal automates that flow. It runs as a containerized background service, turning incoming school emails into structured calendar events and pushing Telegram notifications when appropriate.

The goal was not just automation — but building it with strong engineering fundamentals.

---

## How It Works

```mermaid
sequenceDiagram
    participant IMAP as IMAP (iCloud/Yahoo)
    participant Filter as Email Filter
    participant Claude as Claude API
    participant DB as SQLite
    participant Cal as Calendar (iCloud/Google)
    participant TG as Telegram

    loop Every N minutes
        IMAP->>Filter: Fetch unseen emails
        Filter-->>IMAP: Skip non-school senders
        Filter->>Claude: School email content
        Claude-->>Filter: Events + Action Items (structured)
        Filter->>DB: Dedup check + save
        DB-->>Filter: Not duplicate
        Filter->>Cal: Create calendar events
        Filter->>Cal: Create action item reminders
        Cal-->>Filter: Calendar event IDs
        Filter->>DB: Save calendar IDs
        Filter->>TG: Alert on failure
    end

    loop Every M minutes
        DB->>TG: Morning reminders for upcoming deadlines
    end
```

---

## System Design

### Email Polling and Filtering

`EmailPoller` connects via IMAP and fetches unseen messages each cycle. Read-only — emails are never marked as read or modified. Filtering is two-stage:

- **Sender-level**: Only emails from configured school domains or addresses proceed to extraction. Non-school emails are cached in-memory to avoid re-checking them each cycle.
- **Grade-level**: Claude is instructed to extract only content relevant to the child's grade (school-wide events and middle school transition content are also kept).

Supported email providers:
- **iCloud Mail** (`imap.mail.me.com`)
- **Yahoo Mail** (`imap.mail.yahoo.com`)
- **Any IMAP provider** via custom `IMAP_HOST`/`IMAP_PORT`

### Structured Extraction via Claude

School emails are passed to Claude with a system prompt that instructs it to extract two artifact types:

- **Events** — calendar items with title, dates, location, all-day flag
- **Action Items** — deadlines with title, description, priority, due date

Output is validated against a Zod schema using the Anthropic SDK's structured output mode (`zodOutputFormat`). A post-extraction keyword filter removes any items that slipped through for the wrong grade. Past-dated events and action items are automatically skipped.

### State Management

SQLite (WAL mode, `better-sqlite3`) tracks four tables:

| Table | Purpose |
|---|---|
| `processed_emails` | Deduplication — prevents reprocessing the same email |
| `events` | Extracted calendar events + their calendar IDs |
| `action_items` | Extracted deadlines + their calendar IDs |
| `sent_reminders` | Tracks which reminders have been sent |

Cross-email deduplication runs at save time — the same event title + date from different emails won't create duplicates.

### Calendar Integration

Events and action items are written to your calendar via a provider abstraction (`CalendarProvider` interface):

- **iCloud Calendar** — CalDAV via `tsdav`, using app-specific passwords
- **Google Calendar** — service account API, using `googleapis`

Both providers use deterministic UID/iCalUID values derived from the source data, making creation idempotent. If a calendar write fails, the DB record is saved without a `calendar_event_id` and retried on the next poll cycle.

### Health Monitoring

Send `/status` to the Telegram bot for a real-time dashboard:

```
📊 kid-cal status

⏱ Uptime: 2d 3h 15m
🟢 IMAP: connected
📬 Email: icloud (user@icloud.com)
📅 Calendar: icloud

🔄 Last poll: 3m ago
✅ Last success: 3m ago
🤖 Last extraction: 1h 15m ago

📈 Totals: 288 polls, 12 extractions
📧 Processed: 50 emails (3 failed)
📅 Events: 25 (2 pending sync)
✅ Action items: 15 (1 pending sync)
🔜 Upcoming: 4 events, 6 deadlines (7d)
```

### Reminders

A scheduler runs every N minutes and sends Telegram notifications for:
- Events happening today (morning reminder)
- Events starting in 15 minutes
- Action item deadlines due today

Alerts are also sent on extraction failures and after 8 consecutive IMAP failures.

### Reliability

- Exponential backoff (1s → 4s → 16s) on all external calls
- Orphaned event retry — DB records without `calendar_event_id` are retried each cycle
- Graceful shutdown on `SIGTERM`/`SIGINT` with IMAP disconnect and DB close
- IMAP failure alerting via Telegram after 8 consecutive failures

---

## Engineering Principles

Even as a personal tool, the system is built with:

**Clear domain boundaries** — Ingestion (IMAP), extraction (Claude), persistence (SQLite), and integration adapters (calendar, Telegram) are fully separated.

**Provider abstraction** — Email and calendar providers are swappable via config. Adding a new provider means implementing a single interface.

**Idempotent sync** — Deterministic calendar IDs, cross-email deduplication, and safe reprocessing mean the daemon can be stopped and restarted without creating duplicate events.

**Explicit integration adapters** — External systems are isolated, allowing providers to be swapped (Yahoo → iCloud, Google Calendar → iCloud CalDAV), failure handling to be controlled, and each layer to be tested independently.

**Minimal operational surface** — SQLite for local reliability, Docker for deployment, no cloud infrastructure required beyond the APIs it talks to.

---

## Tech Stack

| Concern | Technology |
|---|---|
| Language | TypeScript (ESM) |
| Email | imapflow, mailparser, html-to-text |
| AI Extraction | Anthropic Claude (structured output + Zod) |
| Calendar | Google Calendar API (googleapis) or iCloud CalDAV (tsdav) |
| Notifications | Telegram Bot API |
| Database | SQLite (better-sqlite3, WAL mode) |
| Config validation | Zod |
| Logging | pino |
| Testing | Vitest (236 tests) |
| Deployment | Docker (recommended) or macOS launchd |

---

## Setup

### Prerequisites

- Docker and Docker Compose (recommended) or Node.js 20+
- An email account with IMAP access (iCloud, Yahoo, or any IMAP provider)
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
- A calendar provider: iCloud account or Google Cloud service account
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
chmod 600 .env
```

**iCloud setup:**

```env
EMAIL_PROVIDER=icloud
IMAP_USER=you@icloud.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx          # App-specific password from appleid.apple.com

CALENDAR_PROVIDER=icloud
ICLOUD_USERNAME=you@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx    # Same or separate app-specific password

SCHOOL_SENDER_DOMAINS=myschool.org,district.edu
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx...
TELEGRAM_BOT_TOKEN=1234567890:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TELEGRAM_CHAT_ID=9876543210
```

**Google Calendar + Yahoo setup:**

```env
EMAIL_PROVIDER=yahoo
IMAP_USER=you@yahoo.com
IMAP_PASSWORD=xxxxxxxxxxxx                 # App password from Yahoo account security

CALENDAR_PROVIDER=google
GOOGLE_SERVICE_ACCOUNT_EMAIL=kid-cal@my-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nXXXXX...\n-----END RSA PRIVATE KEY-----"
GOOGLE_CALENDAR_ID=xxxxxxxxxx@group.calendar.google.com

SCHOOL_SENDER_DOMAINS=myschool.org
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx...
TELEGRAM_BOT_TOKEN=1234567890:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TELEGRAM_CHAT_ID=9876543210
```

**Full reference:**

| Variable | Required | Description |
|---|---|---|
| `EMAIL_PROVIDER` | | `yahoo` or `icloud` (default: `yahoo`) — sets IMAP defaults |
| `IMAP_HOST` | | Override IMAP host (auto-set by `EMAIL_PROVIDER`) |
| `IMAP_PORT` | | Override IMAP port (default: `993`) |
| `IMAP_USER` | ✓ | Email address |
| `IMAP_PASSWORD` | ✓ | App-specific password |
| `SCHOOL_SENDER_DOMAINS` | ✓ | Comma-separated domains (e.g. `school.org`) |
| `SCHOOL_SENDER_ADDRESSES` | | Comma-separated individual addresses |
| `ANTHROPIC_API_KEY` | ✓ | Anthropic API key |
| `CLAUDE_MODEL` | | Defaults to `claude-sonnet-4-5-20250929` |
| `CALENDAR_PROVIDER` | | `google` or `icloud` (default: `google`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | google | Service account email |
| `GOOGLE_PRIVATE_KEY` | google | Service account private key |
| `GOOGLE_CALENDAR_ID` | google | Target calendar ID |
| `ICLOUD_USERNAME` | icloud | Apple ID email |
| `ICLOUD_APP_PASSWORD` | icloud | App-specific password |
| `TELEGRAM_BOT_TOKEN` | ✓ | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✓ | Telegram chat ID for notifications |
| `CHILD_GRADE` | | Child's grade (default: `5`) |
| `EXCLUDE_KEYWORDS` | | Comma-separated keywords to filter out |
| `BLOCKED_SUBJECT_KEYWORDS` | | Comma-separated subject keywords to skip entirely |
| `POLL_INTERVAL_MINUTES` | | Default: `5` |
| `REMINDER_CHECK_INTERVAL_MINUTES` | | Default: `15` |
| `TIMEZONE` | | Default: `America/New_York` |
| `MORNING_REMINDER_HOUR` | | Hour for morning reminders (default: `7`) |
| `DB_PATH` | | Default: `./kid-cal.db` |
| `LOG_LEVEL` | | `trace/debug/info/warn/error/fatal` (default: `info`) |

---

## Docker Deployment (Recommended)

```bash
git clone https://github.com/adnausea/kid-cal.git
cd kid-cal
cp .env.example .env
# Edit .env with your credentials
chmod 600 .env

docker compose up -d --build
```

### Verify

```bash
docker ps --filter name=kid-cal
docker logs -f kid-cal

# Send /status to your Telegram bot
```

### Manage

```bash
docker compose down                              # Stop
docker compose restart                           # Restart
git pull && docker compose up -d --build         # Update
```

### Security

The container runs with:
- Non-root user
- Read-only filesystem (writes only to `/data` volume)
- All Linux capabilities dropped
- `no-new-privileges` flag
- `/tmp` mounted as `noexec,nosuid`

---

## Local Development

```bash
npm install
npm run build     # Compile TypeScript
npm run dev       # Run with tsx (no compile step)
npm start         # Run compiled JS
npm test          # Run test suite (236 tests)
```

---

## macOS launchd (Alternative)

```bash
cp com.kid-cal.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.kid-cal.plist
launchctl start com.kid-cal

# Logs
tail -f kid-cal.log
tail -f kid-cal-error.log
```

---

## License

MIT
