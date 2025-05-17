import { redis } from '../lib/redis.js';
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { globalCallSid, Caller } = req.body;
  if (!globalCallSid || !Caller) {
    console.error("❌ Missing CallSid or Caller");
    return res.status(400).send("Missing CallSid or Caller");
  }

  const {
    VAPI_BASE_URL, PHONE_NUMBER_ID,
    ASSISTANT_ID, PRIVATE_API_KEY
  } = process.env;

  try {
    await redis.set(`call:${Caller}`, globalCallSid, { ex: 600 });

    const vapiResponse = await axios.post(
      `${VAPI_BASE_URL}/call`,
      {
        phoneNumberId: PHONE_NUMBER_ID,
        phoneCallProviderBypassEnabled: true,
        customer: { number: Caller },
        assistantId: ASSISTANT_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${PRIVATE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const twiml = vapiResponse.data.phoneCallProviderDetails.twiml;
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
  } catch (err) {
    console.error("Error in inbound_call:", err?.response?.data || err.message);
    res.status(500).send("Internal Server Error");
  }
}