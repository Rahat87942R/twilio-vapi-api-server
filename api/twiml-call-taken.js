import twilio from 'twilio';

export default function handler(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  twiml.say("Sorry, this call is no longer available.");
  twiml.pause({ length: 2 });
  twiml.hangup();

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}
