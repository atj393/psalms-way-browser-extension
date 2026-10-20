// @vitest-environment jsdom
// The sync button in the header has no visible text, so its accessible name is
// all a screen reader gets. It must say what the icon shows, in the reader's
// language, and change with the sync state just as its tooltip does.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTablesForTests } from "../src/i18n.js";
import { paintCloudButton, repaintCloudButton } from "../src/cloud.js";

const button = () => document.getElementById("btnCloud");

beforeEach(() => {
  document.body.replaceChildren(
    Object.assign(document.createElement("button"), {
      id: "btnCloud",
      type: "button",
      title: "Sync with your phone",
    })
  );
  setTablesForTests("en", []);
});

afterEach(() => setTablesForTests("en", []));

describe("paintCloudButton", () => {
  it.each([
    [undefined, "Sync with your phone"],
    [{ icon: "off" }, "Sync with your phone"],
    [{ icon: "ok" }, "Synced with your phone"],
    [{ icon: "attention" }, "Sync needs your attention"],
  ])("names the button for %j, in its tooltip and its accessible name", (status, name) => {
    paintCloudButton(status);
    expect(button().title).toBe(name);
    expect(button().getAttribute("aria-label")).toBe(name);
    expect(button().querySelector("svg")).not.toBeNull();
  });

  it("marks a button that needs attention", () => {
    paintCloudButton({ icon: "attention" });
    expect(button().classList.contains("needs-attention")).toBe(true);
    paintCloudButton({ icon: "ok" });
    expect(button().classList.contains("needs-attention")).toBe(false);
  });

  it("uses the reader's language for both", () => {
    setTablesForTests("de", [{ syncedWithPhone: "Mit dem Handy synchronisiert" }]);
    paintCloudButton({ icon: "ok" });
    expect(button().title).toBe("Mit dem Handy synchronisiert");
    expect(button().getAttribute("aria-label")).toBe("Mit dem Handy synchronisiert");
  });

  it("does nothing where there is no button", () => {
    document.body.replaceChildren();
    expect(() => paintCloudButton({ icon: "ok" })).not.toThrow();
  });
});

describe("repaintCloudButton", () => {
  it("paints the last state again, in a newly chosen language", () => {
    paintCloudButton({ icon: "attention" });
    setTablesForTests("de", [{ syncNeedsAttention: "Sync braucht Aufmerksamkeit" }]);

    repaintCloudButton();

    expect(button().getAttribute("aria-label")).toBe("Sync braucht Aufmerksamkeit");
    expect(button().title).toBe("Sync braucht Aufmerksamkeit");
    expect(button().classList.contains("needs-attention")).toBe(true);
  });
});
