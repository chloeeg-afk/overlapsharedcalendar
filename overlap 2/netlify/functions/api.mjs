import { getStore } from "@netlify/blobs";

const KINDS = ["event", "person", "day"];
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const store = getStore("overlap");
  try {
    if (req.method === "GET") {
      const out = { events: [], people: {}, days: {} };
      const { blobs } = await store.list();
      await Promise.all(blobs.map(async (b) => {
        const i = b.key.indexOf(":");
        const kind = b.key.slice(0, i), id = b.key.slice(i + 1);
        const v = await store.get(b.key, { type: "json" });
        if (!v) return;
        if (kind === "event") out.events.push({ id, ...v });
        else if (kind === "person") out.people[id] = v;
        else if (kind === "day") out.days[id] = v;
      }));
      return json(out);
    }
    const body = await req.json().catch(() => ({}));
    const { kind, id, data } = body;
    if (!KINDS.includes(kind) || typeof id !== "string" || !id || id.length > 80) return json({ error: "bad request" }, 400);
    if (req.method === "POST") {
      if (!data || typeof data !== "object" || JSON.stringify(data).length > 100000) return json({ error: "bad data" }, 400);
      await store.setJSON(`${kind}:${id}`, data);
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      await store.delete(`${kind}:${id}`);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config = { path: "/api" };
