// top-cards.mjs — builds data/top-cards.json: the most valuable Pokémon cards by TCGplayer market price.
//
// GitHub runs this on a schedule (see .github/workflows/top-cards.yml) and saves the result to your site,
// so the app's Top cards tab opens instantly without your phone looking up 17,000+ prices.
//
// Data: the Pokémon TCG API (pokemontcg.io), free and with no sign-up. It lists every card with its
// TCGplayer prices, 250 cards a page, so the whole lot takes about 70 requests. It fails a lot (in
// Oct 2026 about two requests in three got a server error or a dropped connection) but works when
// asked again, so every request is retried many times, pages that still fail get a second round at
// the end, and a few missing pages don't stop the list being saved: cards from those pages are kept
// from the previous list instead.
// Needs Node 18 or newer (for fetch).

import { mkdir, readFile, writeFile } from "node:fs/promises";

const API = process.env.PTCG_API || "https://api.pokemontcg.io/v2";
const KEEP = 500;                // how many cards go in the list
const PAGE = 250;                // the most the API gives per page
const sleep = ms => new Promise(r => setTimeout(r, ms));
const headers = { "User-Agent": "living-dex-top-cards", ...(process.env.PTCG_KEY ? { "X-Api-Key": process.env.PTCG_KEY } : {}) };

async function get(path, tries = 15) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(API + path, { headers, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      if (res.status === 404 || res.status === 400) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
      console.log(`${path}: HTTP ${res.status} (attempt ${attempt})`);
    } catch (e) {
      if (e.final) throw e;
      console.log(`${path}: ${e.message} (attempt ${attempt})`);
    }
    await sleep(Math.min(1000 * attempt, 10000));
  }
  throw new Error(`Couldn't fetch ${path}`);
}

// The card's most valuable finish (normal, holo, reverse holo, 1st Edition), in US dollars
function bestPrice(c) {
  let best = 0, finish = null;
  for (const [k, v] of Object.entries(c?.tcgplayer?.prices || {})) {
    const p = v?.market ?? v?.mid;
    if (typeof p === "number" && p > best) { best = p; finish = k; }
  }
  return { usd: best, finish };
}
const FINISH = k => /reverse/i.test(k) ? "Reverse holo" : /1st/i.test(k) ? "1st Edition" : /holo/i.test(k) ? "Holo" : "Normal";

function summarise(c) {
  const { usd, finish } = bestPrice(c);
  return {
    id: c.id, name: c.name, number: String(c.number ?? ""), set: c.set?.name ?? null, total: c.set?.printedTotal ?? null,
    rarity: [c.rarity, finish ? FINISH(finish) : null].filter(Boolean).join(" · ") || null,
    image: c.images?.small ?? null, dex: c.nationalPokedexNumbers ?? [],
    usd: Math.round(usd * 100) / 100,
    url: c.tcgplayer?.url ?? null,
  };
}

const q = encodeURIComponent("supertype:pokemon");
const select = "id,name,number,set,rarity,images,tcgplayer,nationalPokedexNumbers";
const pagePath = page => `/cards?q=${q}&orderBy=id&page=${page}&pageSize=${PAGE}&select=${select}`;
const first = await get(pagePath(1), 30);
const pages = Math.ceil((first.totalCount || 0) / PAGE);
console.log(`${first.totalCount} Pokémon cards, ${pages} pages.`);
const all = [...(first.data || [])];
let failed = [];
for (let page = 2; page <= pages; page++) {
  try {
    all.push(...((await get(pagePath(page))).data || []));
  } catch {
    failed.push(page);
  }
  if (page % 10 === 0 || page === pages) console.log(`${page}/${pages} pages${failed.length ? ` (${failed.length} to try again)` : ""}`);
  await sleep(300);
}
if (failed.length) {
  console.log(`Trying ${failed.length} page(s) again: ${failed.join(", ")}`);
  await sleep(30000);
  const still = [];
  for (const page of failed) {
    try {
      all.push(...((await get(pagePath(page), 25)).data || []));
    } catch {
      still.push(page);
    }
  }
  failed = still;
}
if (failed.length > Math.max(3, pages * 0.1)) {
  console.error(`${failed.length} of ${pages} pages couldn't be fetched (${failed.join(", ")}), so the list wasn't changed. It will try again next time.`);
  process.exit(1);
}
// Cards on pages that couldn't be fetched keep their place from the previous list
const seen = new Set(all.map(c => c.id));
let kept = [];
if (failed.length) {
  try {
    const prev = JSON.parse(await readFile("data/top-cards.json", "utf8"));
    if (prev.currency === "USD") kept = (prev.cards || []).filter(c => !seen.has(c.id));
  } catch {}
  console.log(`${failed.length} page(s) still failed (${failed.join(", ")}); kept ${kept.length} cards from the previous list for them.`);
}

const cards = [...all.map(summarise), ...kept].filter(c => c.usd > 0).sort((a, b) => b.usd - a.usd);
if (!cards.length) { console.error("No priced cards found, so the list wasn't changed."); process.exit(1); }

await mkdir("data", { recursive: true });
await writeFile("data/top-cards.json", JSON.stringify({
  updated: new Date().toISOString(),
  source: "TCGplayer market prices via the Pokémon TCG API",
  currency: "USD",
  scanned: cards.length,
  method: "full",
  missingPages: failed.length,
  cards: cards.slice(0, KEEP),
}));
console.log(`Saved the top ${Math.min(KEEP, cards.length)} of ${cards.length} priced Pokémon cards. Most valuable: ${cards[0].name} (${cards[0].set}) at $${cards[0].usd}.`);
