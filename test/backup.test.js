import { describe, it, expect } from "vitest";
import {
  createBackup,
  parseBackup,
  backupFileName,
  BackupError,
  BACKUP_TYPE,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
} from "../src/backup.js";

const sampleStore = {
  schemaVersion: 2,
  favourites: [{ chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 }],
  notes: [
    {
      id: "n_22_0",
      chapterIndex: 22,
      verseIndex: 0,
      text: "Read at a hard time.",
      createdAt: 1730000000000,
      updatedAt: 1730000000000,
    },
  ],
  history: [{ chapterIndex: 22, verseIndex: null, viewedAt: 1730000000000 }],
  settings: { theme: "dark", fontSize: "large", lang: "en", toolbarCollapsed: false },
};

function roundTrip(store) {
  return parseBackup(JSON.stringify(createBackup(store, "1.2")));
}

describe("createBackup", () => {
  it("stamps the type, schema and extension version", () => {
    const backup = createBackup(sampleStore, "1.2", new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(backup.type).toBe(BACKUP_TYPE);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.extensionVersion).toBe("1.2");
    expect(backup.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("carries only user data, not scripture or assets", () => {
    const backup = createBackup(sampleStore, "1.2");
    expect(Object.keys(backup.data).sort()).toEqual(["favourites", "history", "notes", "settings"]);
  });

  it("names the file with the date", () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe("psalms-way-backup-2026-01-05.json");
  });
});

describe("parseBackup — valid input", () => {
  it("restores everything it exported", () => {
    const { data, counts } = roundTrip(sampleStore);
    expect(counts).toEqual({ favourites: 1, notes: 1, history: 1 });
    expect(data.favourites[0]).toMatchObject({ chapterIndex: 22, verseIndex: 0 });
    expect(data.notes[0].text).toBe("Read at a hard time.");
    expect(data.settings.theme).toBe("dark");
  });

  it("accepts a backup written by an older schema version", () => {
    const older = { ...createBackup(sampleStore, "1.2"), schemaVersion: 1 };
    expect(() => parseBackup(JSON.stringify(older))).not.toThrow();
  });
});

describe("parseBackup — rejects bad input", () => {
  const cases = [
    ["empty string", "", "empty"],
    ["whitespace", "   ", "empty"],
    ["not JSON", "{definitely not json", "invalid_json"],
    ["a bare array", "[]", "wrong_shape"],
    ["a bare number", "42", "wrong_shape"],
    ["null", "null", "wrong_shape"],
    [
      "another product's export",
      JSON.stringify({ type: "some-other-app", schemaVersion: 1, data: {} }),
      "wrong_type",
    ],
    ["a missing version", JSON.stringify({ type: BACKUP_TYPE, data: {} }), "missing_version"],
    [
      "a future schema",
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: BACKUP_SCHEMA_VERSION + 1,
        data: {},
      }),
      "future_version",
    ],
    ["no data block", JSON.stringify({ type: BACKUP_TYPE, schemaVersion: 1 }), "no_data"],
    [
      "a data block that is an array",
      JSON.stringify({ type: BACKUP_TYPE, schemaVersion: 1, data: [] }),
      "no_data",
    ],
    [
      "nothing restorable",
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: 1,
        data: { favourites: [], notes: [], history: [] },
      }),
      "no_records",
    ],
  ];

  for (const [label, input, code] of cases) {
    it(`rejects ${label}`, () => {
      let thrown;
      try {
        parseBackup(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected ${label} to be rejected`).toBeInstanceOf(BackupError);
      expect(thrown.code).toBe(code);
      // The message must be readable, not a stack trace or an internal detail.
      expect(thrown.message).toMatch(/^[A-Z].*\.$/);
    });
  }

  it("rejects an oversized file without parsing it", () => {
    const huge = "x".repeat(MAX_BACKUP_BYTES + 1);
    let thrown;
    try {
      parseBackup(huge);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.code).toBe("too_large");
  });
});

describe("parseBackup — hostile content is neutralised", () => {
  it("drops records that are out of range or the wrong shape", () => {
    const { data, counts } = parseBackup(
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: 1,
        data: {
          favourites: [
            { chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 },
            { chapterIndex: 9999, verseIndex: 0 },
            { chapterIndex: "22", verseIndex: 0 },
            null,
            [],
            "nope",
          ],
          notes: [{ chapterIndex: 1, verseIndex: 1, text: "fine" }, { text: "orphan" }],
          history: [{ chapterIndex: -3 }],
          settings: { theme: "rainbow" },
        },
      })
    );
    expect(counts.favourites).toBe(1);
    expect(counts.notes).toBe(1);
    expect(counts.history).toBe(0);
    expect(data.settings.theme).toBe("light");
  });

  it("keeps script-like note text as inert text", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { data } = parseBackup(
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: 1,
        data: { notes: [{ chapterIndex: 1, verseIndex: 1, text: payload }] },
      })
    );
    // Stored verbatim as a string; rendering is via textContent, never markup.
    expect(data.notes[0].text).toBe(payload);
    expect(typeof data.notes[0].text).toBe("string");
  });

  it("ignores unexpected extra fields on a record", () => {
    const { data } = parseBackup(
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: 1,
        data: {
          favourites: [
            {
              chapterIndex: 1,
              verseIndex: 1,
              addedAt: 1730000000000,
              __proto__: { evil: true },
              evil: true,
            },
          ],
        },
      })
    );
    expect(data.favourites[0]).toEqual({
      chapterIndex: 1,
      verseIndex: 1,
      addedAt: 1730000000000,
    });
    expect(data.favourites[0].evil).toBeUndefined();
  });

  it("does not let a crafted key pollute Object.prototype", () => {
    parseBackup(
      JSON.stringify({
        type: BACKUP_TYPE,
        schemaVersion: 1,
        data: {
          favourites: [{ chapterIndex: 1, verseIndex: 1 }],
          settings: JSON.parse('{"__proto__":{"polluted":true},"theme":"dark"}'),
        },
      })
    );
    expect({}.polluted).toBeUndefined();
  });

  it("caps an absurd number of records rather than accepting them all", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      chapterIndex: i % 150,
      verseIndex: i % 20,
      text: `note ${i}`,
    }));
    const { counts } = parseBackup(
      JSON.stringify({ type: BACKUP_TYPE, schemaVersion: 1, data: { notes: many } })
    );
    expect(counts.notes).toBeLessThanOrEqual(500);
  });
});
