import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeStorageArea } from "./chrome-mock.js";

vi.mock("../src/config.js", () => ({ GOOGLE_CLIENT_ID: "client-123.apps.googleusercontent.com" }));

const auth = await import("../src/googleAuth.js");

let session;
let launchWebAuthFlow;

/** Google's redirect back to the extension, as launchWebAuthFlow hands it over. */
function answerWith(fields) {
  return async ({ url }) => {
    const state = new URL(url).searchParams.get("state");
    const params = new URLSearchParams({ state, ...fields });
    return `https://ext.chromiumapp.org/#${params}`;
  };
}

beforeEach(() => {
  session = new FakeStorageArea();
  launchWebAuthFlow = vi.fn();
  globalThis.chrome = {
    storage: { session },
    identity: { getRedirectURL: () => "https://ext.chromiumapp.org/", launchWebAuthFlow },
  };
});

afterEach(() => {
  delete globalThis.chrome;
});

describe("Google sign-in", () => {
  it("asks for the account picker and only the private app folder", async () => {
    launchWebAuthFlow.mockImplementation(answerWith({ access_token: "tok", expires_in: "3599" }));
    expect(await auth.signInInteractive()).toBe("tok");
    const { url, interactive } = launchWebAuthFlow.mock.calls[0][0];
    const params = new URL(url).searchParams;
    expect(interactive).toBe(true);
    expect(params.get("prompt")).toBe("select_account");
    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/drive.appdata");
    expect(params.get("response_type")).toBe("token");
  });

  it("reuses a token until shortly before it expires, then renews without a window", async () => {
    launchWebAuthFlow.mockImplementation(answerWith({ access_token: "first", expires_in: "3599" }));
    await auth.signInInteractive();
    expect(await auth.getAccessToken("reader@example.com")).toBe("first");
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);

    await session.set({ cloudToken: { accessToken: "first", expiresAt: Date.now() + 30000 } });
    launchWebAuthFlow.mockImplementation(
      answerWith({ access_token: "second", expires_in: "3599" })
    );
    expect(await auth.getAccessToken("reader@example.com")).toBe("second");
    const { url, interactive } = launchWebAuthFlow.mock.calls[1][0];
    expect(interactive).toBe(false);
    expect(new URL(url).searchParams.get("prompt")).toBe("none");
    expect(new URL(url).searchParams.get("login_hint")).toBe("reader@example.com");
  });

  it("returns null, not an error, when renewing needs the reader", async () => {
    launchWebAuthFlow.mockRejectedValue(new Error("User interaction required."));
    expect(await auth.getAccessToken()).toBeNull();
    launchWebAuthFlow.mockImplementation(answerWith({ error: "interaction_required" }));
    expect(await auth.getAccessToken()).toBeNull();
  });

  it("tells a closed window apart from a failure", async () => {
    launchWebAuthFlow.mockRejectedValue(new Error("The user did not approve access."));
    await expect(auth.signInInteractive()).rejects.toMatchObject({ code: "cancelled" });
    launchWebAuthFlow.mockRejectedValue(new Error("Authorization page could not be loaded."));
    await expect(auth.signInInteractive()).rejects.toMatchObject({ code: "failed" });
    launchWebAuthFlow.mockImplementation(answerWith({ error: "access_denied" }));
    await expect(auth.signInInteractive()).rejects.toMatchObject({ code: "cancelled" });
  });

  it("ignores an answer that is not for this request", async () => {
    launchWebAuthFlow.mockResolvedValue(
      "https://ext.chromiumapp.org/#access_token=tok&state=other"
    );
    await expect(auth.signInInteractive()).rejects.toMatchObject({ code: "failed" });
  });

  it("says so when the sign-in permission was not granted", async () => {
    delete globalThis.chrome.identity;
    await expect(auth.signInInteractive()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("forgets the token", async () => {
    await session.set({ cloudToken: { accessToken: "tok", expiresAt: Date.now() + 3600000 } });
    await auth.forgetToken();
    expect((await session.get("cloudToken")).cloudToken).toBeUndefined();
  });

  it("is configured when the build has a client ID", () => {
    expect(auth.isSignInConfigured()).toBe(true);
  });
});
