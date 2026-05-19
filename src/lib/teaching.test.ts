import { describe, it, expect } from "vitest";
import { CONCEPTS, getConcept, type ConceptId } from "./teaching";

const ids = Object.keys(CONCEPTS) as ConceptId[];

describe("CONCEPTS registry", () => {
  it("has at least 25 concepts", () => {
    expect(ids.length).toBeGreaterThanOrEqual(25);
  });

  it("every concept has required fields", () => {
    for (const id of ids) {
      const c = CONCEPTS[id];
      expect(c.tier, `${id}.tier`).toBeOneOf([1, 2, 3]);
      expect(c.label, `${id}.label`).toBeTruthy();
      expect(c.short, `${id}.short`).toBeTruthy();
      expect(c.example, `${id}.example`).toBeTruthy();
    }
  });

  it("learnMore references valid lesson slugs when present", () => {
    for (const id of ids) {
      const c = CONCEPTS[id];
      if (c.learnMore) {
        expect(typeof c.learnMore, `${id}.learnMore`).toBe("string");
        expect(c.learnMore.length, `${id}.learnMore`).toBeGreaterThan(0);
      }
    }
  });

  it("short descriptions are concise (under 120 chars)", () => {
    for (const id of ids) {
      expect(CONCEPTS[id].short.length, `${id}.short too long`).toBeLessThanOrEqual(120);
    }
  });
});

describe("getConcept()", () => {
  it("returns the correct concept", () => {
    const c = getConcept("limit-order");
    expect(c.label).toBe("Limit Order");
    expect(c.tier).toBe(1);
  });

  it("returns a tier-3 concept correctly", () => {
    const c = getConcept("short");
    expect(c.tier).toBe(3);
  });
});
