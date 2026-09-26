// Free listing lookup: no AI. Reads what a listing page publishes about itself (schema.org JSON-LD,
// Open Graph tags) plus a few plain-text patterns (3-bed price, pets, parking, washer/dryer).

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
};

const decodeEntities = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Raw HTML -> the same parts the Chrome button sends: JSON-LD blocks, a few meta tags, and visible text.
export function htmlToParts(html, url) {
  const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const metaTag = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
    return m ? decodeEntities(m[1]) : null;
  };
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const text = decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").slice(0, 80000);
  return { url, ld, meta: { title: title ? decodeEntities(title).trim() : null, ogTitle: metaTag("og:title"), ogDesc: metaTag("og:description") || metaTag("description"), siteName: metaTag("og:site_name") }, text };
}

export async function fetchListing(url) {
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", cf: { cacheTtl: 3600 } });
    if (!r.ok) return { blocked: true, status: r.status };
    const type = r.headers.get("content-type") || "";
    if (!/html/i.test(type)) return { blocked: true, status: 415 };
    const html = (await r.text()).slice(0, 3_000_000);
    // Bot walls (Akamai, PerimeterX, Cloudflare) return a 200 with a challenge page instead of the listing.
    if (/px-captcha|Access Denied|Just a moment\.\.\.|captcha-delivery|Pardon Our Interruption/i.test(html.slice(0, 20000))) return { blocked: true, status: 403 };
    return { parts: htmlToParts(html, url) };
  } catch {
    return { blocked: true, status: 0 };
  }
}

const WANTED = /ApartmentComplex|Apartment|Residence|House|SingleFamilyResidence|Accommodation|LodgingBusiness|Place|LocalBusiness|RealEstateListing|Product|Offer/i;

function flatten(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => flatten(x, out));
  else if (v && typeof v === "object") {
    out.push(v);
    if (v["@graph"]) flatten(v["@graph"], out);
    if (v.mainEntity) flatten(v.mainEntity, out);
    if (v.containsPlace) flatten(v.containsPlace, out);
    if (v.itemOffered) flatten(v.itemOffered, out);
  }
  return out;
}

const typeOf = (n) => [].concat(n["@type"] || []).join(" ");
const str = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.name || v["@value"] || "" : v == null ? "" : String(v)).trim();

function addressOf(a) {
  if (!a) return null;
  if (typeof a === "string") return a.trim() || null;
  const parts = [str(a.streetAddress), str(a.addressLocality), [str(a.addressRegion), str(a.postalCode)].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

const money = (s) => {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return n >= 500 && n <= 60000 ? Math.round(n) : null;
};

export function parseListing(parts) {
  const nodes = [];
  for (const block of (parts.ld || []).slice(0, 30)) {
    try { flatten(JSON.parse(String(block).trim()), nodes); } catch {}
  }
  const main = nodes.find((n) => /ApartmentComplex|Residence|Apartment/i.test(typeOf(n)) && (n.address || n.name)) ||
    nodes.find((n) => WANTED.test(typeOf(n)) && n.address) || null;

  const text = String(parts.text || "");
  const meta = parts.meta || {};
  const found = [];
  const out = { name: null, address: null, lat: null, lon: null, rent: null, rentNote: null, baths: null, beds3: null,
    pets: null, petNote: null, parking: null, parkingNote: null, laundry: null, amenities: [], phone: null, summary: null };

  out.name = str(main?.name) || (meta.ogTitle || meta.title || "").split(/\s[|\-–]\s/)[0].trim() || null;
  // Building sites often title their homepage "Apartments for Rent in Downtown Los Angeles": use the site's own name instead.
  if (!main?.name && (!out.name || /apartments? for rent|for rent in|luxury apartments|^home$/i.test(out.name))) {
    let host = null;
    try { host = new URL(parts.url).hostname.replace(/^www\./, "").split(".")[0]; } catch {}
    out.name = str(meta.siteName) || (host && !/zillow|apartments|trulia|redfin|rent|hotpads|craigslist/i.test(host) ? host : null) || out.name;
  }
  out.address = addressOf(main?.address) || addressOf(nodes.find((n) => n.address)?.address);
  const geo = main?.geo || nodes.find((n) => n.geo)?.geo;
  if (geo && isFinite(Number(geo.latitude)) && isFinite(Number(geo.longitude))) { out.lat = Number(geo.latitude); out.lon = Number(geo.longitude); }
  out.phone = str(main?.telephone) || null;
  out.summary = (str(main?.description) || meta.ogDesc || "").replace(/\s+/g, " ").slice(0, 280) || null;

  // Amenities published as schema.org amenityFeature.
  const feats = nodes.flatMap((n) => [].concat(n.amenityFeature || [])).map((f) => str(f)).filter(Boolean);
  out.amenities = [...new Set(feats)].slice(0, 10);

  // Pets: structured first, then plain text.
  const petsLd = main?.petsAllowed;
  if (petsLd === true || /^(true|yes)/i.test(String(petsLd))) out.pets = true;
  else if (petsLd === false || /^(false|no)/i.test(String(petsLd))) out.pets = false;
  const petLine = text.match(/[^\n.]{0,80}\b(dogs?|pets?)\b[^\n.]{0,120}/i);
  if (out.pets == null) {
    if (/\bno pets\b|pets? not allowed|no dogs\b/i.test(text)) out.pets = false;
    else if (/\b(pet|dog)[- ]friendly\b|\bdogs? (are )?(allowed|welcome|ok)\b|\bpets? (are )?(allowed|welcome)\b/i.test(text)) out.pets = true;
  }
  if (petLine) out.petNote = petLine[0].replace(/\s+/g, " ").trim().slice(0, 160);

  // Washer/dryer in the unit.
  if (/in[- ](unit|home|suite)\s+(washer|laundry|w\/d)|washer\s*(\/|&|and)\s*dryer\s+(in|included)|\bw\/d in[- ]unit\b/i.test(text) ||
      out.amenities.some((a) => /in[- ](unit|home).*(washer|laundry)|washer.*dryer/i.test(a))) out.laundry = true;
  else if (/(shared|on-site|community) laundry|laundry (room|facility)/i.test(text) && !/washer\s*(\/|&|and)\s*dryer/i.test(text)) out.laundry = false;

  // Parking: availability and a monthly price if one is stated.
  const parkPrice = text.match(/parking[^\n$]{0,60}\$\s?(\d{2,3})(?:\s*(?:\/|per)\s*(?:mo|month))?/i);
  if (/\b(garage|parking)\b/i.test(text)) out.parking = !/no parking|street parking only/i.test(text);
  if (parkPrice) out.parkingNote = `Parking from about $${parkPrice[1]}/mo`;

  // 3-bedroom rent and baths: offers in the JSON-LD, then "3 Bed ... $4,200" style text.
  const threeBedOffers = nodes.filter((n) => Number(n.numberOfRooms || n.numberOfBedrooms) === 3 || /3\s*(bed|bd|br)/i.test(str(n.name)));
  const ldPrices = threeBedOffers.flatMap((n) => [].concat(n.offers || n).map((o) => money(o.lowPrice || o.price || (o.priceSpecification || {}).price))).filter(Boolean);
  const textPrices = [...text.matchAll(/\b3\s*(?:bed(?:room)?s?|bd|br)\b[^\n$]{0,90}\$\s?([\d,]{4,6})/gi)].map((m) => money(m[1])).filter(Boolean);
  const prices = ldPrices.length ? ldPrices : textPrices;
  if (prices.length) { out.rent = Math.min(...prices); out.rentNote = `3 bed from $${out.rent.toLocaleString("en-US")}/mo on the listing`; out.beds3 = true; found.push("3-bed price"); }
  else if (/\b3\s*(?:bed(?:room)?s?|bd|br)\b/i.test(text)) out.beds3 = true;
  const bathMatch = text.match(/\b3\s*(?:bed(?:room)?s?|bd|br)\b[^\n0-9]{0,20}(\d(?:\.5)?)\s*(?:bath(?:room)?s?|ba)\b/i);
  if (bathMatch) out.baths = Number(bathMatch[1]);
  if (out.rent == null) {
    const range = str(main?.priceRange) || (main?.offers && (money(main.offers.lowPrice) ? `$${money(main.offers.lowPrice)}+` : ""));
    if (range) out.rentNote = `Listed price range: ${range} (not 3-bed specific)`;
  }

  if (out.address) found.push("address");
  if (out.pets != null) found.push("pets");
  if (out.parking != null) found.push("parking");
  if (out.laundry != null) found.push("washer/dryer");
  if (out.amenities.length) found.push("amenities");
  if (out.baths != null) found.push("bathrooms");
  out.found = found;
  return out;
}

// "…/ava-little-tokyo-los-angeles-ca/vfrceng/" -> "ava little tokyo" (used when a site won't let us read the page).
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).sort((a, b) => b.length - a.length)[0] || u.hostname.split(".").slice(-2)[0];
    return decodeURIComponent(seg).replace(/[-_]+/g, " ").replace(/\b(los angeles|ca|apartments?|for rent|\d{5})\b/gi, " ").replace(/\s+/g, " ").trim() || null;
  } catch {
    return null;
  }
}
