// ─── Google sign-in ───────────────────────────────────────────────────────────
// chrome.identity.launchWebAuthFlow with Google's account picker, so the
// reader chooses the same account as on their phone, in Chrome and in Edge
// (Edge has no getAuthToken). Google returns a one-hour access token and no
// refresh token; when it runs out, the same flow runs again without showing
// anything (prompt=none), which works while the reader stays signed in to
// Google in this browser. Tested in docs/superpowers/specs (step 0).
//
// Tokens live in chrome.storage.session: memory only, gone when the browser
// closes, never written to disk and never logged.

import { GOOGLE_CLIENT_ID } from "./config.js";
import { DRIVE_APPDATA_SCOPE } from "./drive.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_KEY = "cloudToken";
/** Renew a minute before Google's hour runs out, so no request races the expiry. */
const EXPIRY_MARGIN_MS = 60000;

/** `cancelled`: the reader closed the window. `unavailable`: no permission or no client. */
export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export function isSignInConfigured() {
  return GOOGLE_CLIENT_ID !== "";
}

function identity() {
  const api = globalThis.chrome?.identity;
  if (!api)
    throw new AuthError("unavailable", "Google sign-in has not been allowed for this extension");
  return api;
}

/** Runs Google's sign-in. Interactive failures throw; silent ones return null. */
async function authorize({ interactive, loginHint }) {
  if (!isSignInConfigured())
    throw new AuthError("unavailable", "Google sign-in is not set up in this build");
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "token",
    redirect_uri: identity().getRedirectURL(),
    scope: DRIVE_APPDATA_SCOPE,
    state,
    prompt: interactive ? "select_account" : "none",
  });
  if (loginHint) params.set("login_hint", loginHint);

  let redirect;
  try {
    redirect = await identity().launchWebAuthFlow({ url: `${AUTH_URL}?${params}`, interactive });
  } catch (error) {
    if (!interactive) return null;
    const message = String(error?.message ?? error);
    throw new AuthError(
      /did not approve|closed|cancel/i.test(message) ? "cancelled" : "failed",
      message
    );
  }

  const url = new URL(redirect);
  const answer = new URLSearchParams(url.hash.slice(1));
  const googleError = answer.get("error") ?? url.searchParams.get("error");
  const accessToken = answer.get("access_token");
  if (googleError || answer.get("state") !== state || !accessToken) {
    if (!interactive) return null;
    if (googleError === "access_denied") throw new AuthError("cancelled", googleError);
    throw new AuthError("failed", googleError ?? "Google's answer could not be used");
  }
  const expiresIn = Number(answer.get("expires_in")) || 3600;
  await chrome.storage.session.set({
    [TOKEN_KEY]: { accessToken, expiresAt: Date.now() + expiresIn * 1000 },
  });
  return accessToken;
}

/** Shows Google's account picker and consent. Returns an access token. */
export function signInInteractive() {
  return authorize({ interactive: true });
}

/** A usable token without showing anything, or null when the reader must reconnect. */
export async function getAccessToken(loginHint) {
  const cached = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY];
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.accessToken;
  return authorize({ interactive: false, loginHint });
}

/** Forgets the current token, after Google rejected it or on disconnect. */
export async function forgetToken() {
  await chrome.storage.session.remove(TOKEN_KEY);
}
