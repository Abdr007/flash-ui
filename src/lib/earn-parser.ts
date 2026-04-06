// ============================================
// Flash UI — Deterministic Earn Compiler (Hardened)
// ============================================
// Strict financial intent parser. No AI. No inference.
// Order-agnostic token extraction. Unit-mandatory.
// Rejects anything that isn't 100% unambiguous.

// ---- Types ----

export interface EarnInstruction {
  action: "deposit" | "withdraw";
  pool: string;
  amount: number | null;
  amount_type: "USDC" | "percent" | null; // Always USDC, never raw "USD"
  shares: number | null;
}

export interface EarnParseResult {
  status: "valid" | "invalid";
  errors: string[];
  earn: EarnInstruction | null;
}

// ---- Enums (strict) ----

const VALID_POOLS = new Set(["crypto", "defi", "gold", "meme", "wif", "fart", "ore", "stable"]);
const VALID_TOKENS = new Set(["usdc", "usd"]);
const FILLER_WORDS = new Set(["into", "from", "in", "to", "the", "pool", "earn", "of", "my", "max", "and"]);

const DEPOSIT_WORDS = new Set(["deposit", "add", "supply"]);
const WITHDRAW_WORDS = new Set(["withdraw", "remove", "redeem"]);
const ALL_ACTION_WORDS = new Set([...DEPOSIT_WORDS, ...WITHDRAW_WORDS]);

const VAGUE_WORDS = /\b(some|everything|all|best|safe|good|high|low|a\s*lot|a\s*bit|much)\b/i;
// NOTE: "max" is NOT vague for withdraw — it's a deterministic alias for 100%
const MAX_USDC_DECIMALS = 2; // USDC: 6 on-chain, but UI caps at 2 for sanity

// ---- Main Compiler ----

export function parseEarnCommand(input: string): EarnParseResult {
  const trimmed = input.trim();
  if (!trimmed) return reject(["Empty input"]);
  if (trimmed.length > 200) return reject(["Input too long"]);

  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const errors: string[] = [];

  // ---- PHASE 0: Reject multiple actions ----
  let actionCount = 0;
  for (const t of tokens) {
    if (ALL_ACTION_WORDS.has(t)) actionCount++;
  }
  if (actionCount > 1) return reject(["Multiple actions detected — one command at a time"]);

  // ---- PHASE 1: Extract Action (order-agnostic) ----
  let action: "deposit" | "withdraw" | null = null;
  for (const t of tokens) {
    if (DEPOSIT_WORDS.has(t)) { action = "deposit"; break; }
    if (WITHDRAW_WORDS.has(t)) { action = "withdraw"; break; }
  }
  if (!action) errors.push("Missing action (deposit or withdraw)");

  // ---- PHASE 2: Extract Pool (order-agnostic, strict enum) ----
  let pool: string | null = null;
  for (const t of tokens) {
    if (VALID_POOLS.has(t)) { pool = t; break; }
  }
  if (!pool) errors.push("Missing or unknown pool (crypto, defi, gold, meme, wif, fart, ore, stable)");

  // ---- PHASE 3: Reject negative numbers ----
  if (/[-]\d/.test(trimmed)) {
    errors.push("Amount must be positive");
    return reject(errors);
  }

  // ---- PHASE 4: Extract Amount with MANDATORY unit ----
  let amount: number | null = null;
  let amountType: "USDC" | "percent" | null = null;
  let shares: number | null = null;

  // Count how many value types are present (for single-value enforcement)
  const hasPct = /\d+(?:\.\d+)?\s*%/.test(trimmed);
  const hasDollar = /\$\s*\d/.test(trimmed);
  const hasTokenAmount = /\d+(?:\.\d+)?\s*(?:usdc|usd|dollars?)\b/i.test(trimmed);
  const hasShares = /\d+(?:\.\d+)?\s*shares?\b/i.test(trimmed);
  const hasMax = /\bmax\b/i.test(lower);
  const valueCount = [hasPct, hasDollar || hasTokenAmount, hasShares, hasMax].filter(Boolean).length;

  if (valueCount > 1) {
    errors.push("Mixed values — specify exactly one: $100, 100 USDC, 50%, 10 shares, or max");
    return reject(errors);
  }

  // 4a. "max" → 100% (WITHDRAW ONLY, deterministic)
  if (hasMax) {
    if (action === "deposit") {
      errors.push("\"max\" is only allowed for withdraw — specify USD amount for deposit");
    } else {
      amount = 100;
      amountType = "percent";
    }
  }

  // 4b. Percent: "50%"
  if (!amountType) {
    const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        errors.push("Percent must be between 0 and 100");
      } else {
        amount = pct;
        amountType = "percent";
      }
    }
  }

  // 4c. Dollar sign: "$100", "$100.50" → normalized to USDC
  if (!amountType) {
    const dollarMatch = trimmed.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (dollarMatch) {
      const val = parseFloat(dollarMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        amount = val;
        amountType = "USDC";
      }
    }
  }

  // 4d. Token-qualified: "100 USDC", "50.5 usd", "100 dollars" → all normalize to USDC
  if (!amountType) {
    const tokenMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(usdc|usd|dollars?)/i);
    if (tokenMatch) {
      const val = parseFloat(tokenMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        amount = val;
        amountType = "USDC";
      }
    }
  }

  // 4e. Shares: "10 shares"
  if (!amountType) {
    const sharesMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*shares?/i);
    if (sharesMatch) {
      const val = parseFloat(sharesMatch[1]);
      if (Number.isFinite(val) && val > 0) {
        shares = val;
      }
    }
  }

  // 4e. NO bare numbers — reject unqualified numbers
  // A bare number like "deposit 50 crypto" is AMBIGUOUS (50 what?)
  if (!amountType && shares === null && action) {
    // Check if there's a bare number that wasn't captured
    const remaining = tokens.filter((t) =>
      !ALL_ACTION_WORDS.has(t) && !VALID_POOLS.has(t) && !FILLER_WORDS.has(t)
      && !t.includes("%") && !t.startsWith("$")
    );
    const hasBareNumber = remaining.some((t) => /^\d+(\.\d+)?$/.test(t));
    if (hasBareNumber) {
      errors.push("Amount requires a unit — use $100, 100 USDC, 50%, or 10 shares");
    }
  }

  // ---- PHASE 5: Reject unknown tokens ----
  // If user wrote "50 SOL crypto" — SOL is not a supported earn token
  const unknownTokens = tokens.filter((t) => {
    if (ALL_ACTION_WORDS.has(t) || VALID_POOLS.has(t) || FILLER_WORDS.has(t)) return false;
    if (VALID_TOKENS.has(t) || t === "dollars" || t === "dollar") return false;
    if (/^\d/.test(t) || t.includes("%") || t.includes("$") || t === "shares" || t === "share") return false;
    if (t === "pool") return false;
    // Remaining alphabetic tokens that look like token symbols
    return /^[a-z]{2,5}$/.test(t) && !FILLER_WORDS.has(t);
  });
  // Only flag as unknown token if it looks like a crypto symbol (3-5 chars, not a pool or filler)
  for (const t of unknownTokens) {
    if (t.length >= 3 && t.length <= 5 && !VALID_POOLS.has(t)) {
      errors.push(`Unknown token "${t.toUpperCase()}" — earn uses USDC`);
      break; // One error is enough
    }
  }

  // ---- PHASE 6: Decimal precision ----
  if (amount !== null && amountType === "USDC") {
    const decMatch = String(amount).match(/\.(\d+)/);
    if (decMatch && decMatch[1].length > MAX_USDC_DECIMALS) {
      errors.push(`Too many decimals — USDC supports up to ${MAX_USDC_DECIMALS}`);
    }
  }

  // ---- PHASE 7: Action-specific validation ----
  if (action === "deposit") {
    if (amount === null || amountType === null) {
      if (!errors.some((e) => e.includes("Amount"))) {
        errors.push("Deposit requires an amount (e.g. $100, 100 USDC)");
      }
    }
    if (amountType === "percent") {
      errors.push("Deposit cannot use percent — specify USD amount");
    }
    if (shares !== null) {
      errors.push("Deposit cannot specify shares — use USD amount");
    }
    shares = null;
  }

  if (action === "withdraw") {
    if (amount === null && shares === null) {
      if (!errors.some((e) => e.includes("requires") || e.includes("Amount"))) {
        errors.push("Withdraw requires amount, percent, or shares");
      }
    }
    const specified = [amount !== null, shares !== null].filter(Boolean).length;
    if (specified > 1) {
      errors.push("Specify only one: amount, percent, or shares");
    }
  }

  // ---- PHASE 8: Numeric safety ----
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    errors.push("Amount must be a positive finite number");
    amount = null;
  }
  if (shares !== null && (!Number.isFinite(shares) || shares <= 0)) {
    errors.push("Shares must be a positive finite number");
    shares = null;
  }

  // ---- PHASE 9: Reject vague language ----
  if (VAGUE_WORDS.test(trimmed) && amount === null && shares === null) {
    errors.push("Ambiguous amount — specify exact value (e.g. $100, 50%, 10 shares)");
  }

  // ---- FINAL ASSERTION: verify structure is complete ----
  if (errors.length > 0) return reject(errors);

  // Defensive: all required fields must be non-null
  if (!action || !pool) return reject(["Incomplete instruction — missing action or pool"]);
  if (action === "deposit" && (amount === null || amountType !== "USDC")) {
    return reject(["Deposit must specify USDC amount"]);
  }
  if (action === "withdraw" && amount === null && shares === null) {
    return reject(["Withdraw must specify amount, percent, or shares"]);
  }

  return {
    status: "valid",
    errors: [],
    earn: {
      action,
      pool,
      amount,
      amount_type: amountType,
      shares,
    },
  };
}

function reject(errors: string[]): EarnParseResult {
  return { status: "invalid", errors, earn: null };
}
