import { AppError, isAppError } from "../errors";

describe("AppError", () => {
  it("creates with code and auto-maps severity", () => {
    const err = new AppError("test", "VALIDATION_ERROR");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.severity).toBe("low");
    expect(err.statusCode).toBe(400);
  });

  it("creates with critical code", () => {
    const err = new AppError("boom", "INTERNAL_ERROR");
    expect(err.severity).toBe("critical");
    expect(err.statusCode).toBe(500);
  });

  it("accepts custom severity override", () => {
    const err = new AppError("test", "VALIDATION_ERROR", { severity: "critical" });
    expect(err.severity).toBe("critical");
  });

  it("includes context", () => {
    const err = new AppError("test", "RPC_ERROR", { context: { endpoint: "/api/rpc" } });
    expect(err.context?.endpoint).toBe("/api/rpc");
  });
});

describe("isAppError", () => {
  it("returns true for AppError", () => {
    expect(isAppError(new AppError("test", "AUTH_ERROR"))).toBe(true);
  });

  it("returns false for regular Error", () => {
    expect(isAppError(new Error("test"))).toBe(false);
  });

  it("matches specific code", () => {
    const err = new AppError("test", "RATE_LIMITED");
    expect(isAppError(err, "RATE_LIMITED")).toBe(true);
    expect(isAppError(err, "AUTH_ERROR")).toBe(false);
  });
});
