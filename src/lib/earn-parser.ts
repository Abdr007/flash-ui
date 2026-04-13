// ============================================
// Flash UI — Earn Language Compiler
// ============================================
//
// GRAMMAR (BNF):
//   <command>  ::= <action> <value> <pool>
//                | <pool> <action> <value>
//                | <value> <action> <pool>
//
//   <action>   ::= "deposit" | "add" | "supply"
//                 | "withdraw" | "remove" | "redeem"
//
//   <value>    ::= <amount> | <percent> | <shares> | "max"
//   <amount>   ::= "$" NUMBER | NUMBER "usdc" | NUMBER "usd" | NUMBER "dollars"
//   <percent>  ::= NUMBER "%"
//   <shares>   ::= NUMBER "shares"
//
//   <pool>     ::= "crypto" | "defi" | "gold" | "meme" | "wif" | "fart" | "ore" | "stable"
//
// PIPELINE: Input → Lexer → Parser → AST → Verifier → Output
// GUARANTEE: No invalid AST can be constructed.

// ============================================
// Phase 0 — Token Types (Lexer Output)
// ============================================

type TokenKind =
  | "ACTION_DEPOSIT"
  | "ACTION_WITHDRAW"
  | "POOL"
  | "DOLLAR_AMOUNT" // $100
  | "TOKEN_AMOUNT" // 100 usdc
  | "PERCENT" // 50%
  | "SHARES" // 10 shares
  | "MAX" // max (withdraw-only alias for 100%)
  | "NUMBER" // bare number (invalid — no unit)
  | "FILLER" // into, from, the, etc.
  | "UNKNOWN"; // unrecognized token

interface Token {
  kind: TokenKind;
  value: string;
  numericValue?: number;
}

// ============================================
// Phase 1 — Lexer
// ============================================

const DEPOSIT_SET = new Set(["deposit", "add", "supply"]);
const WITHDRAW_SET = new Set(["withdraw", "remove", "redeem"]);
const POOL_SET = new Set([
  "crypto",
  "defi",
  "gold",
  "meme",
  "wif",
  "fart",
  "trump",
  "ore",
  "stable",
  "equity",
  "community",
]);
const FILLER_SET = new Set(["into", "from", "in", "to", "the", "pool", "earn", "of", "my", "and"]);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _TOKEN_UNITS = new Set(["usdc", "usd", "dollars", "dollar"]);

function lex(input: string): Token[] {
  const lower = input.toLowerCase().trim();
  if (!lower) return [];

  const tokens: Token[] = [];
  // Split but preserve $-prefixed numbers as single tokens
  const raw = lower.match(/\$\d+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:usdc|usd|dollars?|shares?)\b|\S+/g) ?? [];

  for (const r of raw) {
    // $100, $50.25
    if (/^\$\d+(?:\.\d+)?$/.test(r)) {
      tokens.push({ kind: "DOLLAR_AMOUNT", value: r, numericValue: parseFloat(r.slice(1)) });
      continue;
    }

    // 50%, 100%
    if (/^\d+(?:\.\d+)?%$/.test(r)) {
      tokens.push({ kind: "PERCENT", value: r, numericValue: parseFloat(r) });
      continue;
    }

    // 100 usdc, 50 usd, 10 dollars
    const tokenAmountMatch = r.match(/^(\d+(?:\.\d+)?)\s*(usdc|usd|dollars?)$/);
    if (tokenAmountMatch) {
      tokens.push({ kind: "TOKEN_AMOUNT", value: r, numericValue: parseFloat(tokenAmountMatch[1]) });
      continue;
    }

    // 10 shares
    const sharesMatch = r.match(/^(\d+(?:\.\d+)?)\s*shares?$/);
    if (sharesMatch) {
      tokens.push({ kind: "SHARES", value: r, numericValue: parseFloat(sharesMatch[1]) });
      continue;
    }

    // Actions
    if (DEPOSIT_SET.has(r)) {
      tokens.push({ kind: "ACTION_DEPOSIT", value: r });
      continue;
    }
    if (WITHDRAW_SET.has(r)) {
      tokens.push({ kind: "ACTION_WITHDRAW", value: r });
      continue;
    }

    // Pool
    if (POOL_SET.has(r)) {
      tokens.push({ kind: "POOL", value: r });
      continue;
    }

    // max
    if (r === "max") {
      tokens.push({ kind: "MAX", value: r });
      continue;
    }

    // Filler
    if (FILLER_SET.has(r)) {
      tokens.push({ kind: "FILLER", value: r });
      continue;
    }

    // Bare number (no unit — will be flagged by verifier)
    if (/^\d+(?:\.\d+)?$/.test(r)) {
      tokens.push({ kind: "NUMBER", value: r, numericValue: parseFloat(r) });
      continue;
    }

    // Unknown
    tokens.push({ kind: "UNKNOWN", value: r });
  }

  return tokens;
}

// ============================================
// Phase 2 — AST Types (Parser Output)
// ============================================

interface DepositAST {
  type: "Deposit";
  value: { type: "amount"; value: number };
  pool: string;
}

interface WithdrawAST {
  type: "Withdraw";
  value: { type: "amount"; value: number } | { type: "percent"; value: number } | { type: "shares"; value: number };
  pool: string;
}

type EarnAST = DepositAST | WithdrawAST;

// ============================================
// Phase 2 — Parser (Tokens → AST)
// ============================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _ParseError {
  errors: string[];
}
type ParseResult = { ok: true; ast: EarnAST } | { ok: false; errors: string[] };

function parse(tokens: Token[]): ParseResult {
  const errors: string[] = [];

  // Reject if no tokens
  if (tokens.length === 0) return fail(["Empty input"]);

  // ---- Extract each slot (order-agnostic) ----
  const actions = tokens.filter((t) => t.kind === "ACTION_DEPOSIT" || t.kind === "ACTION_WITHDRAW");
  const pools = tokens.filter((t) => t.kind === "POOL");
  const values = tokens.filter(
    (t) =>
      t.kind === "DOLLAR_AMOUNT" ||
      t.kind === "TOKEN_AMOUNT" ||
      t.kind === "PERCENT" ||
      t.kind === "SHARES" ||
      t.kind === "MAX",
  );
  const bareNumbers = tokens.filter((t) => t.kind === "NUMBER");
  const unknowns = tokens.filter((t) => t.kind === "UNKNOWN");

  // ---- Structural validation ----
  if (actions.length === 0) errors.push("Missing action (deposit or withdraw)");
  if (actions.length > 1) errors.push("Multiple actions — one command at a time");
  if (pools.length === 0) errors.push("Missing pool (crypto, defi, gold, meme, wif, fart, ore, stable)");
  if (pools.length > 1) errors.push("Multiple pools — specify one");
  if (values.length === 0 && bareNumbers.length === 0)
    errors.push("Missing value ($100, 100 USDC, 50%, 10 shares, or max)");
  if (values.length > 1) errors.push("Multiple values — specify exactly one");
  if (bareNumbers.length > 0 && values.length === 0)
    errors.push("Amount requires unit — use $100, 100 USDC, 50%, or 10 shares");

  // Flag unknown tokens that look like crypto symbols
  for (const u of unknowns) {
    if (/^[a-z]{2,5}$/.test(u.value) && !FILLER_SET.has(u.value)) {
      errors.push(`Unknown token "${u.value.toUpperCase()}" — earn uses USDC`);
      break;
    }
  }

  // Reject negative
  if (tokens.some((t) => t.value.includes("-") && t.numericValue !== undefined)) {
    errors.push("Amount must be positive");
  }

  if (errors.length > 0) return fail(errors);

  // ---- Build AST ----
  const action = actions[0];
  const pool = pools[0].value;
  const val = values[0];
  const isDeposit = action.kind === "ACTION_DEPOSIT";

  // Parse value node
  if (val.kind === "MAX") {
    if (isDeposit) return fail(['"max" is only for withdraw — specify USDC amount for deposit']);
    return ok({ type: "Withdraw", value: { type: "percent", value: 100 }, pool });
  }

  if (val.kind === "PERCENT") {
    const pct = val.numericValue!;
    if (pct <= 0 || pct > 100) return fail(["Percent must be between 0 and 100"]);
    if (isDeposit) return fail(["Deposit cannot use percent — specify USDC amount"]);
    return ok({ type: "Withdraw", value: { type: "percent", value: pct }, pool });
  }

  if (val.kind === "SHARES") {
    const s = val.numericValue!;
    if (s <= 0) return fail(["Shares must be positive"]);
    if (isDeposit) return fail(["Deposit cannot use shares — specify USDC amount"]);
    return ok({ type: "Withdraw", value: { type: "shares", value: s }, pool });
  }

  // DOLLAR_AMOUNT or TOKEN_AMOUNT → amount in USDC
  const amt = val.numericValue!;
  if (amt <= 0) return fail(["Amount must be positive"]);

  // Decimal precision check (USDC: max 2 in UI)
  const decMatch = String(amt).match(/\.(\d+)/);
  if (decMatch && decMatch[1].length > 2) return fail(["Too many decimals — USDC supports up to 2"]);

  if (isDeposit) {
    return ok({ type: "Deposit", value: { type: "amount", value: amt }, pool });
  }
  return ok({ type: "Withdraw", value: { type: "amount", value: amt }, pool });
}

function ok(ast: EarnAST): ParseResult {
  return { ok: true, ast };
}
function fail(errors: string[]): ParseResult {
  return { ok: false, errors };
}

// ============================================
// Phase 3 — Verifier (AST → Verified Output)
// ============================================
// Final assertion: the AST is structurally valid.
// This is a defense-in-depth check — the parser should never
// produce an invalid AST, but the verifier catches logic bugs.

export interface EarnInstruction {
  action: "deposit" | "withdraw";
  pool: string;
  amount: number | null;
  amount_type: "USDC" | "percent" | null;
  shares: number | null;
}

export interface EarnParseResult {
  status: "valid" | "invalid";
  errors: string[];
  earn: EarnInstruction | null;
}

function verify(ast: EarnAST): EarnParseResult {
  // Structural assertion: these should NEVER fire if parser is correct
  if (!ast.type || !ast.pool || !ast.value) {
    return { status: "invalid", errors: ["Internal: malformed AST"], earn: null };
  }
  if (!POOL_SET.has(ast.pool)) {
    return { status: "invalid", errors: [`Internal: invalid pool "${ast.pool}"`], earn: null };
  }

  // Deposit: must be amount type
  if (ast.type === "Deposit") {
    if (ast.value.type !== "amount") {
      return { status: "invalid", errors: ["Internal: deposit must have amount value"], earn: null };
    }
    if (!Number.isFinite(ast.value.value) || ast.value.value <= 0) {
      return { status: "invalid", errors: ["Amount must be positive"], earn: null };
    }
    return {
      status: "valid",
      errors: [],
      earn: { action: "deposit", pool: ast.pool, amount: ast.value.value, amount_type: "USDC", shares: null },
    };
  }

  // Withdraw: amount, percent, or shares
  if (ast.type === "Withdraw") {
    const v = ast.value;
    if (!Number.isFinite(v.value) || v.value <= 0) {
      return { status: "invalid", errors: ["Value must be positive"], earn: null };
    }
    if (v.type === "percent" && v.value > 100) {
      return { status: "invalid", errors: ["Percent must be ≤ 100"], earn: null };
    }

    if (v.type === "amount") {
      return {
        status: "valid",
        errors: [],
        earn: { action: "withdraw", pool: ast.pool, amount: v.value, amount_type: "USDC", shares: null },
      };
    }
    if (v.type === "percent") {
      return {
        status: "valid",
        errors: [],
        earn: { action: "withdraw", pool: ast.pool, amount: v.value, amount_type: "percent", shares: null },
      };
    }
    if (v.type === "shares") {
      return {
        status: "valid",
        errors: [],
        earn: { action: "withdraw", pool: ast.pool, amount: null, amount_type: null, shares: v.value },
      };
    }
  }

  return { status: "invalid", errors: ["Internal: unhandled AST type"], earn: null };
}

// ============================================
// Public API — Full Pipeline
// ============================================

/**
 * Compile an earn command string into a verified instruction.
 * Pipeline: Input → Lex → Parse → Verify → Output
 */
export function parseEarnCommand(input: string): EarnParseResult {
  try {
    // Reject oversized
    if (input.length > 200) return { status: "invalid", errors: ["Input too long"], earn: null };

    // Reject vague words early (before lexing)
    if (/\b(some|everything|all|best|safe|good|high|low|a\s*lot|a\s*bit|much)\b/i.test(input)) {
      return { status: "invalid", errors: ["Ambiguous — use exact values ($100, 50%, 10 shares, or max)"], earn: null };
    }

    // Reject negative numbers early
    if (/-\d/.test(input)) {
      return { status: "invalid", errors: ["Amount must be positive"], earn: null };
    }

    // Phase 1: Lex
    const tokens = lex(input);

    // Phase 2: Parse → AST
    const parsed = parse(tokens);
    if (!parsed.ok) return { status: "invalid", errors: parsed.errors, earn: null };

    // Phase 3: Verify AST → Output
    return verify(parsed.ast);
  } catch {
    return { status: "invalid", errors: ["Parse error"], earn: null };
  }
}
