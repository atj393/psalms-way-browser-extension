import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DriveError,
  REQUEST_TIMEOUT_MS,
  downloadFile,
  fetchAccountEmail,
  findFile,
  unreadableBackupFilename,
  uploadFile,
} from "../src/drive.js";

function respond(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the Drive client", () => {
  it("finds the most recently modified file when Drive holds two of one name", async () => {
    const fetch = vi.fn(async () =>
      respond({
        files: [
          { id: "old", name: "x", modifiedTime: "2026-10-01T00:00:00.000Z" },
          { id: "new", name: "x", modifiedTime: "2026-10-02T00:00:00.000Z" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetch);
    expect((await findFile("token", "x")).id).toBe("new");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain("spaces=appDataFolder");
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("returns null when there is no such file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ files: [] }))
    );
    expect(await findFile("token", "x")).toBeNull();
  });

  it("creates a new file in the app folder, and updates an existing one in place", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond({ files: [] }))
      .mockResolvedValueOnce(respond({ id: "1", name: "x", modifiedTime: "t1" }))
      .mockResolvedValueOnce(respond({ files: [{ id: "1", name: "x", modifiedTime: "t1" }] }))
      .mockResolvedValueOnce(respond({ id: "1", name: "x", modifiedTime: "t2" }));
    vi.stubGlobal("fetch", fetch);

    await uploadFile("token", "x", "{}");
    const [, create] = fetch.mock.calls[1];
    expect(create.method).toBe("POST");
    expect(create.body).toContain('"parents":["appDataFolder"]');

    const updated = await uploadFile("token", "x", "{}");
    expect(fetch.mock.calls[3][1].method).toBe("PATCH");
    expect(updated.modifiedTime).toBe("t2");
  });

  it.each([
    [401, "", "auth"],
    [403, "insufficientPermissions", "auth"],
    [403, "storageQuotaExceeded", "storage-full"],
    [403, "userRateLimitExceeded", "quota"],
    [429, "", "quota"],
    [503, "", "server"],
    [404, "", "unknown"],
  ])("maps HTTP %s %s to %s", async (status, reason, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(reason, status))
    );
    await expect(findFile("token", "x")).rejects.toMatchObject({
      name: "DriveError",
      kind,
      status,
    });
  });

  it("reports being offline as a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(findFile("token", "x")).rejects.toMatchObject({ kind: "network" });
  });

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          })
      )
    );
    const pending = findFile("token", "x");
    const check = expect(pending).rejects.toMatchObject({
      kind: "network",
      message: "Request timed out",
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await check;
  });

  it("reports a download cut off mid-way as a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error("connection reset");
        },
      }))
    );
    await expect(downloadFile("token", "id")).rejects.toBeInstanceOf(DriveError);
  });

  it("reads the account's email, and refuses an answer without one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ user: { emailAddress: "reader@example.com" } }))
    );
    expect(await fetchAccountEmail("token")).toBe("reader@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ user: {} }))
    );
    await expect(fetchAccountEmail("token")).rejects.toBeInstanceOf(DriveError);
  });

  it("names a kept-aside file after the moment, safe for Drive", () => {
    expect(unreadableBackupFilename(new Date("2026-10-20T09:15:30.123Z"))).toBe(
      "psalms-way-backup.unreadable-2026-10-20T09-15-30-123Z.json"
    );
  });
});
