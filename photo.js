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
