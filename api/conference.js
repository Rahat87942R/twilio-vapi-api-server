import twilio from 'twilio';

export default function handler(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const confName = `conf_${Date.now()}`;

  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true,
  }, confName);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}