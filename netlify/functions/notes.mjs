import { getStore } from "@netlify/blobs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const THEMES = ["cream","blush","sage","lilac","midnight","sunset"];
const EDIT_WINDOW_MS = 30 * 60 * 1000; // people can edit for 30 minutes
const clean = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const hash = (t) => createHash("sha256").update(String(t)).digest("hex");
const last = new Map();
const fails = new Map();

// Admin check. The password lives in Netlify (environment variable ADMIN_PASSWORD), never in the code.
const adminCheck = (pw, ip) => {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return "unset";
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) return "locked";
  const h = (v) => createHash("sha256").update(String(v ?? "")).digest();
  if (timingSafeEqual(h(pw), h(secret))) { fails.delete(ip); return "ok"; }
  f.n++;
  if (f.n >= 5) { f.n = 0; f.until = Date.now() + 10 * 60 * 1000; }
  fails.set(ip, f);
  return "bad";
};
const adminError = (r) =>
  r === "unset" ? json({ error: "Admin password isn't set up in Netlify yet." }, 503)
  : r === "locked" ? json({ error: "Too many tries. Wait 10 minutes." }, 429)
  : json({ error: "Wrong password." }, 401);

const okHost = (u, re) => { try { const x = new URL(u); return x.protocol === "https:" && re.test(x.hostname); } catch { return false; } };
const songFields = (d) => {
  let link = clean(d.link, 300);
  if (link && !/^https?:\/\//i.test(link)) link = "";
  let preview = clean(d.preview, 400);
  if (!okHost(preview, /(^|\.)(mzstatic\.com|itunes\.apple\.com)$/)) preview = "";
  let art = clean(d.art, 400);
  if (!okHost(art, /(^|\.)mzstatic\.com$/)) art = "";
  return { song: clean(d.song, 80), artist: clean(d.artist, 60), link, preview, art };
};

export default async (req, context) => {
  const store = getStore("wall");
  const path = new URL(req.url).pathname;
  const notes = (await store.get("notes", { type: "json" })) || [];

  if (req.method === "GET")
    return json(notes.slice().reverse().slice(0, 200).map(({ owner, ...n }) => n));
  if (req.method !== "POST") return json({ error: "Not allowed" }, 405);

  let d = {};
  try { d = await req.json(); } catch {}

  if (path === "/api/like") {
    const n = notes.find((x) => x.id === d.id);
    if (n) n.likes = Math.max(0, n.likes + (d.unlike ? -1 : 1));
    await store.setJSON("notes", notes);
    return json({ ok: true });
  }

  if (path === "/api/edit") {
    const n = notes.find((x) => x.id === d.id);
    if (!n || !n.owner || !d.token || hash(d.token) !== n.owner)
      return json({ error: "You can only edit your own note." }, 403);
    if (Date.now() - n.time * 1000 > EDIT_WINDOW_MS)
      return json({ error: "The 30-minute edit time has ended." }, 403);
    const text = clean(d.text, 500);
    if (!text) return json({ error: "Note can't be empty." }, 400);
    Object.assign(n, { text }, songFields(d));
    await store.setJSON("notes", notes);
    return json({ ok: true });
  }

  const ip = context.ip || "x";

  if (path === "/api/admin" || path === "/api/delete") {
    const r = adminCheck(d.password, ip);
    if (r !== "ok") return adminError(r);
    if (path === "/api/delete") {
      const i = notes.findIndex((x) => x.id === d.id);
      if (i >= 0) notes.splice(i, 1);
      await store.setJSON("notes", notes);
    }
    return json({ ok: true });
  }

  const now = Date.now();
  if (now - (last.get(ip) || 0) < 10000)
    return json({ error: "Slow down, wait a few seconds." }, 429);

  const text = clean(d.text, 500);
  if (!text) return json({ error: "Note can't be empty." }, 400);

  const token = randomUUID();
  const id = notes.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  notes.push({
    id,
    text,
    name: clean(d.name, 30) || "Anonymous",
    ...songFields(d),
    likes: 0, time: Math.floor(now / 1000),
    theme: THEMES.includes(d.theme) ? d.theme : THEMES[Math.floor(Math.random() * 5)],
    rot: Math.round((Math.random() * 3 - 1.5) * 10) / 10,
    owner: hash(token),
  });
  await store.setJSON("notes", notes);
  last.set(ip, now);
  return json({ ok: true, id, token });
};

export const config = { path: ["/api/notes", "/api/like", "/api/edit", "/api/admin", "/api/delete"] };
