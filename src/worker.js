import { DurableObject } from "cloudflare:workers";
import SEED from "./seed.json";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status, error) => json({ error }, status);
const MAX_BYTES = 200_000;
const ID = /^[A-Za-z0-9_\-.~]{1,120}$/;
const CONFIG = new Set(["weights", "locations", "factors"]);
const UA = "dtla-apartment-hunt/1.0 (+https://dtla-apartment-hunt.jessiefjuarez.workers.dev)";
const COORDS = /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/;

// A pasted Google Maps link or "lat,lon" -> {lat, lon, label}. Short maps.app.goo.gl links are followed once.
async function pinFrom(q) {
  const c = q.match(COORDS);
  if (c) return { lat: Number(c[1]), lon: Number(c[2]), label: `${c[1]}, ${c[2]}` };
  if (!/^https?:\/\//i.test(q)) return null;
  let u;
  try { u = new URL(q); } catch { return null; }
  if (/^(maps\.app\.goo\.gl|goo\.gl)$/i.test(u.hostname)) {
    const r = await fetch(u.href, { redirect: "manual" }).catch(() => null);
    const next = r && r.headers.get("location");
    if (!next) return null;
    try { u = new URL(next); } catch { return null; }
  }
  if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return null;
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const href = decode(u.href);
  // "!3d<lat>!4d<lon>" is the place's own pin; "@lat,lon" is only where the map was centered.
  const m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    (u.searchParams.get("q") || u.searchParams.get("query") || "").match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
  if (!m) return null;
  const place = u.pathname.match(/\/place\/([^/]+)/);
  const label = place ? decode(place[1].replace(/\+/g, " ")) : `${m[1]}, ${m[2]}`;
  return { lat: Number(m[1]), lon: Number(m[2]), label };
}

// One shared store for the whole workspace. Keys: apt:<id>, cfg:<name>, rev.
export class HuntStore extends DurableObject {
  async seedOnce() {
    const s = this.ctx.storage;
    if (await s.get("seeded")) return;
    const puts = { seeded: true, rev: 1 };
    for (const [id, doc] of Object.entries(SEED.apts || {})) puts["apt:" + id] = doc;
    for (const [name, doc] of Object.entries(SEED.config || {})) puts["cfg:" + name] = doc;
    await s.put(puts);
  }

  async bump() {
    const rev = ((await this.ctx.storage.get("rev")) || 0) + 1;
    await this.ctx.storage.put("rev", rev);
    return rev;
  }

  // Drive time between two addresses, from OpenStreetMap: Nominatim to geocode, OSRM to route.
  // Results are cached here so each address pair is looked up once. Times are free-flow (no traffic).
  async drive(from, to) {
    const clean = (a) => {
      a = String(a || "").trim().slice(0, 200);
      return !a ? "" : /,/.test(a) ? a : a + ", Los Angeles, CA";
    };
    const point = (s) => {
      const m = String(s || "").trim().match(COORDS);
      return m ? { lat: Number(m[1]), lon: Number(m[2]), exact: true } : null;
    };
    const pa = point(from), pb = point(to);
    from = pa ? String(from).trim() : clean(from); to = pb ? String(to).trim() : clean(to);
    if (!from || !to) return { minutes: null, error: "Both addresses are needed." };
    const key = "drv4:" + from.toLowerCase() + "|" + to.toLowerCase();
    const hit = await this.ctx.storage.get(key);
    if (hit) return hit;
    const a = pa || (await this.geocode(from)), b = pb || (await this.geocode(to));
    if (!a || !b) return { minutes: null, error: "Couldn't find " + (!a ? from : to) + " on the map." };
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, {
      headers: { "user-agent": UA },
    });
    if (!r.ok) return { minutes: null, error: "The route service is busy. Try again later." };
    const route = (await r.json()).routes?.[0];
    if (!route) return { minutes: null, error: "No driving route found." };
    // OSRM assumes empty roads. Pad it for LA weekday traffic: at least 1.8x free-flow or 3.5 min per mile,
    // plus 2 min for lights and parking. Rough, but far closer to a real morning drive than free-flow.
    const freeFlow = route.duration / 60, miles = route.distance / 1609.34;
    const out = {
      minutes: Math.max(3, Math.round(Math.max(freeFlow * 1.8, miles * 3.5) + 2)),
      freeFlowMinutes: Math.max(1, Math.round(freeFlow)),
      miles: Math.round(miles * 10) / 10,
      approx: !(a.exact && b.exact),
    };
    await this.ctx.storage.put(key, out);
    return out;
  }

  // Address -> {lat, lon, exact}. Tries the US Census geocoder, then OpenStreetMap, then the ZIP code,
  // then the city, so a new or private address still gets an approximate drive time.
  async geocode(address) {
    const key = "geo3:" + address.toLowerCase();
    const hit = await this.ctx.storage.get(key);
    if (hit) return hit.lat == null ? null : hit;

    let loc = await this.census(address);
    if (!loc) loc = await this.nominatim("q=" + encodeURIComponent(address), "address");
    const zip = address.match(/\b(9\d{4})(?:-\d{4})?\b/);
    if (!loc && zip) loc = await this.nominatim("postalcode=" + zip[1] + "&country=us", "zip");
    const city = address.match(/([A-Za-z][A-Za-z .]+?),?\s+(?:CA|California)\b/);
    if (!loc && city) loc = await this.nominatim("q=" + encodeURIComponent(city[1].split(/\s+/).slice(-2).join(" ") + ", CA"), "city");

    const out = loc || { lat: null, lon: null };
    await this.ctx.storage.put(key, out);
    return loc;
  }

  async census(address) {
    try {
      const r = await fetch(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
          encodeURIComponent(address),
        { headers: { "user-agent": UA } },
      );
      if (!r.ok) return null;
      const m = (await r.json()).result?.addressMatches?.[0];
      return m ? { lat: m.coordinates.y, lon: m.coordinates.x, exact: true, via: "address", label: m.matchedAddress } : null;
    } catch {
      return null;
    }
  }

  async nominatim(query, via) {
    const exact = via === "address";
    // Nominatim's usage policy allows at most one request per second.
    const wait = (this.lastGeo || 0) + 1100 - Date.now();
    this.lastGeo = Date.now() + Math.max(0, wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&" + query, {
        headers: { "user-agent": UA, "accept-language": "en" },
      });
      if (!r.ok) return null;
      const first = (await r.json())[0];
      return first ? { lat: Number(first.lat), lon: Number(first.lon), exact, via, label: first.display_name } : null;
    } catch {
      return null;
    }
  }

  async readBody(req) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return null;
    try {
      const body = JSON.parse(text);
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  }

  async fetch(req) {
    await this.seedOnce();
    const s = this.ctx.storage;
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");

    if (req.method === "GET" && path === "/state") {
      const rev = (await s.get("rev")) || 0;
      const since = url.searchParams.get("since");
      if (since && Number(since) === rev) return new Response(null, { status: 204 });
      const strip = (map, n) => Object.fromEntries([...map].map(([k, v]) => [k.slice(n), v]));
      return json({
        rev,
        apts: strip(await s.list({ prefix: "apt:" }), 4),
        config: strip(await s.list({ prefix: "cfg:" }), 4),
      });
    }

    if (req.method === "GET" && path === "/geocode") {
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 2000);
      if (!q) return json({ found: false });
      const pin = await pinFrom(q);
      if (pin) return json({ found: true, exact: true, via: "pin", ...pin });
      if (/^https?:\/\//i.test(q)) return json({ found: false, error: "That link doesn't include a map location. Open the place in Google Maps and copy the link from the address bar." });
      const typedCity = /,/.test(q);
      const full = typedCity ? q.slice(0, 200) : q.slice(0, 200) + ", Los Angeles, CA";
      let g = await this.geocode(full);
      // Falling back to "Los Angeles" only because we assumed the city isn't a real match.
      if (g && g.via === "city" && !typedCity) g = null;
      return json(g ? { found: true, exact: !!g.exact, via: g.via, label: g.label || full, lat: g.lat, lon: g.lon } : { found: false });
    }

    if (req.method === "GET" && path === "/drive") {
      return json(await this.drive(url.searchParams.get("from"), url.searchParams.get("to")));
    }

    let m = path.match(/^\/apartments\/([^/]+)$/);
    if (m && ID.test(m[1])) {
      if (req.method === "PUT") {
        const body = await this.readBody(req);
        if (!body) return fail(400, "Send one apartment as a JSON object under 200 KB.");
        await s.put("apt:" + m[1], body);
        return json({ rev: await this.bump() });
      }
      if (req.method === "DELETE") {
        await s.delete("apt:" + m[1]);
        return json({ rev: await this.bump() });
      }
    }

    m = path.match(/^\/config\/([^/]+)$/);
    if (m && CONFIG.has(m[1]) && req.method === "PUT") {
      const body = await this.readBody(req);
      if (!body) return fail(400, "Send the setting as a JSON object.");
      await s.put("cfg:" + m[1], body);
      return json({ rev: await this.bump() });
    }

    return fail(404, "Not found.");
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    // Optional shared passcode: set a PASSCODE secret on the Worker to require it.
    if (env.PASSCODE && req.headers.get("x-passcode") !== env.PASSCODE) {
      return fail(401, "Passcode required.");
    }
    const stub = env.HUNT.get(env.HUNT.idFromName("workspace"));
    return stub.fetch(req);
  },
};
