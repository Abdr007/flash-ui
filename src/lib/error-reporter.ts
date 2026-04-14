// ============================================
// Flash UI — Error Reporter
// ============================================
// Centralized error reporting. Currently logs to console (structured JSON).
// When Sentry DSN is configured, automatically reports to Sentry.
// Zero-config: works without Sentry installed.

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

interface ErrorContext {
  wallet?: string;
  tool?: string;
  route?: string;
  trace_id?: string;
  [key: string]: unknown;
}

let _sentryModule: { captureException: (err: unknown, ctx?: unknown) => void } | null = null;

async function getSentry() {
  if (_sentryModule) return _sentryModule;
  if (!SENTRY_DSN) return null;
  try {
    // Dynamic import — package may not be installed, that's OK (catch handles it)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@sentry/nextjs") as { captureException: (err: unknown, ctx?: unknown) => void };
    _sentryModule = mod;
    return mod;
  } catch {
    return null;
  }
}

const SENSITIVE_RE = /sk-ant-[^\s]+|gsk_[^\s]+|api[_-]?key=[^\s&]+|Bearer\s+[^\s]+/gi;
function scrub(s: string | undefined): string | undefined {
  return s?.replace(SENSITIVE_RE, "***");
}

export async function reportError(err: unknown, context?: ErrorContext): Promise<void> {
  // Always log structured error to stdout (Vercel log drain picks this up)
  const message = scrub(err instanceof Error ? err.message : String(err));
  const stack = scrub(err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" | ") : undefined);
  const safeContext = context
    ? { ...context, wallet: context.wallet ? `${context.wallet.slice(0, 6)}...` : undefined }
    : undefined;
  console.error(
    JSON.stringify({
      _type: "error_report",
      message,
      stack,
      ...safeContext,
      timestamp: new Date().toISOString(),
    }),
  );

  // If Sentry is configured, report there too
  const sentry = await getSentry();
  if (sentry) {
    sentry.captureException(err, { extra: context });
  }
}

export function reportErrorSync(err: unknown, context?: ErrorContext): void {
  // Fire-and-forget async reporting
  reportError(err, context).catch(() => {});
}
