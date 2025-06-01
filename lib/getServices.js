import formatPhoneNumber from "../util/formatPhoneNumber.js";

export async function getServices(zipcode, serviceName) {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

  const geoRes = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${zipcode}&key=${GOOGLE_API_KEY}`
  );
  const geoData = await geoRes.json();
  const location = geoData.results?.[0]?.geometry?.location;

  if (!location) throw new Error('Invalid ZIP code');

  const businesses = [];
  let pageToken = '';
  let attempts = 0;

  while (businesses.length < 20 && attempts < 5) {
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=10000&keyword=${encodeURIComponent(serviceName)}&type=point_of_interest&key=${GOOGLE_API_KEY}${pageToken ? `&pagetoken=${pageToken}` : ''}`;

    if (pageToken) await new Promise((res) => setTimeout(res, 2000));

    const placeRes = await fetch(nearbyUrl);
    const placeData = await placeRes.json();

    for (const place of placeData.results) {
      if (businesses.length >= 20) break;

      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number&key=${GOOGLE_API_KEY}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();

      const result = detailData.result;
      if (result && result.name && result.formatted_phone_number) {
        businesses.push({
          name: result.name,
          phone: formatPhoneNumber(result.formatted_phone_number),
        });
      }
    }

    pageToken = placeData.next_page_token || '';
    attempts++;
  }

  return businesses;
}