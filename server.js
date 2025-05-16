require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const twilio = require("twilio");
const { redis } = require("./lib/redis");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  FROM_NUMBER,
  VAPI_BASE_URL,
  PHONE_NUMBER_ID,
  ASSISTANT_ID,
  PRIVATE_API_KEY,
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.get("/", (req, res) => {
  res.send("Server is running");
});

// Handle inbound call
app.post("/inbound_call", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const caller = req.body.Caller;
    console.log("Inbound call from:", caller, "CallSid:", callSid);

    await redis.set(`call:${caller}`, callSid, { ex: 600 });

    const response = await axios.post(
      `${VAPI_BASE_URL}/call`,
      {
        phoneNumberId: PHONE_NUMBER_ID,
        phoneCallProviderBypassEnabled: true,
        customer: { number: caller },
        assistantId: ASSISTANT_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${PRIVATE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const returnedTwiml = response.data.phoneCallProviderDetails.twiml;
    return res.type("text/xml").send(returnedTwiml);
  } catch (err) {
    console.error("Error in /inbound_call:", err?.response?.data || err.message);
    return res.status(500).send("Internal Server Error");
  }
});

app.post("/connect", async (req, res) => {
  try {
    const caller = req.body.caller;
    const callSid = await redis.get(`call:${caller}`);
    const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const baseUrl = `${protocol}://${req.get("host")}`;
    const conferenceUrl = `${baseUrl}/conference`;
    const joinConfUrl = `${baseUrl}/twiml-join-conference`;
    const statusCallbackUrl = `${baseUrl}/participant-status`;

    const confName = `conf_${Date.now()}`;
    await redis.set(`conf:${callSid}`, { name: confName, sids: [] }, { ex: 600 });

    await client.calls(callSid).update({
      url: conferenceUrl,
      method: "POST",
    });

    const specialistNumbers = ["+18304838832", "+12813787468"];

    for (const number of specialistNumbers) {
      const call = await client.calls.create({
        from: FROM_NUMBER,
        to: number,
        url: joinConfUrl,
        method: "POST",
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: "POST",
      });

      const session = await redis.get(`conf:${callSid}`);
      session.sids.push(call.sid);
      await redis.set(`conf:${callSid}`, session, { ex: 600 });
    }

    return res.json({ status: "Specialist dialing initiated" });
  } catch (err) {
    console.error("❌ Error in /connect:", err);
    return res.status(500).json({ error: "Failed to connect" });
  }
});

app.post("/conference", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const confName = `conf_${Date.now()}`;

  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true,
  }, confName);

  return res.type("text/xml").send(twiml.toString());
});

app.post("/twiml-join-conference", (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  twiml.say("You have a customer waiting. Connecting you now.");
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
  }, "my_conference_room");

  res.type("text/xml").send(twiml.toString());
});

app.post("/participant-status", async (req, res) => {
  const { CallSid, CallStatus, ParentCallSid } = req.body;
  console.log(`Status update for ${CallSid}: ${CallStatus}`);

  if (CallStatus === "in-progress") {
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

  res.sendStatus(200);
});

// Start server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
