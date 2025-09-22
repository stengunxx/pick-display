import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.json({
    PICQER_API_URL: process.env.PICQER_API_URL ?? null,
    PICQER_API_KEY_set: !!process.env.PICQER_API_KEY,
    note: 'Controleer of PICQER_API_URL GEEN trailing slash heeft, bv https://xxx.picqer.com/api/v1',
  });
}
