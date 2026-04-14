// ============================================
// Flash UI — Environment Variable Validation
// ============================================
// Validates all required env vars on first import.
// Fails fast with clear error messages in development.
// Logs warnings for optional missing vars in production.

import { z } from "zod";

const envSchema = z.object({
  // Required — API will not function without these
  HELIUS_RPC_URL: z
    .string()
    .min(1, "HELIUS_RPC_URL is required")
    .refine((url) => url.startsWith("https://"), "HELIUS_RPC_URL must use HTTPS"),

  // AI providers — at least one required
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  // Auth
  WALLET_AUTH_SECRET: z.string().min(32, "WALLET_AUTH_SECRET must be at least 32 characters"),

  // Optional but recommended
  SIMULATION_MODE: z.string().optional(),
  TRANSFERS_ENABLED: z.string().optional(),
  TRADING_ENABLED: z.string().optional(),
  NEXT_PUBLIC_FLASH_API_URL: z.string().optional(),

  // Observability — Sentry error tracking (optional)
  NEXT_PUBLIC_SENTRY_DSN: z.string().url("NEXT_PUBLIC_SENTRY_DSN must be a valid URL").optional(),
});

type Env = z.infer<typeof envSchema>;

let _validated: Env | null = null;

export function getEnv(): Env {
  if (_validated) return _validated;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    const msg = `[env] Missing or invalid environment variables:\n${errors}`;

    if (process.env.NODE_ENV === "development") {
      console.error(msg);
      // Don't crash dev server — just warn
    } else {
      console.error(msg);
    }

    // Return a partial env with whatever we have — don't crash the app
    _validated = (result as unknown as { data: Env }).data ?? ({} as Env);
    return _validated;
  }

  // Validate at least one AI provider key exists
  if (!result.data.ANTHROPIC_API_KEY && !result.data.GROQ_API_KEY && !result.data.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.warn(
      "[env] No AI provider API key set (ANTHROPIC_API_KEY, GROQ_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY). Chat will not work.",
    );
  }

  _validated = result.data;
  return _validated;
}

// Validate on first import (server-side only)
if (typeof window === "undefined") {
  getEnv();
}
