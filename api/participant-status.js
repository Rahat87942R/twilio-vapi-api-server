import { redis } from '../lib/redis.js';
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  const { CallSid, CallStatus } = req.body;
  const parentCallSid = req.query.parent; // The main callsid to track

  console.log(`Status update for ${CallSid}: ${CallStatus}`);

  if (CallStatus === 'in-progress' && parentCallSid) {
    const sessionRaw = await redis.get(`conf:${parentCallSid}`);
    if (sessionRaw) {
      const confSession = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
      if (Array.isArray(confSession.sids)) {
        for (const sid of confSession.sids) {
          if (sid !== CallSid) {
            try {
              await client.calls(sid).update({ status: 'completed' });
              console.log(`Cancelled call SID: ${sid}`);
            } catch (err) {
              console.error(`Error cancelling call SID ${sid}:`, err.message);
            }
          }
        }
      } else {
        console.error("Not a valid array for SID");
      }
      await redis.del(`conf:${parentCallSid}`);
    }
  }

  res.status(200).end();
}