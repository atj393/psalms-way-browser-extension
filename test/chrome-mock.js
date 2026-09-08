// ─── chrome.storage test double ───────────────────────────────────────────────
// Deliberately strict, so a test cannot pass because the mock is more forgiving
// than Chrome:
//
//   * values are structured-cloned in and out, as the real API does, so a test
//     cannot mutate stored state through a retained reference;
//   * `get` accepts the same argument shapes Chrome accepts and returns only
//     the requested keys;
//   * failures can be injected to exercise the error paths that matter most
//     (quota exceeded, and storage being unavailable altogether).

export class FakeStorageArea {
  constructor(initial = {}) {
    this.data = structuredClone(initial);
    this.failNextSet = null;
    this.failNextGet = null;
    this.setCalls = 0;
    this.getCalls = 0;
  }

  async get(keys) {
    this.getCalls++;
    if (this.failNextGet) {
      const error = this.failNextGet;
      this.failNextGet = null;
      throw error;
    }
    if (keys === null || keys === undefined) return structuredClone(this.data);
    if (typeof keys === "string") {
      return keys in this.data ? { [keys]: structuredClone(this.data[keys]) } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) {
        if (key in this.data) out[key] = structuredClone(this.data[key]);
      }
      return out;
    }
    // Object form: keys are defaults.
    const out = {};
    for (const [key, fallback] of Object.entries(keys)) {
      out[key] = key in this.data ? structuredClone(this.data[key]) : fallback;
    }
    return out;
  }

  async set(items) {
    this.setCalls++;
    if (this.failNextSet) {
      const error = this.failNextSet;
      this.failNextSet = null;
      throw error;
    }
    if (!items || typeof items !== "object" || Array.isArray(items)) {
      throw new Error("Invalid argument to storage.set");
    }
    for (const [key, value] of Object.entries(items)) {
      // Chrome rejects values it cannot serialise; structuredClone throws for
      // the same reasons, which keeps the mock honest.
      this.data[key] = structuredClone(value);
    }
  }

  async remove(keys) {
    for (const key of [].concat(keys)) delete this.data[key];
  }

  async clear() {
    this.data = {};
  }

  /** Make the next set() reject with a quota error, as Chrome does. */
  rejectNextSetWithQuota() {
    this.failNextSet = new Error("QUOTA_BYTES quota exceeded");
  }

  rejectNextSet(message = "storage write failed") {
    this.failNextSet = new Error(message);
  }

  rejectNextGet(message = "storage read failed") {
    this.failNextGet = new Error(message);
  }
}

/** Install a fake `chrome` global. Returns the local area for assertions. */
export function installChromeMock(initial = {}) {
  const local = new FakeStorageArea(initial);
  globalThis.chrome = { storage: { local } };
  return local;
}

/** Remove the `chrome` global entirely, as when popup.html is opened directly. */
export function removeChromeMock() {
  delete globalThis.chrome;
}
