import { DurableObject } from "cloudflare:workers";
import SEED from "./seed.json";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status, error) => json({ error }, status);
const MAX_BYTES = 200_000;
const ID = /^[A-Za-z0-9_\-.~]{1,120}$/;
const CONFIG = new Set(["weights", "locations", "factors"]);

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
