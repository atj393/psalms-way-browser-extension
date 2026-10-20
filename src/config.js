// ─── Build configuration ──────────────────────────────────────────────────────
// The Google OAuth client this extension signs in with: a "Web application"
// client in the Psalms Way Google Cloud project, whose redirect URLs are this
// extension's https://<extension id>.chromiumapp.org/ addresses. A client ID
// is public by design (it is visible in every sign-in URL), and the sign-in
// flow used here needs no client secret, so none exists in this extension.
//
// Empty means cloud sync shows as unavailable in this build.

export const GOOGLE_CLIENT_ID = "";
