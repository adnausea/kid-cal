import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test getConfig fresh each time, so we use dynamic import with resetModules
describe('getConfig', () => {
  const googleEnv = {
    IMAP_USER: 'user@yahoo.com',
    IMAP_PASSWORD: 'password',
    SCHOOL_SENDER_DOMAINS: 'school.org,district.edu',
    ANTHROPIC_API_KEY: 'sk-test',
    CALENDAR_PROVIDER: 'google',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@project.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nfake\\n-----END RSA PRIVATE KEY-----',
    GOOGLE_CALENDAR_ID: 'cal-id',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '123456789',
  };

  const icloudEnv = {
    EMAIL_PROVIDER: 'icloud',
    IMAP_USER: 'user@icloud.com',
    IMAP_PASSWORD: 'app-specific-password',
    SCHOOL_SENDER_DOMAINS: 'school.org',
    ANTHROPIC_API_KEY: 'sk-test',
    CALENDAR_PROVIDER: 'icloud',
    ICLOUD_USERNAME: 'user@icloud.com',
    ICLOUD_APP_PASSWORD: 'icloud-app-pass',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '123456789',
  };

  beforeEach(() => {
    vi.resetModules();
    // Mock dotenv/config to prevent actual .env loading
    vi.mock('dotenv/config', () => ({}));
  });

  it('parses valid Google provider env successfully', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, googleEnv);

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.IMAP_USER).toBe('user@yahoo.com');
      expect(config.IMAP_HOST).toBe('imap.mail.yahoo.com');
      expect(config.IMAP_PORT).toBe(993);
      expect(config.CALENDAR_PROVIDER).toBe('google');
      expect(config.SCHOOL_SENDER_DOMAINS).toEqual(['school.org', 'district.edu']);
      expect(config.POLL_INTERVAL_MINUTES).toBe(5);
      expect(config.LOG_LEVEL).toBe('info');
    } finally {
      process.env = originalEnv;
    }
  });

  it('parses valid iCloud provider env successfully', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, icloudEnv);

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.EMAIL_PROVIDER).toBe('icloud');
      expect(config.IMAP_HOST).toBe('imap.mail.me.com');
      expect(config.IMAP_PORT).toBe(993);
      expect(config.CALENDAR_PROVIDER).toBe('icloud');
      expect(config.ICLOUD_USERNAME).toBe('user@icloud.com');
      expect(config.ICLOUD_APP_PASSWORD).toBe('icloud-app-pass');
    } finally {
      process.env = originalEnv;
    }
  });

  it('defaults EMAIL_PROVIDER to yahoo with correct IMAP defaults', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, googleEnv);
    delete process.env.EMAIL_PROVIDER;

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.EMAIL_PROVIDER).toBe('yahoo');
      expect(config.IMAP_HOST).toBe('imap.mail.yahoo.com');
      expect(config.IMAP_PORT).toBe(993);
    } finally {
      process.env = originalEnv;
    }
  });

  it('allows explicit IMAP_HOST override even with EMAIL_PROVIDER set', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, icloudEnv, {
      IMAP_HOST: 'custom.imap.server.com',
      IMAP_PORT: '995',
    });

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.IMAP_HOST).toBe('custom.imap.server.com');
      expect(config.IMAP_PORT).toBe(995);
    } finally {
      process.env = originalEnv;
    }
  });

  it('exits process on missing required fields', async () => {
    const originalEnv = { ...process.env };
    for (const key of Object.keys(googleEnv)) {
      delete process.env[key];
    }

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getConfig } = await import('../src/config.js');
      expect(() => getConfig()).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      process.env = originalEnv;
    }
  });

  it('rejects icloud calendar provider without ICLOUD_USERNAME', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, {
      ...icloudEnv,
      ICLOUD_USERNAME: undefined,
    });
    delete process.env.ICLOUD_USERNAME;

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getConfig } = await import('../src/config.js');
      expect(() => getConfig()).toThrow('process.exit called');
    } finally {
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      process.env = originalEnv;
    }
  });

  it('rejects icloud calendar provider without ICLOUD_APP_PASSWORD', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, {
      ...icloudEnv,
      ICLOUD_APP_PASSWORD: undefined,
    });
    delete process.env.ICLOUD_APP_PASSWORD;

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getConfig } = await import('../src/config.js');
      expect(() => getConfig()).toThrow('process.exit called');
    } finally {
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      process.env = originalEnv;
    }
  });

  it('rejects google calendar provider without GOOGLE_SERVICE_ACCOUNT_EMAIL', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, {
      ...googleEnv,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
    });
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getConfig } = await import('../src/config.js');
      expect(() => getConfig()).toThrow('process.exit called');
    } finally {
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      process.env = originalEnv;
    }
  });

  it('applies defaults correctly', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, googleEnv);

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.TIMEZONE).toBe('America/New_York');
      expect(config.MORNING_REMINDER_HOUR).toBe(7);
      expect(config.DB_PATH).toBe('./kid-cal.db');
      expect(config.CLAUDE_MODEL).toBe('claude-sonnet-4-5-20250929');
      expect(config.SCHOOL_SENDER_ADDRESSES).toEqual([]);
      expect(config.REMINDER_CHECK_INTERVAL_MINUTES).toBe(15);
    } finally {
      process.env = originalEnv;
    }
  });
});
