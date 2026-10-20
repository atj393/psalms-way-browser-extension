import { describe, it, expect } from "vitest";
import { addDays, daysBetween, parseDateKey, toDateKey } from "../src/dateKeys.js";

describe("local calendar days", () => {
  it("formats the local day, not the UTC day", () => {
    expect(toDateKey(new Date(2026, 9, 20, 23, 30))).toBe("2026-10-20");
    expect(toDateKey(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  it("rejects keys that are not real days", () => {
    expect(parseDateKey("2026-02-31")).toBeNull();
    expect(parseDateKey("2026-13-01")).toBeNull();
    expect(parseDateKey("20261020")).toBeNull();
    expect(parseDateKey(undefined)).toBeNull();
    expect(parseDateKey("2026-10-20").getDate()).toBe(20);
  });

  it("counts whole days across months, years and DST changes", () => {
    expect(daysBetween("2026-10-20", "2026-10-21")).toBe(1);
    expect(daysBetween("2026-10-21", "2026-10-20")).toBe(-1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("bad", "2026-10-20")).toBeNull();
  });

  it("adds days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("nope", 1)).toBeNull();
  });
});
