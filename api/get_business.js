import { formatPhoneNumber } from '../util/formatPhoneNumber';

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }
  
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.ACCESS_TOKEN}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { zipcode, service } = await req.json();
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

  if (!zipcode || !service) {
    return new Response(JSON.stringify({ error: "zipcode and service are required" }), {
      status: 400,
    });
  }

  try {
    // Step 1: Zip code to lat/lng
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${zipcode}&key=${GOOGLE_API_KEY}`
    );
    const geoData = await geoRes.json();
    const location = geoData.results?.[0]?.geometry?.location;

    if (!location) {
      return new Response(JSON.stringify({ error: "Invalid ZIP code" }), { status: 400 });
    }

    const businesses = [];
    let pageToken = "";
    let attempts = 0;

    // Step 2: Query Places API until 20 businesses are collected
    while (businesses.length < 20 && attempts < 5) {
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=10000&keyword=${encodeURIComponent(
        service
      )}&type=point_of_interest&key=${GOOGLE_API_KEY}${pageToken ? `&pagetoken=${pageToken}` : ""}`;

      // Google map api limit
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
            phone: formatPhoneNumber(result.formatted_phone_number)
          });
        }
      }

      pageToken = placeData.next_page_token || "";
      attempts++;
    }

    return new Response(JSON.stringify({ businesses }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}