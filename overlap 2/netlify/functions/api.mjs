import crypto from "node:crypto";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

const KINDS = ["event", "person", "day", "sub"];
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Push keys are created once and kept in storage, so no setup is needed.
async function getVapid(store) {
  let v = await store.get("meta:vapid", { type: "json" });
  if (v) return v;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pj = publicKey.export({ format: "jwk" });
  const kj = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, "base64url"), Buffer.from(pj.y, "base64url")]).toString("base64url");
  v = { publicKey: pub, privateKey: kj.d };
  await store.setJSON("meta:vapid", v);
  return v;
}

async function notify(store, who, body) {
  const v = await getVapid(store);
  const { blobs } = await store.list({ prefix: "sub:" });
  await Promise.allSettled(blobs.map(async (b) => {
    const rec = await store.get(b.key, { type: "json" });
    if (!rec || !rec.sub || rec.who === who) return;
    try {
      await webpush.sendNotification(rec.sub, JSON.stringify({ title: "Overlap", body }), {
        vapidDetails: { subject: "mailto:overlap@example.com", publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 3600,
      });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await store.delete(b.key);
    }
  }));
}

function describe(kind, id, prev, data, who) {
  const w = who || "Someone";
  if (kind === "day") return `${w} commented on ${id}`;
  if (!prev) return `${w} added "${data.title}" on ${data.date}`;
  const pr = prev.resp || {}, nr = data.resp || {};
  if (who && pr[who] !== nr[who]) return nr[who] ? `${w} said ${nr[who]} to "${data.title}"` : `${w} cleared their reply to "${data.title}"`;
  if ((data.comments || []).length > (prev.comments || []).length) return `${w} commented on "${data.title}"`;
  return `${w} updated "${data.title}"`;
}

export default async (req) => {
  const store = getStore("overlap");
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.searchParams.get("vapid")) return json({ key: (await getVapid(store)).publicKey });
      const out = { events: [], people: {}, days: {} };
      const { blobs } = await store.list();
      await Promise.all(blobs.map(async (b) => {
        const i = b.key.indexOf(":");
        const kind = b.key.slice(0, i), id = b.key.slice(i + 1);
        if (!["event", "person", "day"].includes(kind)) return;
        const v = await store.get(b.key, { type: "json" });
        if (!v) return;
        if (kind === "event") out.events.push({ id, ...v });
        else if (kind === "person") out.people[id] = v;
        else out.days[id] = v;
      }));
      return json(out);
    }
    const body = await req.json().catch(() => ({}));
    const { kind, id, data, who } = body;
    if (!KINDS.includes(kind) || typeof id !== "string" || !id || id.length > 80) return json({ error: "bad request" }, 400);
    const key = `${kind}:${id}`;
    if (req.method === "POST") {
      if (!data || typeof data !== "object" || JSON.stringify(data).length > 100000) return json({ error: "bad data" }, 400);
      const prev = kind === "event" || kind === "day" ? await store.get(key, { type: "json" }) : null;
      await store.setJSON(key, data);
      if (kind === "event" || kind === "day") {
        try { await notify(store, who, describe(kind, id, prev, data, who)); } catch (e) {}
      }
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      const prev = kind === "event" ? await store.get(key, { type: "json" }) : null;
      await store.delete(key);
      if (prev) { try { await notify(store, who, `${who || "Someone"} removed "${prev.title}"`); } catch (e) {} }
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config = { path: "/api" };
