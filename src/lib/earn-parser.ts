// ============================================
// Flash UI — Deterministic Earn Parser (Strict Compiler)
// ============================================
// Converts natural language earn commands into validated instructions.
// ZERO guessing. ZERO inference. ZERO ambiguity.
//
// Valid: "deposit 100 USDC into crypto pool"
// Valid: "withdraw 50% from defi"
// Invalid: "put money in earn" (missing pool + amount)
// Invalid: "withdraw everything" (not deterministic)
//
// Output: { status, errors, earn } — execution-safe or rejected.

// ---- Types ----

export interface EarnInstruction {
  action: "deposit" | "withdraw";
  pool: string;
  amount: number | null;
  amount_type: "USD" | "percent" | null;
  shares: number | null;
}

export interface EarnParseResult {
  status: "valid" | "invalid";
  errors: string[];
  earn: EarnInstruction | null;
}

// ---- Supported Pools (strict match only) ----

const VALID_POOLS: Record<string, string> = {
  crypto: "crypto",
  defi: "defi",
  gold: "gold",
  meme: "meme",
  wif: "wif",
  fart: "fart",
  ore: "ore",
  stable: "stable",
};

// ---- Action Synonyms (strict) ----

const DEPOSIT_WORDS = /^(deposit|add|supply)$/i;
const WITHDRAW_WORDS = /^(withdraw|remove|redeem)$/i;

// ---- Main Parser ----

export function parseEarnCommand(input: string): EarnParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { status: "invalid", errors: ["Empty input"], earn: null };
  }

  // Reject oversized input
  if (trimmed.length > 200) {
    return { status: "invalid", errors: ["Input too long"], earn: null };
  }

  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/\s+/);
  const errors: string[] = [];

  // ---- 1. Extract Action ----
  let action: "deposit" | "withdraw" | null = null;
  for (const t of tokens) {
    if (DEPOSIT_WORDS.test(t)) { action = "deposit"; break; }
    if (WITHDRAW_WORDS.test(t)) { action = "withdraw"; break; }
  }
  if (!action) {
    errors.push("Missing action (deposit or withdraw)");
  }

  // ---- 2. Extract Pool ----
  let pool: string | null = null;
  for (const t of tokens) {
    const resolved = VALID_POOLS[t];
    if (resolved) { pool = resolved; break; }
  }
  // Also check "crypto pool", "defi pool" patterns
  if (!pool) {
    for (const [name, resolved] of Object.entries(VALID_POOLS)) {
      if (lower.includes(name)) { pool = resolved; break; }
    }
  }
  if (!pool) {
    errors.push("Missing or unknown pool (crypto, defi, gold, meme, wif, fart, ore, stable)");
  }

  // ---- 3. Extract Amount / Percent / Shares ----
  let amount: number | null = null;
  let amountType: "USD" | "percent" | null = null;
  let shares: number | null = null;

  // Percent: "50%", "100%"
  const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
      amount = pct;
      amountType = "percent";
    } else {
      errors.push("Percent must be between 0 and 100");
    }
  }

  // USD: "$100", "100 USDC", "100 usd", "100"
  if (!amountType) {
    const usdMatch = trimmed.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (usdMatch) {
      const val = parseFloat(usdMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        amount = val;
        amountType = "USD";
      } else {
        errors.push("Amount must be a positive number");
      }
    }
  }
  if (!amountType) {
    const usdcMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)/i);
    if (usdcMatch) {
      const val = parseFloat(usdcMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        amount = val;
        amountType = "USD";
      }
    }
  }

  // Shares: "10 shares"
  if (!amountType) {
    const sharesMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*shares?/i);
    if (sharesMatch) {
      const val = parseFloat(sharesMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        shares = val;
      }
    }
  }

  // Bare number (only if no other match and action exists)
  if (!amountType && shares === null && action) {
    // Strip action word, pool word, filler words — find remaining number
    let cleaned = lower;
    cleaned = cleaned.replace(/\b(deposit|add|supply|withdraw|remove|redeem)\b/gi, "");
    cleaned = cleaned.replace(/\b(into|from|in|to|the|pool|earn)\b/gi, "");
    for (const p of Object.keys(VALID_POOLS)) cleaned = cleaned.replace(new RegExp(`\\b${p}\\b`, "gi"), "");
    const bareMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (bareMatch) {
      const val = parseFloat(bareMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        amount = val;
        amountType = "USD";
      }
    }
  }

  // ---- 4. Validate amount requirements ----
  if (action === "deposit") {
    if (amount === null || amountType === null) {
      errors.push("Deposit requires an amount (e.g. $100, 100 USDC)");
    }
    if (amountType === "percent") {
      errors.push("Deposit cannot use percent — specify USD amount");
    }
    if (shares !== null) {
      errors.push("Deposit cannot specify shares — use USD amount");
    }
    // Force shares null for deposit
    shares = null;
  }

  if (action === "withdraw") {
    if (amount === null && shares === null) {
      errors.push("Withdraw requires amount, percent, or shares");
    }
    // Must have exactly one
    const specified = [amount !== null, shares !== null].filter(Boolean).length;
    if (specified > 1) {
      errors.push("Specify only one: amount, percent, or shares");
    }
  }

  // ---- 5. Reject negative signs in input ----
  if (/[-][\d]/.test(trimmed) && amount !== null) {
    errors.push("Amount must be positive");
    amount = null;
    amountType = null;
  }

  // ---- 5b. Numeric safety ----
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    errors.push("Amount must be a positive finite number");
    amount = null;
  }
  if (shares !== null && (!Number.isFinite(shares) || shares <= 0)) {
    errors.push("Shares must be a positive finite number");
    shares = null;
  }

  // ---- 6. Reject ambiguous inputs ----
  const vagueWords = /\b(some|everything|all|max|best|safe|good|high|low|a lot|a bit)\b/i;
  if (vagueWords.test(trimmed) && amount === null && shares === null) {
    errors.push("Ambiguous amount — specify exact value (e.g. $100, 50%, 10 shares)");
  }

  // ---- Build result ----
  if (errors.length > 0) {
    return { status: "invalid", errors, earn: null };
  }

  return {
    status: "valid",
    errors: [],
    earn: {
      action: action!,
      pool: pool!,
      amount,
      amount_type: amountType,
      shares,
    },
  };
}
