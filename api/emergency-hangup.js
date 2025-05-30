// pages/api/emergency-hangup.js
import twilio from 'twilio';
import { redis } from '../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Optional: Protect with a secret token
  const token = req.headers['x-secret-token'];
  if (token !== process.env.EMERGENCY_KILL_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  try {
    // Optional: Kill all calls from a specific conference
    const keys = await redis.keys('conf:*');
    const sids = new Set();

    for (const key of keys) {
      if (key.endsWith(':customer') || key.endsWith(':accepted') || key.endsWith(':total') || key.endsWith(':rejected')) continue;
      const data = await redis.get(key);
      if (data) {
        const session = typeof data === 'string' ? JSON.parse(data) : data;
        if (Array.isArray(session.sids)) {
          session.sids.forEach(sid => sids.add(sid));
        }
      }
    }

    // Kill all collected SIDs
    for (const sid of sids) {
      try {
        await client.calls(sid).update({ status: 'completed' });
        console.log(`✅ Emergency hangup for call ${sid}`);
      } catch (err) {
        console.error(`❌ Error hanging up ${sid}:`, err.message);
      }
    }

    res.status(200).json({ message: 'All active conference calls terminated.' });
  } catch (err) {
    console.error('❌ Emergency hangup failed:', err.message);
    res.status(500).json({ error: 'Emergency shutdown failed.' });
  }
}
