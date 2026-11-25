// Vercel serverless function: GET /api/photo?name=places/XXXX/photos/YYYY
//
// Why this exists: the browser can't safely hold the Google Places API key
// (anyone could open dev tools and copy it out, then use it on your
// Google Cloud bill). This function runs on Vercel's servers instead —
// the key lives in an environment variable here, never sent to the browser.
// The app just asks this function for a photo by name; this function is
// the only thing that ever talks to Google directly.
//
// Setup required (one-time): in your Vercel project, go to
// Settings → Environment Variables → add GOOGLE_PLACES_API_KEY with your
// real key as the value → redeploy. Nothing else to configure; Vercel
// automatically turns any file in /api into a live endpoint.
//
// Self-healing: Google's photo names expire after a few weeks, and then
// Google rejects them. Every photo name starts with the store's Google
// place ID (places/<place ID>/photos/...), so when an old name is rejected
// this asks Google for that store's current photo and serves it instead.
// The admin "Refresh hours, ratings & photos" button still saves fresh
// names to the database, which skips this extra lookup.

// Photo names look like places/<place ID>/photos/<photo ID>. Checking the
// shape keeps this function from being used to fetch anything else.
const PHOTO_NAME = /^places\/([A-Za-z0-9_-]+)\/photos\/[A-Za-z0-9_-]+$/;

// Only stores in the guide get photos, so this function can't be used to
// download (and bill us for) photos of any other Google place. The list of
// the guide's Google place IDs comes from the public stores table with the
// same public key app.html ships, and is kept in memory for 10 minutes. A
// place ID that isn't on the list triggers one early re-check (at most every
// 15 seconds), so a store the admin just added shows its photo right away. If
// the list can't be loaded, photos are served anyway so they never break.
//
// Vercel settings SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are optional. If
// they're set and loading the list with them fails, this tries once more with
// the built-in values below. Every failure is written to Vercel's logs with
// the reason, starting "photo allow-list". The logs never show a key or a
// full web address.
const BUILT_IN_URL = "https://rwrmnrpsbatubjgimstr.supabase.co";
const BUILT_IN_KEY = "sb_publishable_1pyhvlnQ79-DnjjXv-hzfA_l7qi07wU";
const ENV_URL = process.env.SUPABASE_URL || "";
const ENV_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_URL = ENV_URL || BUILT_IN_URL;
const SUPABASE_KEY = ENV_KEY || BUILT_IN_KEY;
// True when a Vercel setting changes what the first try uses.
const USES_ENV = SUPABASE_URL !== BUILT_IN_URL || SUPABASE_KEY !== BUILT_IN_KEY;
let guidePlaces = new Set(), guidePlacesOk = false, guidePlacesAt = 0, guidePlacesLoading = null;

// Removes anything that could be a web address or a key before logging.
function redact(text) {
  return String(text)
    .replace(/https?:\/\/\S*/gi, "[address]")
    .replace(/\b(sb_[a-z]+_|eyJ)[\w.-]*/g, "[key]")
    .slice(0, 200);
}

// A short, safe reason for a failed load.
function reason(err) {
  if (err && err.name === "TimeoutError") return "no answer within 4 seconds";
  const message = String((err && err.message) || err);
  if (/^Failed to parse URL/i.test(message) || /Invalid URL/i.test(message)) return "the address isn't a valid web address";
  const code = err && err.cause && err.cause.code;
  return redact(code ? `${message} (${code})` : message);
}

// Describes Vercel's two settings without printing them.
function envSummary() {
  const notes = [];
  if (!ENV_URL) notes.push("SUPABASE_URL not set");
  else if (ENV_URL === BUILT_IN_URL) notes.push("SUPABASE_URL same as built-in");
  else {
    const why = [];
    if (ENV_URL !== ENV_URL.trim()) why.push("has extra spaces or a line break");
    if (/\/+\s*$/.test(ENV_URL)) why.push("ends with a slash");
    if (!/^\s*https:\/\//i.test(ENV_URL)) why.push("doesn't start with https");
    if (!ENV_URL.includes(new URL(BUILT_IN_URL).hostname)) why.push("points somewhere else, likely a different Supabase project");
    notes.push(`SUPABASE_URL differs from built-in${why.length ? ` (${why.join(", ")})` : ""}`);
  }
  if (!ENV_KEY) notes.push("SUPABASE_PUBLISHABLE_KEY not set");
  else if (ENV_KEY === BUILT_IN_KEY) notes.push("SUPABASE_PUBLISHABLE_KEY same as built-in");
  else {
    const k = ENV_KEY.trim();
    const kind = k.startsWith("sb_publishable_") ? "a publishable key"
      : k.startsWith("sb_secret_") ? "a secret key, which shouldn't be used here"
      : k.startsWith("eyJ") ? "an older-style key"
      : "not a Supabase key";
    notes.push(`SUPABASE_PUBLISHABLE_KEY differs from built-in (${kind}${k !== ENV_KEY ? ", has extra spaces or a line break" : ""})`);
  }
  return notes.join("; ");
}

async function fetchGuidePlaces(url, key) {
  const resp = await fetch(`${url}/rest/v1/stores?select=google_place_id&google_place_id=not.is.null`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(4000)
  });
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).replace(/\s+/g, " ").trim().slice(0, 120); } catch (e) {}
    throw new Error(`stores list returned ${resp.status}${detail ? `: ${detail}` : ""}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("stores list was empty");
  return new Set(rows.map(r => r.google_place_id));
}

async function loadGuidePlaces() {
  try {
    guidePlaces = await fetchGuidePlaces(SUPABASE_URL, SUPABASE_KEY);
    guidePlacesOk = true;
  } catch (err) {
    if (!USES_ENV) {
      guidePlacesOk = false;
      console.warn(`photo allow-list failed: ${reason(err)}. Photos are served for any place until it loads.`);
    } else {
      const first = reason(err);
      try {
        guidePlaces = await fetchGuidePlaces(BUILT_IN_URL, BUILT_IN_KEY);
        guidePlacesOk = true;
        console.warn(`photo allow-list: Vercel's Supabase settings failed (${first}). The built-in values worked. Settings: ${envSummary()}.`);
      } catch (err2) {
        guidePlacesOk = false;
        console.warn(`photo allow-list failed: with Vercel's Supabase settings: ${first}. With built-in values: ${reason(err2)}. Settings: ${envSummary()}. Photos are served for any place until it loads.`);
      }
    }
  }
  guidePlacesAt = Date.now();
}

async function isGuidePlace(placeId) {
  const age = Date.now() - guidePlacesAt;
  if (age > 10 * 60 * 1000 || (age > 15 * 1000 && !(guidePlacesOk && guidePlaces.has(placeId)))) {
    if (!guidePlacesLoading) guidePlacesLoading = loadGuidePlaces().finally(() => { guidePlacesLoading = null; });
    await guidePlacesLoading;
  }
  return !guidePlacesOk || guidePlaces.has(placeId);
}

function fetchPhoto(name, apiKey) {
  return fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${apiKey}`);
}

export default async function handler(req, res) {
  const { name } = req.query;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return res.status(501).json({ error: "GOOGLE_PLACES_API_KEY isn't set in Vercel's environment variables yet." });
  }
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= parameter." });
  }
  const match = typeof name === "string" && name.match(PHOTO_NAME);
  if (!match) {
    return res.status(400).json({ error: "That isn't a Google photo name." });
  }
  if (!(await isGuidePlace(match[1]))) {
    return res.status(404).json({ error: "That photo isn't for a store in the guide." });
  }

  try {
    let photoResp = await fetchPhoto(name, apiKey);
    // Google answers an expired name with 400 (its docs also mention 404).
    // Other errors (Google busy, over quota) wouldn't be fixed by a fresh
    // name, so don't spend a lookup on them. The place lookup asks only for
    // photos, which Google bills at its free "IDs Only" tier.
    if (photoResp.status === 400 || photoResp.status === 404) {
      const placeResp = await fetch(`https://places.googleapis.com/v1/places/${match[1]}?key=${apiKey}`, {
        headers: { "X-Goog-FieldMask": "photos" }
      });
      const place = placeResp.ok ? await placeResp.json() : null;
      const freshName = place && place.photos && place.photos[0] && place.photos[0].name;
      if (freshName) {
        photoResp = await fetchPhoto(freshName, apiKey);
      } else {
        // Shows up in Vercel's logs. Never log the URLs: they hold the key.
        console.warn(`photo heal failed: photo ${photoResp.status}, place lookup ${placeResp.status}`);
      }
    }
    if (!photoResp.ok) {
      return res.status(502).json({ error: `Google returned ${photoResp.status}` });
    }
    const buffer = Buffer.from(await photoResp.arrayBuffer());
    res.setHeader("Content-Type", photoResp.headers.get("content-type") || "image/jpeg");
    // Cache in the visitor's browser for a day so repeat views of the same
    // store don't re-hit this function (or Google) every time.
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(buffer);
  } catch (err) {
    console.error(`photo error: ${err.message}`);
    res.status(500).json({ error: "Server error fetching photo." });
  }
}
