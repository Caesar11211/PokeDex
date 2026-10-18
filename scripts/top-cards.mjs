// top-cards.mjs — builds data/top-cards.json: the most valuable Pokémon cards by Cardmarket trend price.
//
// GitHub runs this once a day (see .github/workflows/top-cards.yml) and saves the result to your site,
// so the app's Top cards tab opens instantly without your phone looking up 20,000+ prices.
//
// Data: the Pokémon TCG API (pokemontcg.io), which returns cards with their Cardmarket prices, 250 at a time.
// Optional: add a free API key as a repository secret called POKEMONTCG_API_KEY for higher limits.
// Needs Node 18 or newer (for fetch).

import { mkdir, writeFile } from "node:fs/promises";

const API = process.env.PTCG_API || "https://api.pokemontcg.io/v2";
const KEY = process.env.POKEMONTCG_API_KEY || "";
const KEEP = 500;                       // how many cards go in the list
const FIELDS = "id,name,number,set,images,cardmarket,nationalPokedexNumbers,rarity,supertype";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPage(page) {
  const url = `${API}/cards?page=${page}&pageSize=250&orderBy=id&select=${FIELDS}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: KEY ? { "X-Api-Key": KEY } : {} });
      if (res.ok) return await res.json();
      console.log(`Page ${page}: HTTP ${res.status} (attempt ${attempt})`);
    } catch (e) {
      console.log(`Page ${page}: ${e.message} (attempt ${attempt})`);
    }
    await sleep(3000 * attempt);
  }
  throw new Error(`Couldn't fetch page ${page}`);
}

const cards = [];
let page = 1, total = Infinity, seen = 0;
while (seen < total) {
  const res = await getPage(page);
  const data = res.data || [];
  total = res.totalCount ?? seen + data.length;
  seen += data.length;
  for (const c of data) {
    if (c.supertype && !/pok[eé]mon/i.test(c.supertype)) continue;     // skip Trainer and Energy cards
    const p = c.cardmarket?.prices || {};
    const eur = p.trendPrice || p.averageSellPrice || 0;
    if (!(eur > 0)) continue;
    cards.push({
      id: c.id, name: c.name, number: c.number, set: c.set?.name ?? null, total: c.set?.printedTotal ?? null,
      rarity: c.rarity ?? null, image: c.images?.small ?? null, dex: c.nationalPokedexNumbers ?? [],
      eur: Math.round(eur * 100) / 100, eurHolo: p.reverseHoloTrend ? Math.round(p.reverseHoloTrend * 100) / 100 : null,
      url: c.cardmarket?.url ?? null,
    });
  }
  console.log(`Page ${page}: ${seen}/${total} cards checked, ${cards.length} priced Pokémon so far`);
  if (!data.length) break;
  page++;
  await sleep(KEY ? 150 : 700);
}

cards.sort((a, b) => b.eur - a.eur);
if (!cards.length) { console.error("No priced cards found, so the list wasn't changed."); process.exit(1); }

await mkdir("data", { recursive: true });
await writeFile("data/top-cards.json", JSON.stringify({
  updated: new Date().toISOString(),
  source: "Cardmarket trend prices via the Pokémon TCG API",
  scanned: cards.length,
  cards: cards.slice(0, KEEP),
}));
console.log(`Saved the top ${Math.min(KEEP, cards.length)} of ${cards.length} priced Pokémon cards.`);
