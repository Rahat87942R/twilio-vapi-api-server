import twilio from 'twilio';

export default function handler(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  twiml.say("You have a customer waiting. Connecting you now.");
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
  }, "my_conference_room");

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}