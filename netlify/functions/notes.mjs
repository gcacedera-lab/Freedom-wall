import { getStore } from "@netlify/blobs";

const THEMES = ["cream","blush","sage","lilac","midnight","sunset"];
const clean = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const last = new Map();

export default async (req, context) => {
  const store = getStore("wall");
  const path = new URL(req.url).pathname;
  const notes = (await store.get("notes", { type: "json" })) || [];

  if (req.method === "GET") return json(notes.slice().reverse().slice(0, 200));
  if (req.method !== "POST") return json({ error: "Not allowed" }, 405);

  let d = {};
  try { d = await req.json(); } catch {}

  if (path === "/api/like") {
    const n = notes.find((x) => x.id === d.id);
    if (n) n.likes = Math.max(0, n.likes + (d.unlike ? -1 : 1));
    await store.setJSON("notes", notes);
    return json({ ok: true });
  }

  const ip = context.ip || "x";
  const now = Date.now();
  if (now - (last.get(ip) || 0) < 10000)
    return json({ error: "Slow down, wait a few seconds." }, 429);

  const text = clean(d.text, 500);
  if (!text) return json({ error: "Note can't be empty." }, 400);
  let link = clean(d.link, 300);
  if (link && !/^https?:\/\//i.test(link)) link = "";
  const okHost = (u, re) => { try { const x = new URL(u); return x.protocol === "https:" && re.test(x.hostname); } catch { return false; } };
  let preview = clean(d.preview, 400);
  if (!okHost(preview, /(^|\.)(mzstatic\.com|itunes\.apple\.com)$/)) preview = "";
  let art = clean(d.art, 400);
  if (!okHost(art, /(^|\.)mzstatic\.com$/)) art = "";

  notes.push({
    id: notes.length ? notes[notes.length - 1].id + 1 : 1,
    text,
    name: clean(d.name, 30) || "Anonymous",
    song: clean(d.song, 80),
    artist: clean(d.artist, 60),
    link, preview, art, likes: 0, time: Math.floor(now / 1000),
    theme: THEMES.includes(d.theme) ? d.theme : THEMES[Math.floor(Math.random() * 5)],
    rot: Math.round((Math.random() * 3 - 1.5) * 10) / 10,
  });
  await store.setJSON("notes", notes);
  last.set(ip, now);
  return json({ ok: true });
};

export const config = { path: ["/api/notes", "/api/like"] };
