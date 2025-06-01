import { redis } from '../lib/redis.js';
import twilio from 'twilio';
import { getServicesFromZip } from '../lib/getServicesFromZip.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  if (req.headers.authorization !== `Bearer ${process.env.ACCESS_TOKEN}`) {
    const caller = req.body?.message?.customer?.number;
    const zipcode = req.body?.message?.toolCalls[0]?.function?.arguments?.zipcode;
    const service = req.body?.message?.toolCalls[0]?.function?.arguments?.typeOfBusiness;
    if (!caller) {
      console.error("❌ Missing caller number in request body");
      return res.status(400).json({ error: "Missing caller number" });
    }

    try {
      const normalizePhone = number => number.replace(/[^\d+]/g, '');
      const normalizedCaller = normalizePhone(caller);
      const callSid = await redis.get(`call:${normalizedCaller}`);

      if (!callSid || !callSid.startsWith("CA")) {
        console.error("Invalid or missing callSid from Redis:", callSid);
        return res.status(400).json({ error: "Invalid call SID for caller." });
      }

      const forwardedProto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const baseUrl = `${forwardedProto}://${req.headers.host}`;
      const confName = `conf_${Date.now()}`;

      const conferenceUrl = `${baseUrl}/api/conference?conf=${confName}`;
      const joinConfUrl = `${baseUrl}/api/twiml-join-conference?conf=${confName}`;
      const statusCallbackUrl = `${baseUrl}/api/participant-status`;

      await redis.set(`conf:${confName}`, JSON.stringify({ name: confName, sids: [] }), { ex: 600 });

      // Move customer into conference
      await client.calls(callSid).update({
        url: conferenceUrl,
        method: 'POST',
      });

      let services;

      if (process.env.MODE === "DEVELOPMENT"){
        services = JSON.parse(process.env.SERVICE_DATA);
      } else if (process.env.MODE === "PRODUCTION") {
        services = await getServicesFromZip(zipcode, service);
      }

      await redis.set(`conf:${confName}:services`, JSON.stringify(services), { ex: 600 });

      await redis.set(`conf:${confName}:total`, services.length);
      await redis.set(`conf:${confName}:rejected`, 0);
      await redis.set(`conf:${confName}:customer`, callSid); 
      
      for (const service of services) {
        const call = await client.calls.create({
          from: process.env.FROM_NUMBER,
          to: service.phone,
          url: joinConfUrl,
          method: 'POST',
          machineDetection: 'Enable',
          statusCallback: `${statusCallbackUrl}?parent=${callSid}`,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'in-progress', 'busy'],
          statusCallbackMethod: 'POST',
        });

        const sessionRaw = await redis.get(`conf:${confName}`);
        const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
        session.sids.push(call.sid);

        // Store service info for this call SID
        await redis.set(`conf:${confName}:sid:${call.sid}`, JSON.stringify(service), { ex: 600 });

        await redis.set(`conf:${confName}`, JSON.stringify(session), { ex: 600 });
      }

      return res.status(200).json({ status: 'Specialist dialing initiated' });
    } catch (err) {
      console.error("Error in connect:", err);
      res.status(500).json({ error: 'Failed to connect' });
    }
  }
}