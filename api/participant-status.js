import { redis } from '../lib/redis.js';
import twilio from 'twilio';

export default async function handler(req, res) {
  const { CallSid, CallStatus, ParentCallSid, AnsweredBy } = req.body;

  console.log(`CallSid: ${CallSid} has ${CallStatus}`)

  // Emergency Kill Switch
  const emergency = await redis.get('emergency:shutdown');
  if (emergency === 'true') {
    console.log('🚨 Emergency shutdown active. Ending call', CallSid);
    try {
      await twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      ).calls(CallSid).update({ status: 'completed' });
    } catch (err) {
      console.error("❌ Error force-hanging call:", err.message);
    }
    return res.status(200).end();
  }

  let confName = null;
  const keys = await redis.keys('conf:*');
  for (const key of keys) {
    if ((key.match(/:/g) || []).length > 1) continue;

    const raw = await redis.get(key);
    let session;

    try {
      session = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue; // Skip if not valid JSON
    }

    if (Array.isArray(session?.sids) && session.sids.includes(ParentCallSid)) {
      confName = key.split(':')[1]; // extract actual confName from "conf:xyz"
      break;
    }
  }

  if (!confName) return res.status(200).end(); // No matching conference found

  // Handle voicemail or machine pickup like IVR
  if (AnsweredBy?.startsWith('machine')) {
    console.log(`🤖 Voicemail detected on ${CallSid} in ps.ks`);

    const rejectedKey = `conf:${confName}:rejected`;
    const rejectedType = await redis.type(rejectedKey);
    if (rejectedType !== 'string') {
      await redis.del(rejectedKey); // or set to 0 based on your logic
      await redis.set(rejectedKey, 0);
    }
    await redis.incr(rejectedKey);

    const total = parseInt(await redis.get(`conf:${confName}:total`) || '0', 10);
    const rejected = parseInt(await redis.get(`conf:${confName}:rejected`) || '0', 10);

    if (rejected >= total) {
      console.log("Time to end the call")
      const customerSid = await redis.get(`conf:${confName}:customer`);

      if (customerSid) {
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

        try {
          // 1. Remove the customer from the conference
          const participants = await client.conferences(confName)
            .participants
            .list();

          for (const participant of participants) {
            if (participant.callSid === customerSid) {
              await client.conferences(confName)
                .participants(participant.callSid)
                .remove();
              break;
            }
          }

          // 2. Redirect to fallback TwiML
          const baseUrl = `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${req.headers.host}`;
          const url = `${baseUrl}/api/twiml-no-specialist`;

          await client.calls(customerSid).update({
            url,
            method: 'POST',
          });

          console.log(`ℹ️ Customer ${customerSid} redirected to no-specialist TwiML`);
        } catch (err) {
          console.error("❌ Error during fallback redirection:", err.message);
        }
      }
    }

    // End this call if voicemail or ivr
    try {
      await twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      ).calls(CallSid).update({
        status: 'completed',
      });
    } catch (err) {
      console.error("❌ Error ending bot call:", err.message);
    }
  }

  res.status(200).end();
}
