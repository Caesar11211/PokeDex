// top-cards.mjs — builds data/top-cards.json: the most valuable Pokémon cards by Cardmarket trend price.
//
// GitHub runs this on a schedule (see .github/workflows/top-cards.yml) and saves the result to your site,
// so the app's Top cards tab opens instantly without your phone looking up 20,000+ prices.
//
// Data: TCGdex (tcgdex.dev), free and with no sign-up. Its card list doesn't include prices, so:
//   1. Quick way: ask TCGdex to sort cards by Cardmarket price, then check the first few really are in order.
//   2. Thorough way (if the quick way isn't supported): look up every Pokémon card's price, a few at a time.
// Needs Node 18 or newer (for fetch).

import { mkdir, writeFile } from "node:fs/promises";

const API = process.env.TCGDEX_API || "https://api.tcgdex.net/v2/en";
const KEEP = 500;                // how many cards go in the list
const AT_ONCE = 6;               // lookups running at the same time (kept low to be polite to a free service)
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(API + path, { headers: { "User-Agent": "living-dex-top-cards" } });
      if (res.ok) return await res.json();
      if (res.status === 404 || res.status === 400) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
      console.log(`${path}: HTTP ${res.status} (attempt ${attempt})`);
    } catch (e) {
      if (e.final) throw e;
      console.log(`${path}: ${e.message} (attempt ${attempt})`);
    }
    await sleep(1500 * attempt);
  }
  throw new Error(`Couldn't fetch ${path}`);
}

const priceOf = c => {
  const cm = c?.pricing?.cardmarket;
  return cm ? (cm.trend || cm.avg || cm["trend-holo"] || cm["avg-holo"] || 0) : 0;
};
const isPokemon = c => !c.category || /pok[eé]mon/i.test(c.category);
function summarise(c) {
  const eur = priceOf(c);
  const number = String(c.localId ?? "");
  return {
    id: c.id, name: c.name, number, set: c.set?.name ?? null, total: c.set?.cardCount?.official ?? null,
    rarity: c.rarity ?? null, image: c.image ? c.image + "/low.webp" : null, dex: Array.isArray(c.dexId) ? c.dexId : [],
    eur: Math.round(eur * 100) / 100,
    url: "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=" + encodeURIComponent(`${c.name} ${number.replace(/^0+(?=\d)/, "")}`),
  };
}
async function details(briefs, label) {
  const out = [];
  let done = 0;
  for (let i = 0; i < briefs.length; i += AT_ONCE) {
    const batch = await Promise.all(briefs.slice(i, i + AT_ONCE).map(b => get(`/cards/${encodeURIComponent(b.id)}`, 3).catch(() => null)));
    for (const c of batch) if (c) out.push(c);
    done += batch.length;
    if (done % 1200 < AT_ONCE || done === briefs.length) console.log(`${label}: ${done}/${briefs.length} looked up`);
  }
  return out;
}

// --- 1. Quick way: cards sorted by price, if TCGdex supports it ---
let picked = null;
try {
  const sorted = await get("/cards?category=Pokemon&sort:field=pricing.cardmarket.trend&sort:order=DESC&pagination:page=1&pagination:itemsPerPage=700");
  if (Array.isArray(sorted) && sorted.length >= 100) {
    const sample = (await details(sorted.slice(0, 40), "Checking sort")).map(priceOf);
    const inOrder = sample.length >= 30 && sample[0] > 20 && sample.every((p, i) => i === 0 || p <= sample[i - 1] + 0.01);
    if (inOrder) {
      console.log("TCGdex sorted the cards by price, so only the top ones need looking up.");
      picked = (await details(sorted, "Top cards")).filter(isPokemon).filter(c => priceOf(c) > 0);
    } else console.log("Sorting by price isn't supported, so every card will be checked.");
  }
} catch (e) { console.log(`Quick way not available (${e.message}), so every card will be checked.`); }

// --- 2. Thorough way: every Pokémon card ---
let checked = picked ? picked.length : 0;
if (!picked) {
  let briefs = await get("/cards?category=Pokemon").catch(() => null);
  if (!Array.isArray(briefs) || briefs.length < 1000) briefs = await get("/cards");
  console.log(`${briefs.length} cards to check.`);
  const all = await details(briefs, "All cards");
  picked = all.filter(isPokemon).filter(c => priceOf(c) > 0);
  checked = picked.length;
}

const cards = picked.map(summarise).sort((a, b) => b.eur - a.eur);
if (!cards.length) { console.error("No priced cards found, so the list wasn't changed."); process.exit(1); }

await mkdir("data", { recursive: true });
await writeFile("data/top-cards.json", JSON.stringify({
  updated: new Date().toISOString(),
  source: "Cardmarket trend prices via TCGdex",
  scanned: checked,
  method: picked && checked <= 700 ? "sorted" : "full",   // "full" means every Pokémon card was checked
  cards: cards.slice(0, KEEP),
}));
console.log(`Saved the top ${Math.min(KEEP, cards.length)} of ${checked} priced Pokémon cards. Most valuable: ${cards[0].name} (${cards[0].set}) at €${cards[0].eur}.`);
