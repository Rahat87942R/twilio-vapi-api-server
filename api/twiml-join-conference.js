import twilio from 'twilio';
import { redis } from '../lib/redis.js';

export default async function handler(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const confName = req.query.conf;
  const digits = req.body.Digits;
  const callSid = req.body.CallSid;
  const answeredBy = req.body.AnsweredBy;

  console.log(`Call ${callSid} input:`, digits);
  if (answeredBy?.startsWith('machine')) {
    console.log(`🤖 Voicemail detected on ${callSid} (${answeredBy})`);

    const total = parseInt(await redis.get(`conf:${confName}:total`) || 0, 10);
    const rejected = parseInt(await redis.get(`conf:${confName}:rejected`) || 0, 10) + 1;
    await redis.set(`conf:${confName}:rejected`, rejected);

    if (rejected >= total) {
      console.log("End the call now!")
      const customerSid = await redis.get(`conf:${confName}:customer`);

      if (customerSid) {
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

        const baseUrl = `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${req.headers.host}`;
        const url = `${baseUrl}/api/twiml-no-specialist`;

        try {
          await client.calls(customerSid).update({
            url,
            method: 'POST',
          });

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

          console.log(`✅ Customer ${customerSid} will now hear 'no specialist available' (voicemail case)`);
        } catch (err) {
          console.error("❌ Error redirecting customer:", err.message);
        }
      }
    }

    twiml.say("This number seems unavailable. Goodbye.");
    twiml.hangup();

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  if (!digits) {
    // Prompt on first load
    const gather = twiml.gather({
      numDigits: 1,
      timeout: 10,
      action: `/api/twiml-join-conference?conf=${confName}`,
      method: 'POST',
    });

    // Pause to give humans a second to say "hello"
    gather.pause({ length: 1 });
    gather.say("Hello, we have a customer for you. Press 1 to accept the call. Press 2 to decline.");

    // Fallback in case of silence
    twiml.redirect(`/api/twiml-join-conference?conf=${confName}`);
  } else if (digits === '1') {
    const alreadyAccepted = await redis.get(`conf:${confName}:accepted`);

    if (alreadyAccepted) {
      twiml.say("Sorry, this call has already been taken. Goodbye.");
      twiml.hangup();
    } else {
      await redis.set(`conf:${confName}:accepted`, callSid);

      // Fetch service info by callSid
      const serviceInfoRaw = await redis.get(`conf:${confName}:sid:${callSid}`);
      const serviceInfo = typeof serviceInfoRaw === 'string' ? JSON.parse(serviceInfoRaw) : serviceInfoRaw;

      const webhookUrl = process.env.WEBHOOK_ON_ACCEPT;
      if (webhookUrl && serviceInfo) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'accepted',
              service: serviceInfo,
              confName,
              timestamp: Date.now()
            }),
          });
        } catch (err) {
          console.error("❌ Failed to notify webhook:", err.message);
        }
      }

      twiml.say("Connecting you now.");
      twiml.pause({ length: 1 });
      // Disconnect other calls
      const sessionRaw = await redis.get(`conf:${confName}`);
      const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
      const baseUrl = `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${req.headers.host}`;
      const takenUrl = `${baseUrl}/api/twiml-call-taken`;

      for (const sid of session?.sids || []) {
        if (sid !== callSid) {
          try {
            await twilio(
              process.env.TWILIO_ACCOUNT_SID,
              process.env.TWILIO_AUTH_TOKEN
            ).calls(sid).update({
              url: takenUrl,
              method: 'POST',
            });
            console.log(`✅ Disconnected call SID ${sid} with 'taken' message`);
          } catch (err) {
            console.error(`❌ Error disconnecting ${sid}:`, err.message);
          }
        }
      }

      // Join to conference
      const dial = twiml.dial();
      dial.conference({
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
      }, confName);
    }
  } else if (digits === '2') {
    // Agent declined
    twiml.say("You have declined the call. Goodbye.");
    twiml.hangup();

    const total = parseInt(await redis.get(`conf:${confName}:total`) || 0, 10);
    const rejected = parseInt(await redis.get(`conf:${confName}:rejected`) || 0, 10) + 1;
    await redis.set(`conf:${confName}:rejected`, rejected);

    if (rejected >= total) {
      console.log("Yes end the call")
      const customerSid = await redis.get(`conf:${confName}:customer`);

      if (customerSid) {
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

      const baseUrl = `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${req.headers.host}`;
      const url = `${baseUrl}/api/twiml-no-specialist`;

      try {
        // 1. First, update the customer's call to point to fallback
        await client.calls(customerSid).update({
          url,
          method: 'POST',
        });

        // 2. Then remove them from the conference
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

        console.log(`✅ Customer ${customerSid} will now hear 'no specialist available'`);
      } catch (err) {
        console.error("❌ Error redirecting customer:", err.message);
      }
            }
    }
  } else {
    // Invalid key
    twiml.say("Invalid input. Please try again.");
    twiml.redirect(`/api/twiml-join-conference?conf=${confName}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}