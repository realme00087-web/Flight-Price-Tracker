// AeroSmart AI: Amadeus proxy. Credentials stay on the server (Firebase secrets).
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");

const CLIENT_ID = defineSecret("AMADEUS_CLIENT_ID");
const CLIENT_SECRET = defineSecret("AMADEUS_CLIENT_SECRET");
// test.api.amadeus.com = test data. Switch to api.amadeus.com with production keys for real fares.
const HOST = defineString("AMADEUS_HOST", { default: "test.api.amadeus.com" });

let cached = { value: null, expires: 0 };

async function getToken() {
  if (cached.value && Date.now() < cached.expires) return cached.value;
  const r = await fetch(`https://${HOST.value()}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID.value(),
      client_secret: CLIENT_SECRET.value(),
    }),
  });
  const j = await r.json();
  if (!r.ok) throw { status: 502, message: "Amadeus authentication failed. Check your API key and secret.", detail: j };
  cached = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.value;
}

async function amadeus(path, options = {}) {
  const r = await fetch(`https://${HOST.value()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const first = (j.errors && j.errors[0]) || {};
    throw { status: r.status === 429 ? 429 : 400, message: first.detail || first.title || "Amadeus request failed", detail: j.errors };
  }
  return j;
}

const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"];
const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

exports.api = onRequest({ secrets: [CLIENT_ID, CLIENT_SECRET], cors: true, region: "us-central1" }, async (req, res) => {
  try {
    const path = req.path.replace(/\/+$/, "");

    if (req.method === "GET" && path.endsWith("/airports")) {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json({ data: [] });
      const params = new URLSearchParams({ subType: "CITY,AIRPORT", keyword: q, "page[limit]": "10", view: "LIGHT" });
      const j = await amadeus(`/v1/reference-data/locations?${params}`);
      return res.json({
        data: (j.data || []).map((l) => ({
          code: l.iataCode, type: l.subType, name: l.name,
          city: l.address && l.address.cityName, country: l.address && l.address.countryName,
        })),
      });
    }

    if (req.method === "POST" && path.endsWith("/flights")) {
      const { legs, adults = 1, cabin = "ECONOMY", currency = "AED" } = req.body || {};
      const n = Number(adults);
      if (!Array.isArray(legs) || !legs.length || legs.length > 6) throw { status: 400, message: "Add between 1 and 6 flights." };
      if (!(n >= 1 && n <= 9)) throw { status: 400, message: "Passengers must be between 1 and 9." };
      if (!CABINS.includes(cabin)) throw { status: 400, message: "Unknown cabin class." };
      for (const l of legs) {
        if (!IATA.test(l.from) || !IATA.test(l.to) || !DATE.test(l.date)) throw { status: 400, message: "Each flight needs origin, destination and date." };
      }
      const body = {
        currencyCode: /^[A-Z]{3}$/.test(currency) ? currency : "AED",
        originDestinations: legs.map((l, i) => ({
          id: String(i + 1), originLocationCode: l.from, destinationLocationCode: l.to, departureDateTimeRange: { date: l.date },
        })),
        travelers: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), travelerType: "ADULT" })),
        sources: ["GDS"],
        searchCriteria: {
          maxFlightOffers: 50,
          flightFilters: { cabinRestrictions: [{ cabin, coverage: "MOST_SEGMENTS", originDestinationIds: legs.map((_, i) => String(i + 1)) }] },
        },
      };
      const j = await amadeus("/v2/shopping/flight-offers", { method: "POST", body: JSON.stringify(body) });
      return res.json({ data: j.data || [], dictionaries: j.dictionaries || {} });
    }

    res.status(404).json({ error: "Not found" });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Server error", detail: e.detail });
  }
});
