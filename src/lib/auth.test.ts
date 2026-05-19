import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./auth";

const SECRET = "a".repeat(64);

describe("signToken()", () => {
  it("returns traderId.hex format", () => {
    const token = signToken("sam", SECRET);
    const [id, mac] = token.split(".");
    expect(id).toBe("sam");
    expect(mac).toHaveLength(64);
    expect(mac).toMatch(/^[0-9a-f]+$/);
  });

  it("produces consistent output for same inputs", () => {
    expect(signToken("sam", SECRET)).toBe(signToken("sam", SECRET));
  });

  it("produces different output for different traders", () => {
    expect(signToken("sam", SECRET)).not.toBe(signToken("friend", SECRET));
  });

  it("produces different output for different secrets", () => {
    expect(signToken("sam", SECRET)).not.toBe(signToken("sam", "b".repeat(64)));
  });

  it("handles trader IDs with dots in them", () => {
    const token = signToken("trader.one", SECRET);
    expect(verifyToken(token, SECRET)).toBe("trader.one");
  });
});

describe("verifyToken()", () => {
  it("returns traderId for valid token", () => {
    const token = signToken("sam", SECRET);
    expect(verifyToken(token, SECRET)).toBe("sam");
  });

  it("returns null for wrong secret", () => {
    const token = signToken("sam", SECRET);
    expect(verifyToken(token, "b".repeat(64))).toBeNull();
  });

  it("returns null for tampered traderId", () => {
    const token = signToken("sam", SECRET);
    const tampered = "friend." + token.split(".")[1];
    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it("returns null for tampered mac", () => {
    const token = signToken("sam", SECRET);
    const tampered = token.slice(0, -2) + "00";
    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it("returns null for token with no dot", () => {
    expect(verifyToken("nodothere", SECRET)).toBeNull();
  });

  it("returns null for mac that is too short", () => {
    expect(verifyToken("sam.abc123", SECRET)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(verifyToken("", SECRET)).toBeNull();
  });
});
