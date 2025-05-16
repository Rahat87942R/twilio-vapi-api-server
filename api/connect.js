import { redis } from '../lib/redis.js';
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { caller } = req.body;

  try {
    const callSid = await redis.get(`call:${caller}`);
    const baseUrl = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const confName = `conf_${Date.now()}`;
    const joinConfUrl = `${baseUrl}/api/twiml-join-conference`;
    const statusCallbackUrl = `${baseUrl}/api/participant-status`;

    await redis.set(`conf:${callSid}`, { name: confName, sids: [] }, { ex: 600 });

    await client.calls(callSid).update({
      url: `${baseUrl}/api/conference`,
      method: 'POST',
    });

    const specialistNumbers = ["+18304838832", "+12813787468"];

    for (const number of specialistNumbers) {
      const call = await client.calls.create({
        from: process.env.FROM_NUMBER,
        to: number,
        url: joinConfUrl,
        method: 'POST',
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      const session = await redis.get(`conf:${callSid}`);
      session.sids.push(call.sid);
      await redis.set(`conf:${callSid}`, session, { ex: 600 });
    }

    return res.status(200).json({ status: 'Specialist dialing initiated' });
  } catch (err) {
    console.error("Error in connect:", err);
    res.status(500).json({ error: 'Failed to connect' });
  }
}