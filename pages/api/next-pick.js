// Next.js API route to securely call Picqer API
export default async function handler(req, res) {
  const url = process.env.PICQER_API_URL;
  const apiKey = process.env.PICQER_API_KEY;

  if (!url || !apiKey) {
    return res.status(500).json({ error: 'Missing Picqer API credentials' });
  }

  // Example: GET request to Picqer API
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
