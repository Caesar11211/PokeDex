// cards-api.js — finds real cards and their Cardmarket prices in free online card databases.
//
// Main source:   TCGdex            https://tcgdex.dev        (free, no sign-up)
// Backup source: Pokémon TCG API   https://pokemontcg.io     (free, 1,000 lookups a day without a key)
//
// Both are turned into the same simple "card" shape, so the rest of the app doesn't care which one answered:
// { id, source, name, number, setId, setName, setTotal, rarity, image, imageLarge, dex, cardmarketUrl,
//   eur: { trend, trendHolo, avg30, low, updated }, usd }

const TCGDEX = "https://api.tcgdex.net/v2/en";
const PTCG = "https://api.pokemontcg.io/v2";

const num = v => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);

async function getJSON(url, { signal, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// Run async jobs a few at a time so we don't flood the API.
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// ---------- name matching ----------
// "Pikachu ex" and "Radiant Pikachu" count as Pikachu cards; "Mewtwo" doesn't count as Mew.
export function words(s) {
  return " " + String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, " f ").replace(/♂/g, " m ").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}
export const isCardOf = (cardName, species) => words(cardName).includes(words(species));
export const sameNumber = (a, b) => {
  const x = String(a ?? "").trim().toUpperCase(), y = String(b ?? "").trim().toUpperCase();
  if (!x || !y) return false;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return parseInt(x, 10) === parseInt(y, 10);
  return x.replace(/^0+/, "") === y.replace(/^0+/, "");
};

// ---------- TCGdex ----------
export function fromTcgdex(c) {
  const cm = c.pricing?.cardmarket, tp = c.pricing?.tcgplayer;
  const usd = tp && (tp.normal?.marketPrice ?? tp.holofoil?.marketPrice ?? tp.holo?.marketPrice
    ?? tp["reverse-holofoil"]?.marketPrice ?? tp.reverse?.marketPrice);
  return {
    id: c.id, source: "tcgdex", name: c.name, number: String(c.localId ?? ""),
    setId: c.set?.id ?? null, setName: c.set?.name ?? null, setTotal: c.set?.cardCount?.official ?? null,
    rarity: c.rarity ?? null,
    image: c.image ? c.image + "/low.webp" : null, imageLarge: c.image ? c.image + "/high.webp" : null,
    dex: Array.isArray(c.dexId) ? c.dexId : [],
    cardmarketUrl: null,
    eur: cm ? { trend: num(cm.trend) ?? num(cm.avg), trendHolo: num(cm["trend-holo"]) ?? num(cm["avg-holo"]),
                avg30: num(cm.avg30), low: num(cm.low), updated: cm.updated ?? null } : null,
    usd: num(usd),
  };
}
const briefFromTcgdex = b => ({
  id: b.id, source: "tcgdex", name: b.name, number: String(b.localId ?? ""), brief: true,
  setId: String(b.id).replace(/-[^-]+$/, ""), setName: null, setTotal: null,
  image: b.image ? b.image + "/low.webp" : null, imageLarge: b.image ? b.image + "/high.webp" : null,
});

async function tcgdexSearch({ species, number, total }, signal) {
  let url = `${TCGDEX}/cards?name=${encodeURIComponent(species)}`;
  if (number && /^\d+$/.test(number)) url += `&localId=${encodeURIComponent(String(parseInt(number, 10)))}`;
  else if (number) url += `&localId=${encodeURIComponent(number)}`;
  const list = await getJSON(url, { signal });
  if (!Array.isArray(list)) throw new Error("Unexpected reply");
  let briefs = list.filter(b => b && b.id && isCardOf(b.name, species));
  if (number) briefs = briefs.filter(b => sameNumber(b.localId, number));
  briefs.reverse();                                  // newest sets first
  // Small result sets: fetch full details so we can show set names and prices straight away.
  if (briefs.length <= 16) {
    let cards = await inBatches(briefs, 6, b => getJSON(`${TCGDEX}/cards/${encodeURIComponent(b.id)}`, { signal }).then(fromTcgdex).catch(() => briefFromTcgdex(b)));
    if (total) {
      const exact = cards.filter(c => c.setTotal === total);
      if (exact.length) cards = exact;
    }
    return cards;
  }
  return briefs.slice(0, 60).map(briefFromTcgdex);
}

// ---------- Pokémon TCG API ----------
export function fromPtcg(c) {
  const p = c.cardmarket?.prices, tp = c.tcgplayer?.prices;
  const usd = tp && (tp.normal?.market ?? tp.holofoil?.market ?? tp.reverseHolofoil?.market ?? tp["1stEditionHolofoil"]?.market);
  return {
    id: c.id, source: "ptcg", name: c.name, number: String(c.number ?? ""),
    setId: c.set?.id ?? null, setName: c.set?.name ?? null, setTotal: c.set?.printedTotal ?? null,
    rarity: c.rarity ?? null,
    image: c.images?.small ?? null, imageLarge: c.images?.large ?? null,
    dex: c.nationalPokedexNumbers ?? [],
    cardmarketUrl: c.cardmarket?.url ?? null,
    eur: p ? { trend: num(p.trendPrice) ?? num(p.averageSellPrice), trendHolo: num(p.reverseHoloTrend) ?? num(p.reverseHoloSell),
               avg30: num(p.avg30), low: num(p.lowPrice), updated: c.cardmarket?.updatedAt ?? null } : null,
    usd: num(usd),
  };
}
const FIELDS = "id,name,number,set,images,cardmarket,tcgplayer,nationalPokedexNumbers,rarity";

async function ptcgSearch({ species, number, total, dex }, signal) {
  const q = [];
  if (dex) q.push(`nationalPokedexNumbers:${dex}`);
  else q.push(/^[a-z0-9]+$/i.test(species) ? `name:*${species}*` : `name:"${species.replace(/"/g, "")}"`);
  if (number) q.push(`number:${/^\d+$/.test(number) ? parseInt(number, 10) : number}`);
  if (total) q.push(`set.printedTotal:${total}`);
  const url = `${PTCG}/cards?q=${encodeURIComponent(q.join(" "))}&pageSize=40&orderBy=-set.releaseDate&select=${FIELDS}`;
  const res = await getJSON(url, { signal });
  let cards = (res.data || []).map(fromPtcg).filter(c => isCardOf(c.name, species));
  if (!cards.length && total) return ptcgSearch({ species, number, dex }, signal);   // printed total misread: try without it
  return cards;
}

// ---------- public ----------
/**
 * Find cards of a Pokémon, optionally narrowed by the number printed on the card ("25" and total "165" for 025/165).
 * Returns { cards, source }. Throws only if both databases are unreachable.
 */
export async function findCards({ species, dex, number, total }, signal) {
  number = number ? String(number).trim() : "";
  let firstError;
  try {
    const cards = await tcgdexSearch({ species, number, total }, signal);
    if (cards.length) return { cards, source: "tcgdex" };
  } catch (e) { if (signal?.aborted) throw e; firstError = e; }
  try {
    const cards = await ptcgSearch({ species, number, total, dex }, signal);
    return { cards, source: "ptcg" };
  } catch (e) { if (signal?.aborted) throw e; if (firstError) throw firstError; throw e; }
}

/** Full details and the latest price for one card. */
export async function getCard(id, source, signal) {
  if (source === "ptcg") {
    const res = await getJSON(`${PTCG}/cards/${encodeURIComponent(id)}?select=${FIELDS}`, { signal });
    return fromPtcg(res.data);
  }
  return fromTcgdex(await getJSON(`${TCGDEX}/cards/${encodeURIComponent(id)}`, { signal }));
}

/** The Cardmarket price in euros for the finish you have. */
export function eurPrice(card, finish) {
  const e = card?.eur;
  if (!e) return null;
  if (finish === "reverse") return e.trendHolo ?? e.trend ?? e.avg30 ?? null;
  return e.trend ?? e.avg30 ?? e.trendHolo ?? null;
}

// ---------- euro → pound ----------
const FX_KEY = "fx-eur-gbp";
export const FALLBACK_RATE = 0.85;
export async function eurToGbp() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(FX_KEY) || "null"); } catch {}
  if (cached && Date.now() - cached.at < 12 * 3600e3) return cached;
  for (const url of ["https://api.frankfurter.dev/v1/latest?base=EUR&symbols=GBP", "https://api.frankfurter.app/latest?from=EUR&to=GBP"]) {
    try {
      const r = await getJSON(url, { timeout: 8000 });
      const rate = r?.rates?.GBP;
      if (rate > 0.5 && rate < 1.5) {
        const v = { rate, at: Date.now(), live: true };
        try { localStorage.setItem(FX_KEY, JSON.stringify(v)); } catch {}
        return v;
      }
    } catch {}
  }
  return cached || { rate: FALLBACK_RATE, at: 0, live: false };
}
