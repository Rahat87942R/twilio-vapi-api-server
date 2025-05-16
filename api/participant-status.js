import { redis } from '../lib/redis.js';
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  const { CallSid, CallStatus, ParentCallSid } = req.body;
  console.log(`Status update for ${CallSid}: ${CallStatus}`);

  if (CallStatus === 'in-progress') {
    const confSession = await redis.get(`conf:${ParentCallSid}`);
    if (confSession) {
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
      await redis.del(`conf:${ParentCallSid}`);
    }
  }

  res.status(200).end();
}