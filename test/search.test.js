import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  searchVerses,
  splitMatches,
  escapeRegExp,
  truncate,
  SEARCH_MAX,
} from "../src/search.js";

const psalms = JSON.parse(
  readFileSync(fileURLToPath(new URL("../psalms.json", import.meta.url)), "utf8")
);

describe("searchVerses", () => {
  it("finds a well-known phrase at the right reference", () => {
    const { results } = searchVerses(psalms, "my shepherd");
    expect(results.length).toBeGreaterThan(0);
    const shepherd = results.find((r) => r.chapterIndex === 22 && r.verseIndex === 0);
    expect(shepherd).toBeDefined();
    expect(shepherd.text).toContain("shepherd");
  });

  it("is case-insensitive", () => {
    const lower = searchVerses(psalms, "praise").total;
    const upper = searchVerses(psalms, "PRAISE").total;
    const mixed = searchVerses(psalms, "PrAiSe").total;
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
    expect(lower).toBeGreaterThan(0);
  });

  it("returns nothing for a query below the minimum length", () => {
    expect(searchVerses(psalms, "a").results).toEqual([]);
    expect(searchVerses(psalms, "").results).toEqual([]);
    expect(searchVerses(psalms, "   ").results).toEqual([]);
  });

  it("reports no results without throwing", () => {
    const outcome = searchVerses(psalms, "zzzzqqqxyz");
    expect(outcome.results).toEqual([]);
    expect(outcome.total).toBe(0);
    expect(outcome.truncated).toBe(false);
  });

  it("caps results and says so", () => {
    const outcome = searchVerses(psalms, "the");
    expect(outcome.results).toHaveLength(SEARCH_MAX);
    expect(outcome.total).toBeGreaterThan(SEARCH_MAX);
    expect(outcome.truncated).toBe(true);
  });

  it("does not mark a full result set as truncated", () => {
    const outcome = searchVerses(psalms, "my shepherd");
    expect(outcome.truncated).toBe(false);
    expect(outcome.total).toBe(outcome.results.length);
  });

  // Every character that means something to a regular expression, plus quotes
  // and Unicode. None of these may throw or match spuriously.
  const hostile = [
    ".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\",
    ".*", "(.*)", "[a-z]", "a{2,}", "\\d", "^the", "the$", "()", "|||",
    "''", '""', "’", "—", "…", "ü", "日本語", "🙂", "a\\", "\\\\",
  ];

  it("survives regular-expression metacharacters and Unicode", () => {
    for (const query of hostile) {
      expect(() => searchVerses(psalms, query), `query ${JSON.stringify(query)}`).not.toThrow();
      const outcome = searchVerses(psalms, query);
      expect(Array.isArray(outcome.results)).toBe(true);
    }
  });

  it("treats metacharacters literally rather than as a pattern", () => {
    // ".*" and "[a-z]" would match everything if the query were compiled as a
    // pattern rather than escaped.
    expect(searchVerses(psalms, ".*").total).toBe(0);
    expect(searchVerses(psalms, "[a-z]").total).toBe(0);
    // A full stop is still matched literally where it genuinely appears.
    expect(searchVerses(psalms, "LORD.").total).toBe(68);
  });

  it("trims surrounding whitespace from the query", () => {
    expect(searchVerses(psalms, "  shepherd  ").total).toBe(
      searchVerses(psalms, "shepherd").total
    );
  });

  it("handles a very long query", () => {
    expect(searchVerses(psalms, "x".repeat(5000)).total).toBe(0);
  });

  it("returns nothing when the data is missing", () => {
    expect(searchVerses(null, "praise").results).toEqual([]);
    expect(searchVerses(undefined, "praise").results).toEqual([]);
  });

  it("skips malformed chapters instead of failing", () => {
    const damaged = [["good verse about hope"], null, "not an array", [null, 42, "hope again"]];
    const outcome = searchVerses(damaged, "hope");
    expect(outcome.total).toBe(2);
  });
});

describe("splitMatches", () => {
  it("splits into alternating plain and matching segments", () => {
    const segments = splitMatches("The LORD is my shepherd", "lord");
    expect(segments.map((s) => s.text).join("")).toBe("The LORD is my shepherd");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["LORD"]);
  });

  it("marks every occurrence, including adjacent ones", () => {
    const segments = splitMatches("abab", "ab");
    expect(segments.filter((s) => s.match)).toHaveLength(2);
    expect(segments.map((s) => s.text).join("")).toBe("abab");
  });

  it("preserves the original casing of each match", () => {
    const segments = splitMatches("Praise the LORD. praise him.", "praise");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["Praise", "praise"]);
  });

  // Regression guard: the previous implementation reused one /g regex and
  // called .test() once per segment, which depends on lastIndex carrying over.
  it("never loses or duplicates text, across the whole book", () => {
    const queries = ["the", "lord", "praise", "god", "of the", ".", "a", "'"];
    for (const query of queries) {
      for (let c = 0; c < psalms.length; c += 7) {
        for (const verse of psalms[c]) {
          const segments = splitMatches(verse, query);
          expect(segments.map((s) => s.text).join(""), `query ${query}`).toBe(verse);
        }
      }
    }
  });

  it("marks exactly the substrings that match, and no others", () => {
    for (const query of ["the", "LORD", "."]) {
      for (let c = 0; c < psalms.length; c += 11) {
        for (const verse of psalms[c]) {
          for (const segment of splitMatches(verse, query)) {
            if (segment.match) {
              expect(segment.text.toLowerCase()).toBe(query.toLowerCase());
            } else {
              expect(segment.text.toLowerCase()).not.toContain(query.toLowerCase());
            }
          }
        }
      }
    }
  });

  it("returns the whole string unmarked for an empty query", () => {
    expect(splitMatches("hello", "")).toEqual([{ text: "hello", match: false }]);
  });

  it("does not throw on metacharacters", () => {
    for (const query of [".", "*", "(", "[", "\\", "$", "^"]) {
      expect(() => splitMatches("a.b*c(d[e\\f$g^h", query)).not.toThrow();
    }
  });
});

describe("escapeRegExp", () => {
  it("escapes every metacharacter so the result matches literally", () => {
    const raw = ".*+?^${}()|[]\\";
    const pattern = new RegExp(escapeRegExp(raw));
    expect(pattern.test(raw)).toBe(true);
    expect(pattern.test("anything else")).toBe(false);
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 96)).toBe("short");
  });
  it("adds an ellipsis when it cuts", () => {
    const result = truncate("x".repeat(200), 96);
    expect(result).toHaveLength(97);
    expect(result.endsWith("…")).toBe(true);
  });
  it("tolerates missing input", () => {
    expect(truncate(undefined)).toBe("");
    expect(truncate(null)).toBe("");
  });
});
