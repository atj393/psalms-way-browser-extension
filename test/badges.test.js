import { describe, it, expect } from "vitest";
import { BADGE_DEFS, awardBadges } from "../src/badges.js";

const NOW = "2026-06-10T09:30:00.000Z";
const LATER = "2026-06-17T18:00:00.000Z";
const ids = (list) => list.map((badge) => badge.id);

describe("the phone's nine badges", () => {
  it("are the phone's, in the phone's order, with its icons and keys", () => {
    expect(
      BADGE_DEFS.map(({ id, requiredDays, icon, i18nKey, i18nDescKey }) => [
        id,
        requiredDays,
        icon,
        i18nKey,
        i18nDescKey,
      ])
    ).toEqual([
      ["day1", 1, "🌱", "badge_day1", "badge_day1_desc"],
      ["day3", 3, "🔥", "badge_day3", "badge_day3_desc"],
      ["day7", 7, "⭐", "badge_day7", "badge_day7_desc"],
      ["day30", 30, "🏅", "badge_day30", "badge_day30_desc"],
      ["day90", 90, "🥈", "badge_day90", "badge_day90_desc"],
      ["day100", 100, "💯", "badge_day100", "badge_day100_desc"],
      ["day180", 180, "🥇", "badge_day180", "badge_day180_desc"],
      ["day200", 200, "💎", "badge_day200", "badge_day200_desc"],
      ["day365", 365, "👑", "badge_day365", "badge_day365_desc"],
    ]);
  });
});

describe("awardBadges", () => {
  it("awards every badge the streak has reached, each with the ISO date", () => {
    const { earned, newly } = awardBadges({}, 3, NOW);
    expect(earned).toEqual({ day1: NOW, day3: NOW });
    expect(ids(newly)).toEqual(["day1", "day3"]);
    expect(new Date(earned.day1).toISOString()).toBe(earned.day1);
  });

  it("returns the badge definitions for the ones just earned", () => {
    const { newly } = awardBadges({}, 1, NOW);
    expect(newly).toEqual([BADGE_DEFS[0]]);
  });

  it("awards nothing at a streak of 0", () => {
    const { earned, newly } = awardBadges({}, 0, NOW);
    expect(earned).toEqual({});
    expect(newly).toEqual([]);
  });

  it("awards a badge only once and keeps the date it was first earned", () => {
    const first = awardBadges({}, 7, NOW);
    const again = awardBadges(first.earned, 7, LATER);
    expect(again.newly).toEqual([]);
    expect(again.earned).toEqual(first.earned);
    expect(again.earned.day7).toBe(NOW);
  });

  it("awards only the thresholds crossed since the last time", () => {
    const first = awardBadges({}, 3, NOW);
    const next = awardBadges(first.earned, 7, LATER);
    expect(ids(next.newly)).toEqual(["day7"]);
    expect(next.earned).toEqual({ day1: NOW, day3: NOW, day7: LATER });
  });

  it("does not take a badge back when the streak falls", () => {
    const { earned, newly } = awardBadges({ day1: NOW, day3: NOW }, 1, LATER);
    expect(newly).toEqual([]);
    expect(earned).toEqual({ day1: NOW, day3: NOW });
  });

  it("awards all nine at a year", () => {
    const { earned, newly } = awardBadges({}, 400, NOW);
    expect(newly).toHaveLength(9);
    expect(Object.keys(earned)).toHaveLength(9);
  });

  it("keeps badges it does not know about, since the phone may add some", () => {
    const { earned } = awardBadges({ day500: NOW }, 1, LATER);
    expect(earned).toEqual({ day500: NOW, day1: LATER });
  });

  it("returns a new object and leaves the earned badges it was given alone", () => {
    const given = Object.freeze({ day1: NOW });
    const { earned } = awardBadges(given, 3, LATER);
    expect(earned).not.toBe(given);
    expect(given).toEqual({ day1: NOW });
  });
});
