// ─── Build configuration ──────────────────────────────────────────────────────
// The Google OAuth client this extension signs in with: a "Web application"
// client in the Psalms Way Google Cloud project, whose redirect URLs are this
// extension's https://<extension id>.chromiumapp.org/ addresses. A client ID
// is public by design (it is visible in every sign-in URL), and the sign-in
// flow used here needs no client secret, so none exists in this extension.
//
// An empty value would make cloud sync show as unavailable.

export const GOOGLE_CLIENT_ID =
  "873591523011-eh1uj53sud1gmgvu370bhpg13lsdsbgo.apps.googleusercontent.com";
