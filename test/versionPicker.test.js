// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../src/storage.js";
import { currentVersion, resetVersions, setCurrentVersion } from "../src/versions.js";
import { renderVersionPicker } from "../src/versionPicker.js";
import { installChromeMock } from "./chrome-mock.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Serves the real catalogue and Bible files from the repository, as the popup would. */
function serveRepoFiles() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => ({
      ok: true,
      json: async () => JSON.parse(readFileSync(join(root, path), "utf8")),
    }))
  );
}

const rows = () => Array.from(document.querySelectorAll("#versionBody .version-row"));
const modules = () => rows().map((row) => row.dataset.module);
const headings = () =>
  Array.from(document.querySelectorAll("#versionBody .version-language")).map(
    (heading) => heading.textContent
  );
const filterBox = () => document.querySelector("#versionBody input");

function type(text) {
  const input = filterBox();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  store.resetStoreCache();
  resetVersions();
  const body = Object.assign(document.createElement("div"), { id: "versionBody" });
  const status = Object.assign(document.createElement("div"), { id: "statusBar", hidden: true });
  document.body.replaceChildren(body, status);
  installChromeMock();
  serveRepoFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetVersions();
});

describe("renderVersionPicker", () => {
  it("lists all 80 versions under language headings, with a filter box above", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });

    expect(filterBox()).not.toBeNull();
    expect(filterBox().getAttribute("aria-label")).toBeTruthy();
    expect(rows()).toHaveLength(80);
    expect(headings()).toHaveLength(new Set(headings()).size);
    expect(headings()).toContain("German");
    expect(headings()).toContain("Hebrew");
  });

  it("shows each version's name, year and credit line", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });

    const kjv = rows().find((row) => row.dataset.module === "kjv");
    expect(kjv.querySelector(".version-name").textContent).toBe("Authorized King James Version");
    expect(kjv.querySelector(".version-year").textContent).toBe("1611 / 1769");
    expect(kjv.querySelector(".version-credit").textContent).toMatch(/Public Domain/);

    const niv = rows().find((row) => row.dataset.module === "modern");
    expect(niv.querySelector(".version-credit")).toBeNull();
  });

  it("starts with the current version's language, and marks the current version", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });
    expect(headings()[0]).toBe("English");
    expect(modules()[0]).toBe("modern");

    await setCurrentVersion("luther");
    await renderVersionPicker({ onChosen: vi.fn() });
    expect(headings()[0]).toBe("German");

    const marked = rows().filter((row) => row.getAttribute("aria-current") === "true");
    expect(marked.map((row) => row.dataset.module)).toEqual(["luther"]);
    expect(marked[0].querySelector("svg")).not.toBeNull();
    expect(document.querySelectorAll("#versionBody .version-row svg")).toHaveLength(1);
  });

  it('shows exactly the six versions with "kjv" in their name or module when "kjv" is typed', async () => {
    await renderVersionPicker({ onChosen: vi.fn() });

    type("kjv");

    expect([...modules()].sort()).toEqual([
      "ckjv_sds",
      "ckjv_sdt",
      "kjv",
      "kjv_strongs",
      "kn_kjv",
      "thaikjv",
    ]);
    // Only languages that still have a row keep their heading, the current one first.
    expect(headings()).toEqual(["English", "Chinese", "Kannada", "Thai"]);
    expect(document.querySelectorAll(".version-group")).toHaveLength(4);
  });

  it("matches the version name, the language and the module, ignoring case and spaces", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });

    type("  KING james ");
    expect(modules()).toContain("kjv");

    type("german");
    expect(modules()).toEqual(expect.arrayContaining(["luther", "schlachter"]));
    expect(headings()).toEqual(["German"]);

    type("ug_ara");
    expect(modules()).toEqual(["ug_ara"]);
  });

  it("says so when nothing matches, and brings everything back when cleared", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });

    type("zzzz");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("#versionBody .panel-empty").textContent).toBe(
      "No results found"
    );

    type("");
    expect(rows()).toHaveLength(80);
    expect(document.querySelector("#versionBody .panel-empty")).toBeNull();
  });

  it("keeps what was typed in the box while the list is redrawn", async () => {
    await renderVersionPicker({ onChosen: vi.fn() });
    const box = filterBox();

    type("web");

    expect(filterBox()).toBe(box);
    expect(box.value).toBe("web");
  });

  it("choosing a version selects it, saves it, then tells the app", async () => {
    const onChosen = vi.fn(async () => {
      // By now the choice must already be in force, so the app can repaint from it.
      expect(currentVersion()).toBe("web");
    });
    await renderVersionPicker({ onChosen });

    rows()
      .find((row) => row.dataset.module === "web")
      .click();
    await vi.waitFor(() => expect(onChosen).toHaveBeenCalledTimes(1));

    expect((await store.getSettings()).bibleVersion).toBe("web");
  });

  it("shows a message and does not tell the app when the choice cannot be saved", async () => {
    const onChosen = vi.fn();
    await renderVersionPicker({ onChosen });
    await store.loadStore();
    globalThis.chrome.storage.local.rejectNextSet();
    vi.spyOn(console, "error").mockImplementation(() => {});

    rows()
      .find((row) => row.dataset.module === "web")
      .click();
    await vi.waitFor(() => expect(document.getElementById("statusBar").hidden).toBe(false));

    expect(onChosen).not.toHaveBeenCalled();
    expect(currentVersion()).toBe("modern");
    expect(document.getElementById("statusBar").textContent).not.toBe("");
    expect(document.getElementById("statusBar").textContent).not.toMatch(/could not be updated/);
  });

  it("says the page could not be updated, not that the version could not be selected, when the app fails after a choice", async () => {
    // A TypeError is shown as the picker's own wording rather than the error's message.
    const onChosen = vi.fn(async () => {
      throw new TypeError("view is null");
    });
    await renderVersionPicker({ onChosen });
    vi.spyOn(console, "error").mockImplementation(() => {});

    rows()
      .find((row) => row.dataset.module === "web")
      .click();
    await vi.waitFor(() => expect(document.getElementById("statusBar").hidden).toBe(false));

    expect(document.getElementById("statusBar").textContent).toBe(
      "The version was changed, but the page could not be updated."
    );
    // The choice itself went through and was saved.
    expect(currentVersion()).toBe("web");
    expect((await store.getSettings()).bibleVersion).toBe("web");
  });

  it("works without an onChosen callback", async () => {
    await renderVersionPicker();
    rows()
      .find((row) => row.dataset.module === "web")
      .click();
    await vi.waitFor(() => expect(currentVersion()).toBe("web"));
  });

  it("raises the error when the list cannot be loaded, for the app to report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await expect(renderVersionPicker({ onChosen: vi.fn() })).rejects.toThrow(/404/);
  });
});
