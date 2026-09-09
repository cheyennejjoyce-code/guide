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

export default async function handler(req, res) {
  const { name } = req.query;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return res.status(501).json({ error: "GOOGLE_PLACES_API_KEY isn't set in Vercel's environment variables yet." });
  }
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= parameter." });
  }

  try {
    const photoResp = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${apiKey}`
    );
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
    res.status(500).json({ error: "Server error fetching photo." });
  }
}
