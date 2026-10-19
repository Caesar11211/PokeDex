// graded-prices.mjs — builds data/graded.json: real PSA 8/9/10 prices from eBay sold listings.
//
// GitHub runs this every day (see .github/workflows/graded-prices.yml) and saves the result to your site.
// The app then shows real graded prices instead of its rough estimates, for the cards that have them.
//
// Which cards: the ones listed in data/graded-watch.json. Make that list in the app
// (Value → Grading → "Copy list for real graded prices") and paste it into the file on GitHub.
//
// Data: PokemonPriceTracker (pokemonpricetracker.com). Free tier = 100 credits a day.
//   - Finding a card the first time: 1 credit per search result (we ask for 10 at most).
//   - Graded prices for a card we've found: 2 credits (1 for the card, 1 for the eBay data).
// So about 40 cards fit in a day once they've all been found. Anything left over is done the next day.
// The card IDs it finds are saved, so each card is only searched for once.
//
// Needs Node 18+ and a secret called PPT_API_KEY (Settings → Secrets and variables → Actions).

import { readFile, writeFile, mkdir } from "node:fs/promises";

const API = process.env.PPT_API || "https://www.pokemonpricetracker.com/api/v2";
const KEY = process.env.PPT_API_KEY;
const DAILY_BUDGET = +(process.env.DAILY_BUDGET || 95);   // leave a few credits spare out of the 100
const REFRESH_DAYS = 6;                                     // graded prices only change weekly on their side
const MIN_SALES = 2;                                        // fewer sales than this isn't a price, it's a guess
const OUT = "data/graded.json";
const WATCH = "data/graded-watch.json";

if (!KEY) { console.error("No PPT_API_KEY secret set. See the README: 'Setting up real graded prices'."); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let spent = 0, remaining = null, shownShape = false;

async function get(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
    const used = +res.headers.get("x-api-calls-consumed");
    if (used > 0) spent += used;
    const left = res.headers.get("x-ratelimit-daily-remaining");
    if (left != null && left !== "") remaining = +left;
    if (res.ok) {
      const body = await res.json();
      if (!shownShape) {   // print what one answer looks like, to help fix things if their format changes
        shownShape = true;
        const first = listOf(body)[0];
        console.log("Example answer from the API (first card's fields):", first ? JSON.stringify(first).slice(0, 1500) : JSON.stringify(body).slice(0, 600));
      }
      return body;
    }
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`The API refused the key (HTTP ${res.status}). Check the PPT_API_KEY secret.`), { stop: true });
    if (res.status === 429) throw Object.assign(new Error("Out of credits for today (HTTP 429). The rest will be done tomorrow."), { stop: true });
    if (res.status === 404) return null;
    console.log(`${url.pathname}: HTTP ${res.status} (attempt ${attempt})`);
    await sleep(2000 * attempt);
  }
  throw new Error(`Couldn't reach ${path}`);
}

// Their answers come wrapped as { data: [...] } or { data: {...} }; be relaxed about it.
const listOf = b => Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : b?.data ? [b.data] : Array.isArray(b?.cards) ? b.cards : [];
const pick = (o, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((x, p) => x?.[p], o); if (v != null && v !== "") return v; } return null; };
const bareNumber = n => String(n ?? "").split("/")[0].trim().replace(/^0+(?=\w)/, "").toLowerCase();
const words = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tcgIdOf = c => pick(c, "tcgPlayerId", "tcgplayerId", "tcgPlayerID", "productId");
const numberOf = c => pick(c, "cardNumber", "number", "card_number", "localId");
const setNameOf = c => pick(c, "setName", "set.name", "set_name", "set");

// Find a watched card in their database by name + set, then pick the one with the same card number.
async function findCard(w) {
  const name = String(w.name || "").replace(/\s*\(.*?\)\s*/g, " ").trim();
  const tries = [{ search: name, set: w.set, limit: 10 }, { search: `${name} ${bareNumber(w.number)}`, limit: 10 }];
  for (const params of tries) {
    if (spent + 10 > DAILY_BUDGET) return { budget: true };
    const body = await get("/cards", params);
    const hits = listOf(body).filter(c => bareNumber(numberOf(c)) === bareNumber(w.number));
    // Several printings with the same number (e.g. a promo)? Prefer the one whose set name matches.
    const best = hits.find(c => words(typeof setNameOf(c) === "string" ? setNameOf(c) : "") === words(w.set)) || (hits.length === 1 ? hits[0] : null);
    if (best && tcgIdOf(best)) return { tcgPlayerId: String(tcgIdOf(best)), matched: `${pick(best, "name")} ${numberOf(best)} (${setNameOf(best)})` };
  }
  return { missing: true };
}

// Turn their eBay block into what the app needs, in US dollars (eBay sales are mostly US).
function gradesFrom(card) {
  const by = pick(card, "ebay.salesByGrade", "ebay.grades", "ebay") || {};
  const out = {};
  for (const g of ["psa8", "psa9", "psa10"]) {
    const s = by[g] || by[g.toUpperCase()] || by[g.replace("psa", "psa_")];
    if (!s) continue;
    const count = +(s.count ?? s.salesCount ?? 0);
    const median = +(s.medianPrice ?? s.median ?? s.avg ?? s.averagePrice ?? 0);
    if (count >= MIN_SALES && median > 0) out[g] = { usd: Math.round(median * 100) / 100, sales: count, last: s.lastSaleDate || null };
  }
  return out;
}

const readJSON = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };
const watch = await readJSON(WATCH, { cards: [] });
const old = await readJSON(OUT, { cards: {} });
const list = (Array.isArray(watch) ? watch : watch.cards || []).filter(w => w && w.id && w.name && w.number);
console.log(`${list.length} cards on the watch list. Budget ${DAILY_BUDGET} credits.`);

const cards = { ...old.cards };
const age = w => cards[w.id]?.checked ? (Date.now() - Date.parse(cards[w.id].checked)) / 864e5 : Infinity;
// Cards never checked first, then the oldest.
const todo = list.filter(w => age(w) >= REFRESH_DAYS).sort((a, b) => age(b) - age(a));
console.log(`${todo.length} need checking today.`);

let done = 0, found = 0, notFound = 0;
try {
  for (const w of todo) {
    if (remaining != null && remaining < 3) { console.log("Daily credits used up."); break; }
    if (spent + 2 > DAILY_BUDGET) { console.log("Today's budget reached; the rest will be done tomorrow."); break; }
    let entry = cards[w.id] || {};
    if (!entry.tcgPlayerId) {
      if (entry.notFound && age(w) < 30) continue;   // don't keep paying to search for a card they don't have
      const r = await findCard(w);
      if (r.budget) { console.log("Today's budget reached while searching; the rest will be done tomorrow."); break; }
      if (r.missing) {
        console.log(`Not found: ${w.name} ${w.number} (${w.set})`);
        cards[w.id] = { ...entry, notFound: true, checked: new Date().toISOString() };
        notFound++;
        continue;
      }
      console.log(`Found ${w.name} ${w.number} → ${r.matched}`);
      entry = { tcgPlayerId: r.tcgPlayerId };
    }
    if (spent + 2 > DAILY_BUDGET) break;
    const body = await get("/cards", { tcgPlayerId: entry.tcgPlayerId, includeEbay: true });
    const card = listOf(body)[0];
    if (!card) { console.log(`No data for ${w.name} ${w.number}`); continue; }
    const grades = gradesFrom(card);
    cards[w.id] = { tcgPlayerId: entry.tcgPlayerId, name: w.name, number: w.number, set: w.set, ...grades, checked: new Date().toISOString() };
    console.log(`${w.name} ${w.number} (${w.set}): ${Object.entries(grades).map(([g, v]) => `${g.toUpperCase()} $${v.usd} (${v.sales} sold)`).join(", ") || "no graded sales yet"}`);
    done++; found += Object.keys(grades).length ? 1 : 0;
  }
} catch (e) {
  console.log(e.message);
  if (!e.stop) throw e;
}

// Keep only cards still on the watch list.
const keep = new Set(list.map(w => w.id));
for (const id of Object.keys(cards)) if (!keep.has(id)) delete cards[id];

await mkdir("data", { recursive: true });
await writeFile(OUT, JSON.stringify({
  updated: new Date().toISOString(),
  source: "eBay sold listings (median of recent sales) via PokemonPriceTracker",
  currency: "USD",
  minSales: MIN_SALES,
  cards,
}, null, 1));
console.log(`Checked ${done} cards (${found} with graded sales, ${notFound} not found). Used about ${spent} credits${remaining != null ? `, ${remaining} left today` : ""}.`);
