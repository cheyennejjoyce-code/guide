export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, first_name } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }

  const auth = 'Basic ' + Buffer.from(process.env.FLODESK_API_KEY + ':').toString('base64');
  const body = { email, first_name: first_name || undefined };
  if (process.env.FLODESK_SEGMENT_ID) body.segment_ids = [process.env.FLODESK_SEGMENT_ID];

  try {
    const r = await fetch('https://api.flodesk.com/v1/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'User-Agent': 'ATL Thrift Guide (atlthriftguide.com)'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) return res.status(502).json({ error: 'Could not subscribe right now. Please try again.' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' });
  }
}
