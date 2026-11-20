// Business OS — frontend config (split deploy).
//
// Same-origin / local / single-service deploy: leave BOS_API_BASE empty —
// the app calls its own origin, exactly as before.
//
// Split deploy (frontend on Vercel, backend on Render): set this to the
// backend's full URL, e.g.
//   window.BOS_API_BASE = 'https://api.example.com';
// A trailing slash is fine — the app strips it. After changing this file,
// redeploy the frontend (it is a static file, no build step).
window.BOS_API_BASE = '';
