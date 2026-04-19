import 'dotenv/config';
import { z } from 'zod';

const EMAIL_PROVIDER_DEFAULTS: Record<string, { host: string; port: number }> = {
  yahoo: { host: 'imap.mail.yahoo.com', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 },
};

const configSchema = z.object({
  // Email provider ('yahoo' | 'icloud' | custom via IMAP_HOST/IMAP_PORT)
  EMAIL_PROVIDER: z.enum(['yahoo', 'icloud']).default('yahoo'),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().optional(),
  IMAP_USER: z.string(),
  IMAP_PASSWORD: z.string(),

  // School email filtering
  SCHOOL_SENDER_DOMAINS: z.string().transform((s) => s.split(',').map((d) => d.trim().toLowerCase())),
  SCHOOL_SENDER_ADDRESSES: z.string().default('').transform((s) =>
    s ? s.split(',').map((a) => a.trim().toLowerCase()) : []
  ),

  // Claude API
  ANTHROPIC_API_KEY: z.string(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  // Calendar provider ('google' | 'icloud')
  CALENDAR_PROVIDER: z.enum(['google', 'icloud']).default('google'),

  // Google Calendar (required when CALENDAR_PROVIDER=google)
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional().transform((s) => s?.replace(/\\n/g, '\n')),
  GOOGLE_CALENDAR_ID: z.string().optional(),

  // iCloud Calendar (required when CALENDAR_PROVIDER=icloud)
  ICLOUD_USERNAME: z.string().optional(),
  ICLOUD_APP_PASSWORD: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_CHAT_ID: z.string(),

  // Polling
  POLL_INTERVAL_MINUTES: z.coerce.number().default(5),
  REMINDER_CHECK_INTERVAL_MINUTES: z.coerce.number().default(15),

  // Timezone and reminder settings
  TIMEZONE: z.string().default('America/New_York'),
  MORNING_REMINDER_HOUR: z.coerce.number().min(0).max(23).default(7),

  // Database
  DB_PATH: z.string().default('./kid-cal.db'),

  // Grade filtering
  CHILD_GRADE: z.string().default('5'),
  EXCLUDE_KEYWORDS: z.string().default('').transform((s) =>
    s ? s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) : []
  ),

  // Subject-line filtering — emails whose subject contains any of these strings are skipped entirely
  BLOCKED_SUBJECT_KEYWORDS: z.string().default('').transform((s) =>
    s ? s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) : []
  ),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
}).transform((data) => {
  // Resolve IMAP host/port from provider defaults if not explicitly set
  const providerDefaults = EMAIL_PROVIDER_DEFAULTS[data.EMAIL_PROVIDER]!;
  return {
    ...data,
    IMAP_HOST: data.IMAP_HOST ?? providerDefaults.host,
    IMAP_PORT: data.IMAP_PORT ?? providerDefaults.port,
  };
}).superRefine((data, ctx) => {
  if (data.CALENDAR_PROVIDER === 'google') {
    if (!data.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GOOGLE_SERVICE_ACCOUNT_EMAIL is required when CALENDAR_PROVIDER=google', path: ['GOOGLE_SERVICE_ACCOUNT_EMAIL'] });
    }
    if (!data.GOOGLE_PRIVATE_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GOOGLE_PRIVATE_KEY is required when CALENDAR_PROVIDER=google', path: ['GOOGLE_PRIVATE_KEY'] });
    }
    if (!data.GOOGLE_CALENDAR_ID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GOOGLE_CALENDAR_ID is required when CALENDAR_PROVIDER=google', path: ['GOOGLE_CALENDAR_ID'] });
    }
  }
  if (data.CALENDAR_PROVIDER === 'icloud') {
    if (!data.ICLOUD_USERNAME) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ICLOUD_USERNAME is required when CALENDAR_PROVIDER=icloud', path: ['ICLOUD_USERNAME'] });
    }
    if (!data.ICLOUD_APP_PASSWORD) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ICLOUD_APP_PASSWORD is required when CALENDAR_PROVIDER=icloud', path: ['ICLOUD_APP_PASSWORD'] });
    }
  }
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = configSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid configuration:');
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
