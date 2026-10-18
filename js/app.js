// app.js — the Living Dex app: binder, scanning, card lookup with live prices, wishlist, spares and backups.
//
// How a scan works:
//   1. You take a photo                  → startScan()
//   2. detect.js finds and crops the card → cropCard()
//   3. ocr.js reads the name and number   → readCard()
//   4. cards-api.js finds matching cards  → findCards()   (with Cardmarket prices)
//   5. You confirm, and it's saved        → commit()      (to this phone, via store.js)

import { NAMES, LEGEND, TYPES, typesOf, GEN_END, REGIONS, genOf } from "./data.js";
import { store, askToKeepData } from "./store.js";
import { findCards, getCard, eurPrice, eurToGbp, FALLBACK_RATE } from "./cards-api.js";
import { readCard } from "./ocr.js";
import { detectCard, cropCard } from "./detect.js";

// ---------- basics ----------
const TOTAL = NAMES.length;
const STALE_DAYS = 7;                     // prices older than this get flagged for an update
const DAY = 864e5;
const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const COND_SHORT = { "Mint": "MT", "Near Mint": "NM", "Excellent": "EX", "Good": "GD", "Light Played": "LP", "Played": "PL", "Poor": "PO" };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(3, "0");
const nameOf = n => NAMES[n - 1];
const money = v => "£" + (+v || 0).toFixed(2);
const euro = v => "€" + (+v || 0).toFixed(2);
const pagePos = n => `page ${Math.ceil(n / 9)}, slot ${(n - 1) % 9 + 1}`;
const shortDate = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const ageDays = d => d ? (Date.now() - Date.parse(d)) / DAY : Infinity;

// ---------- state ----------
let owned = new Map();        // dex -> entry
let wish = new Map();         // dex -> { dex, target, addedAt }
let photoUrls = new Map();    // dex -> object URL of your photo
let view = "all", gen = 0, query = "", typeFilter = 0;
let fx = { rate: FALLBACK_RATE, live: false, at: 0 };
let updating = null;          // progress of "Update all prices"

const prefs = (() => {
  const d = { rapid: false, binder: "card" };
  try { return { ...d, ...JSON.parse(localStorage.getItem("prefs") || "{}") }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem("prefs", JSON.stringify(prefs)); } catch {} };

// ---------- name matching (for typed names) ----------
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/♀/g, "f").replace(/♂/g, "m").replace(/[^a-z0-9]/g, "");
const NORM_INDEX = new Map(NAMES.map((n, i) => [norm(n), i + 1]));
function resolveDex(text) {
  if (!text) return 0;
  const m = String(text).match(/^\s*#?\s*0*(\d{1,4})\b/);
  if (m) { const n = +m[1]; if (n >= 1 && n <= TOTAL) return n; }
  let t = String(text).replace(/^#?\d+\s*/, "");
  t = t.replace(/\b(mega|alolan|galarian|hisuian|paldean|dark|radiant|shining)\b/gi, " ").replace(/\b(ex|gx|v|vmax|vstar|break|lv\.?\s*x|prime|star)\b/gi, " ");
  const k = norm(t);
  if (NORM_INDEX.has(k)) return NORM_INDEX.get(k);
  let best = 0, len = 0;
  for (const [nk, i] of NORM_INDEX) if (nk.length > 3 && k.includes(nk) && nk.length > len) { best = i; len = nk.length; }
  return best;
}

// ---------- saving ----------
async function saveEntry(e) { owned.set(e.dex, e); await store.put("entries", e.dex, e); }
async function removeEntry(n) {
  owned.delete(n); await store.remove("entries", n);
  await store.remove("photos", n);
  if (photoUrls.has(n)) { URL.revokeObjectURL(photoUrls.get(n)); photoUrls.delete(n); }
}
async function saveWish(n, item) {
  if (item) { wish.set(n, item); await store.put("wish", n, item); }
  else { wish.delete(n); await store.remove("wish", n); }
}
async function savePhoto(n, blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const w = 300, h = Math.round(bmp.height * w / bmp.width);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const thumb = await new Promise(r => c.toBlob(r, "image/jpeg", .82));
    if (!thumb) return false;
    await store.put("photos", n, thumb);
    if (photoUrls.has(n)) URL.revokeObjectURL(photoUrls.get(n));
    photoUrls.set(n, URL.createObjectURL(thumb));
    return true;
  } catch { return false; }
}

// ---------- prices ----------
const gbp = eur => eur == null ? null : Math.round(eur * fx.rate * 100) / 100;
/** Copy a looked-up card (and its latest price) onto an entry. */
function applyCard(entry, card) {
  return {
    ...entry,
    cardId: card.id, source: card.source, cardName: card.name, set: card.setName || entry.set || "",
    number: card.number, setTotal: card.setTotal ?? null, rarity: card.rarity ?? null,
    image: card.image || entry.image || null, imageLarge: card.imageLarge || entry.imageLarge || null,
    cardmarketUrl: card.cardmarketUrl || null,
    eur: card.eur || null, usd: card.usd ?? null,
    value: gbp(eurPrice(card, entry.finish)), checkedAt: new Date().toISOString(), rate: fx.rate,
  };
}
const entryAsCard = e => ({ id: e.cardId, source: e.source, name: e.cardName || nameOf(e.dex), number: e.number, setName: e.set, setTotal: e.setTotal,
  rarity: e.rarity, image: e.image, imageLarge: e.imageLarge, cardmarketUrl: e.cardmarketUrl, eur: e.eur, usd: e.usd });
const cardmarketLink = (card, species) => card?.cardmarketUrl ||
  "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=" + encodeURIComponent([card?.name || species, card?.number ? String(card.number).replace(/^0+(?=\d)/, "") : ""].filter(Boolean).join(" "));

async function updateAllPrices() {
  if (updating) return;
  const list = [...owned.values()].filter(e => e.cardId);
  if (!list.length) { toast("Link some cards first: scan them or pick the card in each entry."); return; }
  const ctl = new AbortController();
  updating = { ctl, done: 0, failed: 0, total: list.length };
  render();
  fx = await eurToGbp();
  for (let i = 0; i < list.length && !ctl.signal.aborted; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(async e => {
      try {
        const card = await getCard(e.cardId, e.source, ctl.signal);
        const cur = owned.get(e.dex);
        if (cur && cur.cardId === e.cardId) await saveEntry(applyCard(cur, card));
      } catch { if (!ctl.signal.aborted) updating.failed++; }
      updating.done++;
    }));
    renderViewBar();
  }
  const { done, failed } = updating;
  updating = null;
  try { localStorage.setItem("lastPriceRun", new Date().toISOString()); } catch {}
  render();
  if (ctl.signal.aborted) toast(`Stopped after ${done - failed} prices`);
  else toast(failed ? `Updated ${done - failed} prices. ${failed} couldn't be reached.` : `All ${done} prices updated`);
}

// ---------- rendering ----------
function stats() {
  const got = owned.size, pct = got / TOTAL * 100;
  $("#pct").textContent = (pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)) + "%";
  $("#ringFill").setAttribute("stroke-dashoffset", String(100 - pct));
  $("#sGot").textContent = got.toLocaleString("en-GB");
  $("#sLeft").textContent = (TOTAL - got).toLocaleString("en-GB");
  let spent = 0, value = 0, leg = 0, stale = 0;
  for (const [n, e] of owned) {
    spent += +e.paid || 0; value += +e.value || 0;
    if (LEGEND.has(n)) leg++;
    if (e.cardId && ageDays(e.checkedAt) > STALE_DAYS) stale++;
  }
  $("#sSpent").textContent = money(spent);
  $("#sValue").textContent = money(value);
  $("#sLeg").textContent = leg + "/" + LEGEND.size;
  let wished = 0; for (const n of wish.keys()) if (!owned.has(n)) wished++;
  $("#cWish").textContent = wished || "";
  $("#cRe").textContent = stale || "";
  const counts = Array(10).fill(0);
  for (const n of owned.keys()) counts[genOf(n)]++;
  $("#regions").innerHTML = REGIONS.map((r, i) => {
    const g = i + 1, size = GEN_END[i] - (i ? GEN_END[i - 1] : 0);
    return `<button type="button" class="reg" data-gen="${g}" aria-pressed="${gen === g}">
      <span class="rn">${r}</span><span class="rc">${counts[g]}/${size}</span><span class="bar"><i style="width:${counts[g] / size * 100}%"></i></span></button>`;
  }).join("");
  // Gentle nudge when prices are getting old
  const note = $("#notice");
  if (stale && !updating && view !== "prices") {
    note.hidden = false;
    note.innerHTML = `<span>${stale} price${stale > 1 ? "s are" : " is"} over a week old.</span><button type="button" class="btn small" id="noticeUpdate">Update prices</button>`;
    $("#noticeUpdate").onclick = updateAllPrices;
  } else note.hidden = true;
}

function slotHTML(n) {
  const e = owned.get(n), w = !e && wish.get(n);
  const photo = photoUrls.get(n);
  const src = e ? (prefs.binder === "photo" ? (photo || e.image) : (e.image || photo)) : null;
  const cls = ["slot", e ? "got" : "", w ? "wish" : "", src ? "hasimg" : "", LEGEND.has(n) && !src ? "legend" : ""].join(" ");
  let badges = "";
  if (e && e.spares) badges += `<span class="badge spare">+${e.spares}</span>`;
  if (view === "prices" && e) badges += `<span class="badge val">${e.value != null ? money(e.value) : "£ –"}</span>`;
  else if (w && w.target != null) badges += `<span class="badge val">≤${money(w.target)}</span>`;
  const label = `#${pad(n)} ${nameOf(n)}${e ? ", collected" : w ? ", on wishlist" : ", missing"}`;
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove();this.parentNode.classList.remove('hasimg')">` : "";
  return `<button type="button" class="${cls}" data-dex="${n}" aria-label="${esc(label)}">${img}<span class="sn">#${pad(n)}${w ? " ★" : ""}</span><span class="nm">${esc(nameOf(n))}</span>${badges}</button>`;
}
function matches(n) {
  if (gen && genOf(n) !== gen) return false;
  if (typeFilter && !typesOf(n).includes(typeFilter)) return false;
  if (view === "have" && !owned.has(n)) return false;
  if (view === "missing" && owned.has(n)) return false;
  if (view === "wish" && (owned.has(n) || !wish.has(n))) return false;
  if (view === "prices" && !owned.has(n)) return false;
  if (query) {
    const q = query.trim().toLowerCase();
    if (/^\d+$/.test(q)) return String(n).startsWith(String(+q)) || pad(n).startsWith(q);
    return nameOf(n).toLowerCase().includes(q);
  }
  return true;
}
function renderViewBar() {
  const bar = $("#viewBar");
  if (view === "wish") {
    bar.hidden = false;
    bar.innerHTML = `<p class="hint">Tap a missing slot in the binder to star it and set the most you'd pay.</p>`;
  } else if (view === "prices") {
    bar.hidden = false;
    let last = null; try { last = localStorage.getItem("lastPriceRun"); } catch {}
    if (updating) {
      bar.innerHTML = `<span class="hint">Updating prices… ${updating.done}/${updating.total}</span><span class="spacer"></span><button type="button" class="btn small" id="stopUpd">Stop</button>
        <div class="progress"><i style="width:${updating.done / updating.total * 100}%"></i></div>`;
      $("#stopUpd").onclick = () => updating?.ctl.abort();
    } else {
      bar.innerHTML = `<span class="hint">Most valuable first. Cardmarket trend prices in pounds at €1 = £${fx.rate.toFixed(3)}${last ? `. Last full update ${shortDate(last)}` : ""}.</span>
        <span class="spacer"></span><button type="button" class="btn small primary" id="updAll">Update all prices</button>`;
      $("#updAll").onclick = updateAllPrices;
    }
  } else bar.hidden = true;
}
function render() {
  stats();
  renderViewBar();
  const list = $("#list");
  const nums = [];
  for (let n = 1; n <= TOTAL; n++) if (matches(n)) nums.push(n);
  if (view === "prices") nums.sort((a, b) => (+owned.get(b).value || 0) - (+owned.get(a).value || 0));
  if (!nums.length) {
    const msg = {
      have: owned.size ? "No collected Pokémon match that." : "Nothing collected yet. Tap <b>Scan a card</b> to add your first one.",
      wish: "Your wishlist is empty. Tap any missing slot in the binder to add it.",
      prices: "Once you've collected some cards, they show here with their prices.",
    }[view] || "No Pokémon match that.";
    list.innerHTML = `<p class="empty">${msg}</p>`;
    return;
  }
  if (view === "all" && !query && !typeFilter) {
    const pages = new Map();
    for (const n of nums) { const p = Math.ceil(n / 9); if (!pages.has(p)) pages.set(p, []); pages.get(p).push(n); }
    let html = '<div class="pages">';
    for (const [p, arr] of pages) {
      const first = (p - 1) * 9 + 1, last = Math.min(p * 9, TOTAL);
      const have = arr.filter(n => owned.has(n)).length;
      let cells = "";
      for (let n = first; n <= last; n++) cells += slotHTML(n);
      html += `<section class="page"><h2><span>Page ${p}</span><span class="num">#${pad(first)}–${pad(last)} · ${have}/${last - first + 1}</span></h2><div class="grid9">${cells}</div></section>`;
    }
    list.innerHTML = html + "</div>";
  } else list.innerHTML = `<div class="flat">${nums.map(slotHTML).join("")}</div>`;
}

// ---------- sheets ----------
let sheetCtl = null;
function closeSheet() { $("#sheetRoot").innerHTML = ""; sheetCtl?.abort(); sheetCtl = null; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); }
function sheetShell(title, body) {
  sheetCtl?.abort(); sheetCtl = new AbortController();
  $("#sheetRoot").innerHTML = `<div class="backdrop" id="bd"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT">
    <div class="sheet-top"><h3 id="shT">${esc(title)}</h3><button type="button" class="x" id="shX" aria-label="Close">×</button></div>${body}</div></div>`;
  $("#shX").onclick = closeSheet;
  $("#bd").addEventListener("click", ev => { if (ev.target.id === "bd") closeSheet(); });
  return sheetCtl.signal;
}

/**
 * The card sheet, used for a new scan (photo), adding by hand, and editing a collected card.
 * ctx: { mode: "scan" | "add" | "edit", dex, photo }
 */
function openCardSheet(ctx) {
  const { mode, photo } = ctx;
  let dex = ctx.dex || 0;
  const existing = mode === "edit" ? owned.get(dex) : null;
  const d = existing || {};
  const showWish = mode === "add" && dex && !owned.has(dex);
  const w = wish.get(dex);
  const photoUrl = photo ? URL.createObjectURL(photo) : (existing && photoUrls.get(dex)) || null;
  const title = mode === "edit" ? `#${pad(dex)} ${nameOf(dex)}` : mode === "scan" ? "New card" : dex ? `#${pad(dex)} ${nameOf(dex)}` : "Add a card";
  const signal = sheetShell(title, `
    ${photoUrl ? `<div class="photo"><img src="${esc(photoUrl)}" alt="Your card photo"><p class="status" id="status" aria-live="polite"></p></div>` : `<p class="status" id="status" aria-live="polite" hidden></p>`}
    ${showWish ? `<div class="wishrow"><button type="button" class="wishbtn" id="wishBtn" aria-pressed="${!!w}">${w ? "★ On wishlist" : "☆ Add to wishlist"}</button>
      <label>Most I'd pay £<input id="wTarget" type="number" inputmode="decimal" step="0.01" min="0" placeholder="1.00" value="${w?.target ?? ""}"></label></div>` : ""}
    <div class="card-find">
      <div class="searchrow">
        <label>Pokémon<input id="fPoke" list="dexList" placeholder="Name or Dex number" autocomplete="off" value="${dex ? "#" + pad(dex) + " " + esc(nameOf(dex)) : ""}"></label>
        <label>Card no.<input id="fNum" placeholder="e.g. 025" autocomplete="off" value="${esc(d.number || "")}"></label>
        <button type="button" class="btn" id="findBtn">Find</button>
      </div>
      <p class="match" id="matchLine"></p>
    </div>
    <div id="results"></div>
    <form id="cardForm" autocomplete="off">
      <label>Paid (£)<input id="fPaid" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.15" value="${d.paid ?? ""}"></label>
      <label>Condition<select id="fCond"><option value="">Not set</option>${CONDITIONS.map(c => `<option${d.condition === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>Spares<input id="fSpares" type="number" inputmode="numeric" min="0" step="1" value="${d.spares ?? 0}"></label>
      <label class="full">Notes<textarea id="fNotes" placeholder="Variant, where you got it">${esc(d.notes || "")}</textarea></label>
    </form>
    <div id="dupeBox"></div>
    <div class="actions" id="actions">
      ${mode === "edit" ? `<button type="button" class="btn danger" id="rmBtn">Remove</button>` : ""}
      <button type="button" class="btn" id="plainBtn">${mode === "edit" ? "Unlink card" : "Save without card"}</button>
      <button type="button" class="btn primary" id="saveBtn">${mode === "edit" ? "Save" : "Add to Dex"}</button>
    </div>`);
  if (mode === "edit" && !existing?.cardId) $("#plainBtn").hidden = true;

  // Sheet state
  let sel = existing?.cardId ? entryAsCard(existing) : null;   // the chosen card
  let selFresh = false;                                          // true once its price was looked up in this sheet
  let finish = existing?.finish || "standard";
  let cards = [];                                                // last search results
  let ocrNumber = "", ocrTotal = null, ocrDex = 0;
  const st = $("#status"), results = $("#results");
  const setStatus = (text, cls = "") => { st.hidden = !text; st.className = "status " + cls; st.textContent = text || ""; };

  const updateMatch = () => {
    const n = resolveDex($("#fPoke").value), line = $("#matchLine");
    if (!$("#fPoke").value.trim()) line.textContent = "";
    else if (n) line.innerHTML = `Goes in <b>#${pad(n)} ${esc(nameOf(n))}</b> · ${pagePos(n)}${owned.has(n) && n !== (existing?.dex) ? " · <b>already collected</b>" : ""}`;
    else line.textContent = "No matching Pokémon. Try the name or Dex number.";
  };
  $("#fPoke").addEventListener("input", updateMatch);
  updateMatch();

  function renderChosen() {
    if (!sel) { results.innerHTML = ""; $("#plainBtn").hidden = mode === "edit" && !existing?.cardId; return; }
    const eur = eurPrice(sel, finish), p = gbp(eur);
    const updated = sel.eur?.updated ? ` · ${shortDate(sel.eur.updated)}` : "";
    const meta = [sel.setName, sel.number ? (sel.setTotal ? `${sel.number}/${sel.setTotal}` : `#${sel.number}`) : "", sel.rarity].filter(Boolean).join(" · ");
    results.innerHTML = `<div class="chosen">
      ${sel.imageLarge || sel.image ? `<img src="${esc(sel.imageLarge || sel.image)}" alt="${esc(sel.name)}">` : "<div></div>"}
      <div>
        <div class="cn">${esc(sel.name)}</div>
        <div class="meta">${esc(meta || "Set unknown")}</div>
        <div class="price">${p != null ? money(p) : "No price yet"}<small>${eur != null ? `Cardmarket trend ${euro(eur)}${updated}` : "Cardmarket has no sales data for this one"}</small></div>
        <div class="finish" role="group" aria-label="Finish">
          <button type="button" data-f="standard" aria-pressed="${finish === "standard"}">Standard</button>
          <button type="button" data-f="reverse" aria-pressed="${finish === "reverse"}">Reverse holo</button>
        </div>
        <p class="match" style="margin-top:8px"><a class="pricelink" href="${esc(cardmarketLink(sel, nameOf(dex)))}" target="_blank" rel="noopener">View on Cardmarket ↗</a>
        ${mode === "edit" && sel.id ? ` · <button type="button" class="textbtn" id="refreshBtn" style="padding:0">Refresh price</button>` : ""}</p>
      </div></div>
      ${cards.length > 1 ? `<button type="button" class="textbtn" id="showAll">Not this one? Show all ${cards.length} matches</button>` : ""}`;
    results.querySelectorAll(".finish button").forEach(b => b.onclick = () => { finish = b.dataset.f; renderChosen(); });
    $("#showAll", results)?.addEventListener("click", () => renderPicker());
    $("#refreshBtn", results)?.addEventListener("click", async () => {
      $("#refreshBtn").textContent = "Refreshing…";
      try { fx = await eurToGbp(); sel = await getCard(sel.id, sel.source, signal); selFresh = true; renderChosen(); toast("Price refreshed"); }
      catch { if (!signal.aborted) { $("#refreshBtn").textContent = "Refresh price"; toast("Couldn't reach the card database."); } }
    });
  }
  function renderPicker() {
    results.innerHTML = `<p class="hint">${cards.length} matching cards. Tap the one you have.</p>
      <div class="picker">${cards.map((c, i) => `<button type="button" class="pick" data-i="${i}" aria-pressed="${sel?.id === c.id}">
        ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ""}<b>${esc(c.number ? "#" + c.number : c.name)}</b><span>${esc(c.setName || c.setId || "")}</span>
        ${c.eur ? `<span>${money(gbp(eurPrice(c, "standard")))}</span>` : ""}</button>`).join("")}</div>`;
    results.querySelectorAll(".pick").forEach(b => b.onclick = () => choose(cards[+b.dataset.i]));
  }
  async function choose(card) {
    if (card.brief) {
      results.innerHTML = `<p class="status dots">Getting the price</p>`;
      try { card = await getCard(card.id, card.source, signal); }
      catch { if (signal.aborted) return; toast("Couldn't load that card. Try again."); renderPicker(); return; }
    }
    sel = card; selFresh = true; renderChosen();
  }

  // Look the card up. auto = straight after a scan (may pick a single clear match by itself).
  async function search(auto = false) {
    const n = resolveDex($("#fPoke").value);
    if (!n) { $("#matchLine").textContent = "Type the Pokémon's name or Dex number first."; $("#fPoke").focus(); return false; }
    dex = n;
    const number = $("#fNum").value.trim();
    const total = number && number === ocrNumber ? ocrTotal : null;
    results.innerHTML = `<p class="status dots">Looking up ${esc(nameOf(n))} cards</p>`;
    try {
      const [res, rate] = await Promise.all([findCards({ species: nameOf(n), dex: n, number, total }, signal), eurToGbp()]);
      fx = rate;
      cards = res.cards;
    } catch (e) {
      if (signal.aborted) return false;
      results.innerHTML = `<p class="status warn">Couldn't reach the card databases. Check your connection and tap Find again, or save without card details.</p>`;
      return false;
    }
    if (signal.aborted) return false;
    if (!cards.length) {
      sel = null;
      results.innerHTML = `<p class="status warn">No ${esc(nameOf(n))} card ${number ? `numbered ${esc(number)} ` : ""}found. ${number ? "Check the number, or clear it to see every card." : ""}</p>`;
      return false;
    }
    if (cards.length === 1 || (auto && number && total && cards.filter(c => c.setTotal === total).length === 1)) {
      await choose(cards.length === 1 ? cards[0] : cards.find(c => c.setTotal === total));
      return true;
    }
    sel = null; renderPicker();
    return false;
  }
  $("#findBtn").onclick = () => search(false);
  $("#fNum").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(false); } });

  // Wishlist (missing slots only)
  if (showWish) {
    const btn = $("#wishBtn"), tgt = $("#wTarget");
    const cur = () => tgt.value === "" ? null : Math.max(0, +tgt.value);
    btn.onclick = async () => {
      const on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "★ On wishlist" : "☆ Add to wishlist";
      await saveWish(dex, on ? { dex, target: cur(), addedAt: new Date().toISOString() } : null);
      render(); toast(on ? `#${pad(dex)} added to wishlist` : "Removed from wishlist");
    };
    tgt.addEventListener("change", async () => {
      if (btn.getAttribute("aria-pressed") !== "true") { if (tgt.value === "") return; btn.setAttribute("aria-pressed", "true"); btn.textContent = "★ On wishlist"; }
      await saveWish(dex, { dex, target: cur(), addedAt: wish.get(dex)?.addedAt || new Date().toISOString() });
      render();
    });
  }

  // Remove (edit only), with an in-page confirm
  $("#rmBtn")?.addEventListener("click", () => {
    $("#actions").innerHTML = `<span class="status" style="margin-right:auto">Remove #${pad(dex)} from your Dex?</span><button type="button" class="btn" id="keepBtn">Keep</button><button type="button" class="btn danger" id="yesRm">Remove</button>`;
    $("#keepBtn").onclick = closeSheet;
    $("#yesRm").onclick = async () => { await removeEntry(existing.dex); closeSheet(); render(); toast(`Removed #${pad(existing.dex)}`); };
  });

  // Saving
  const readForm = () => ({
    paid: $("#fPaid").value === "" ? null : Math.max(0, +$("#fPaid").value),
    condition: $("#fCond").value || null,
    spares: Math.max(0, parseInt($("#fSpares").value || "0", 10) || 0),
    notes: $("#fNotes").value.trim(),
  });
  async function commit({ withCard, force = false }) {
    const n = resolveDex($("#fPoke").value);
    if (!n) { $("#matchLine").textContent = "Pick a Pokémon first: type its name or Dex number."; $("#fPoke").focus(); return; }
    if (withCard && !sel) { toast("Tap the card you have first, or save without card details."); return; }
    const prev = owned.get(n);
    const sameSlot = mode === "edit" && n === existing.dex;
    if (prev && !sameSlot && !force) {
      $("#dupeBox").innerHTML = `<div class="dupe"><span>You already have <b>#${pad(n)} ${esc(nameOf(n))}</b>${prev.set ? " from " + esc(prev.set) : ""}.</span>
        <div class="actions"><button type="button" class="btn" id="asSpare">Count as a spare</button><button type="button" class="btn primary" id="replace">Replace with this card</button></div></div>`;
      $("#asSpare").onclick = async () => { await saveEntry({ ...prev, spares: (prev.spares || 0) + 1 }); done(n, prev, true); };
      $("#replace").onclick = () => commit({ withCard, force: true });
      return;
    }
    let entry = {
      ...(sameSlot ? existing : {}),
      dex: n, name: nameOf(n), finish, ...readForm(),
      addedAt: (sameSlot && existing.addedAt) || new Date().toISOString(),
    };
    if (prev && force) entry.spares = Math.max(entry.spares, prev.spares || 0);
    if (withCard && sameSlot && !selFresh && sel.id === existing.cardId) {
      // Same card, no new lookup: keep the price date, just re-price if the finish changed
      const eur = eurPrice(sel, finish);
      entry.value = eur != null ? Math.round(eur * (existing.rate || fx.rate) * 100) / 100 : existing.value ?? null;
    } else if (withCard) entry = applyCard(entry, sel);
    else {
      Object.assign(entry, { cardId: null, source: null, cardName: null, eur: null, usd: null, value: null, checkedAt: null, image: null, imageLarge: null, cardmarketUrl: null,
        number: $("#fNum").value.trim() || entry.number || "", set: entry.set || "" });
    }
    $("#saveBtn").disabled = true;
    try {
      if (mode === "edit" && n !== existing.dex) await removeEntry(existing.dex);
      if (photo) entry.hasPhoto = await savePhoto(n, photo);
      await saveEntry(entry);
      if (wish.has(n)) await saveWish(n, null);
      done(n, prev || null, false);
    } catch {
      $("#saveBtn").disabled = false;
      toast("Couldn't save. Your phone may be out of storage.");
    }
  }
  function done(n, prev, spare) {
    render();
    if (prefs.rapid && mode === "scan") return showAdded({ n, prev, spare, photoUrl });
    closeSheet();
    toast(mode === "edit" ? "Saved" : spare ? `Spare #${pad(n)} counted` : `#${pad(n)} ${nameOf(n)} added · ${pagePos(n)}`);
  }
  $("#saveBtn").onclick = () => commit({ withCard: !!sel });
  $("#plainBtn").onclick = () => commit({ withCard: false });

  if (sel) renderChosen();

  // A fresh scan: read the card, look it up, and (in Rapid scan) add a clear match by itself.
  if (mode === "scan") (async () => {
    $("#saveBtn").disabled = true;
    setStatus("Reading the card", "dots");
    try {
      const r = await readCard(photo, NAMES, msg => setStatus(msg, "dots"));
      if (signal.aborted) return;
      ocrNumber = r.number; ocrTotal = r.total; ocrDex = r.dex;
      if (r.dex) { $("#fPoke").value = `#${pad(r.dex)} ${nameOf(r.dex)}`; updateMatch(); }
      if (r.number) $("#fNum").value = r.number;
      if (!r.dex) {
        setStatus(r.number ? `Read the number (${r.number}) but not the name. Type the Pokémon and tap Find.` : "Couldn't read the card. Type the Pokémon and tap Find.", "warn");
        $("#saveBtn").disabled = false; $("#fPoke").focus();
        return;
      }
      setStatus(`Read: ${nameOf(r.dex)}${r.number ? ` · ${r.number}${r.total ? "/" + r.total : ""}` : ""}`, "ok");
      const unique = await search(true);
      $("#saveBtn").disabled = false;
      if (signal.aborted) return;
      if (unique && prefs.rapid && ocrDex) {
        if (owned.has(ocrDex)) { const prev = owned.get(ocrDex); await saveEntry({ ...prev, spares: (prev.spares || 0) + 1 }); done(ocrDex, prev, true); }
        else await commit({ withCard: true });
      } else if (!unique && cards.length > 1) setStatus("Several cards match. Tap the one you have.", "ok");
    } catch (e) {
      if (signal.aborted) return;
      $("#saveBtn").disabled = false;
      setStatus((e && e.message && /reader/i.test(e.message)) ? e.message + " Type the Pokémon below." : "Couldn't read the card. Type the Pokémon and tap Find.", "warn");
    }
  })();
  else if (mode === "add" && dex) search(false);
}

function showAdded({ n, prev, spare, photoUrl }) {
  const e = owned.get(n);
  const img = e?.image || photoUrl;
  sheetShell(spare ? "Spare counted" : "Added", `
    <div class="added">${img ? `<img src="${esc(img)}" alt="">` : ""}<div>
      <b>#${pad(n)} ${esc(nameOf(n))}</b>
      <span class="hint">${spare ? `You now have ${e?.spares || 1} spare${(e?.spares || 1) > 1 ? "s" : ""} of this one.` : `${e?.value != null ? money(e.value) + " · " : ""}Goes in ${pagePos(n)}.`}</span>
    </div></div>
    <div class="actions">
      <button type="button" class="btn" id="undoBtn">Undo</button>
      <button type="button" class="btn" id="editBtn">Edit</button>
      <button type="button" class="btn" id="doneBtn">Done</button>
      <button type="button" class="btn go" id="nextBtn">Scan next</button>
    </div>`);
  $("#undoBtn").onclick = async () => {
    closeSheet();
    if (prev) await saveEntry(prev); else await removeEntry(n);
    render(); toast("Undone");
  };
  $("#editBtn").onclick = () => openCardSheet({ mode: "edit", dex: n });
  $("#doneBtn").onclick = closeSheet;
  $("#nextBtn").onclick = () => { closeSheet(); openCamera(); };
  $("#nextBtn").focus();
}

// ---------- scanning ----------
function openCamera() { $("#cam").value = ""; $("#cam").click(); }
async function startScan(photo) {
  let bmp = null;
  try { bmp = await createImageBitmap(photo); } catch {}
  const found = bmp ? detectCard(bmp) : null;
  const cropped = await cropCard(photo, bmp, found, $("#sheetRoot"), { skipIfFound: prefs.rapid });
  $("#sheetRoot").innerHTML = "";
  if (!cropped) return;
  openCardSheet({ mode: "scan", photo: cropped });
}

// ---------- spares list ----------
function openSpares() {
  const lines = []; let total = 0;
  for (let n = 1; n <= TOTAL; n++) {
    const e = owned.get(n); if (!e || !e.spares) continue;
    total += e.spares;
    const card = [e.set, e.number ? (e.setTotal ? `${e.number}/${e.setTotal}` : e.number) : ""].filter(Boolean).join(" ");
    lines.push(`#${pad(n)} ${nameOf(n)}${card ? " – " + card : ""}${e.condition ? ` (${COND_SHORT[e.condition]})` : ""} ×${e.spares}`);
  }
  if (!total) {
    sheetShell("Spares list", `<p class="hint">No spares yet. When you scan a card you already have, choose <b>Count as a spare</b> (Rapid scan does this by itself) and it shows up here.</p>
      <div class="actions"><button type="button" class="btn primary" id="okBtn">OK</button></div>`);
    $("#okBtn").onclick = closeSheet; return;
  }
  const text = `Pokémon cards for trade (${total}):\n` + lines.join("\n");
  sheetShell(`Spares list · ${total}`, `<p class="hint">Copy this into a trade group or post.</p>
    <textarea class="sparelist" id="spareTxt" readonly aria-label="Spares list">${esc(text)}</textarea>
    <div class="actions"><button type="button" class="btn" id="closeBtn">Close</button><button type="button" class="btn primary" id="copyBtn">Copy list</button></div>`);
  $("#closeBtn").onclick = closeSheet;
  $("#copyBtn").onclick = () => navigator.clipboard.writeText(text).then(() => toast("Spares list copied"), () => { const ta = $("#spareTxt"); ta.focus(); ta.select(); toast("Selected. Copy it from the menu."); });
}

// ---------- backup, export and import ----------
function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const today = () => new Date().toISOString().slice(0, 10);
function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportCSV() {
  const rows = [["Dex #", "Pokémon", "Gen", "Region", "Types", "Got it?", "Card", "Set", "Card number", "Finish", "Condition", "Paid (£)", "Raw value (£)", "Price checked", "Spares", "On wishlist", "Wishlist max (£)", "Notes"]];
  for (let n = 1; n <= TOTAL; n++) {
    const e = owned.get(n), w = wish.get(n), g = genOf(n);
    rows.push([n, nameOf(n), g, REGIONS[g - 1], typesOf(n).map(t => TYPES[t - 1]).join("/"), e ? "Yes" : "",
      e?.cardName || "", e?.set || "", e?.number ? (e.setTotal ? `${e.number}/${e.setTotal}` : e.number) : "", e ? (e.finish === "reverse" ? "Reverse holo" : "Standard") : "",
      e?.condition || "", e?.paid != null ? (+e.paid).toFixed(2) : "", e?.value != null ? (+e.value).toFixed(2) : "", e?.checkedAt ? e.checkedAt.slice(0, 10) : "",
      e?.spares || "", !e && w ? "Yes" : "", !e && w?.target != null ? (+w.target).toFixed(2) : "", e?.notes || ""]);
  }
  download(`living-dex-${today()}.csv`, "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv");
}
function exportBackup() {
  const data = { app: "living-dex", version: 1, exportedAt: new Date().toISOString(), entries: [...owned.values()], wish: [...wish.values()] };
  download(`living-dex-backup-${today()}.json`, JSON.stringify(data), "application/json");
  try { localStorage.setItem("lastBackup", new Date().toISOString()); } catch {}
}
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}
async function importFile(file, replace) {
  const text = await file.text();
  let added = 0, wished = 0;
  if (/\.json$/i.test(file.name) || text.trim().startsWith("{")) {
    const data = JSON.parse(text);
    if (data.app !== "living-dex" || !Array.isArray(data.entries)) throw new Error("That isn't a Living Dex backup.");
    if (replace) { await store.clear("entries"); await store.clear("wish"); owned = new Map(); wish = new Map(); }
    for (const e of data.entries) if (e && e.dex >= 1 && e.dex <= TOTAL) { await saveEntry(e); added++; }
    for (const w of data.wish || []) if (w && w.dex >= 1 && w.dex <= TOTAL) { await saveWish(w.dex, w); wished++; }
  } else {
    // A spreadsheet exported from this app, or from the Claude version of Living Pokédex
    const rows = parseCSV(text);
    const head = rows.shift().map(h => h.trim().toLowerCase());
    const col = (...names) => { for (const nm of names) { const i = head.indexOf(nm); if (i >= 0) return i; } return -1; };
    const iDex = col("dex #"), iGot = col("got it?"), iCard = col("card used (set & number)", "set"), iNum = col("card number"),
      iCond = col("condition"), iPaid = col("paid (£)"), iVal = col("raw value (£)"), iSp = col("spares"), iWish = col("on wishlist"), iMax = col("wishlist max (£)"), iNotes = col("notes");
    if (iDex < 0 || iGot < 0) throw new Error("That spreadsheet doesn't have the Dex # and Got it? columns.");
    const numOr = (r, i) => i >= 0 && r[i] !== "" && !isNaN(+r[i]) ? +r[i] : null;
    for (const r of rows) {
      const n = parseInt(r[iDex], 10); if (!(n >= 1 && n <= TOTAL)) continue;
      if (/^yes$/i.test(r[iGot] || "")) {
        if (owned.has(n) && !replace) continue;
        await saveEntry({ dex: n, name: nameOf(n), set: iCard >= 0 ? r[iCard] : "", number: iNum >= 0 ? r[iNum] : "", finish: "standard",
          condition: CONDITIONS.includes(r[iCond]) ? r[iCond] : null, paid: numOr(r, iPaid), value: numOr(r, iVal),
          spares: parseInt(iSp >= 0 ? r[iSp] : "0", 10) || 0, notes: iNotes >= 0 ? r[iNotes] : "", addedAt: new Date().toISOString(), cardId: null });
        added++;
      } else if (iWish >= 0 && /^yes$/i.test(r[iWish] || "")) { await saveWish(n, { dex: n, target: numOr(r, iMax), addedAt: new Date().toISOString() }); wished++; }
    }
  }
  render();
  return { added, wished };
}

function openSettings() {
  let lastBackup = null; try { lastBackup = localStorage.getItem("lastBackup"); } catch {}
  sheetShell("Settings & backup", `
    <div class="setting">
      <h4>Binder pictures</h4>
      <div class="finish" role="group" aria-label="Binder pictures">
        <button type="button" data-b="card" aria-pressed="${prefs.binder === "card"}">Official card images</button>
        <button type="button" data-b="photo" aria-pressed="${prefs.binder === "photo"}">My photos</button>
      </div>
    </div>
    <div class="setting">
      <h4>Backup</h4>
      <p class="hint">Your collection is saved on this phone only. Save a backup now and then (to iCloud Drive or Files), so you can restore it if you change phones.${lastBackup ? ` Last backup ${shortDate(lastBackup)}.` : ""} Photos aren't included.</p>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="bkBtn">Save a backup</button><button type="button" class="btn" id="rsBtn">Restore a backup</button></div>
    </div>
    <div class="setting">
      <h4>Spreadsheet</h4>
      <p class="hint">Export to open in Excel or Numbers, or import a spreadsheet exported from the Claude version of Living Pokédex. Imported cards keep their set and price but aren't linked for price updates until you pick the card in each entry.</p>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" id="csvBtn">Export CSV</button><button type="button" class="btn" id="impBtn">Import CSV</button></div>
    </div>
    <div class="setting">
      <h4>Prices</h4>
      <p class="hint">Cardmarket trend prices, from TCGdex with the Pokémon TCG API as a backup, converted at €1 = £${fx.rate.toFixed(3)}${fx.live ? ` (rate from ${shortDate(fx.at)})` : " (estimated rate: couldn't get today's)"}. Cardmarket updates prices daily.</p>
    </div>
    <div class="setting">
      <h4>Start over</h4>
      <div id="wipeRow" class="actions" style="justify-content:flex-start"><button type="button" class="btn danger" id="wipeBtn">Delete my collection</button></div>
    </div>`);
  document.querySelectorAll("[data-b]").forEach(b => b.onclick = () => {
    prefs.binder = b.dataset.b; savePrefs();
    document.querySelectorAll("[data-b]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  $("#bkBtn").onclick = () => { exportBackup(); toast("Backup saved to your downloads"); };
  $("#csvBtn").onclick = exportCSV;
  const pick = replace => {
    const inp = $("#fileIn"); inp.value = "";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { const { added, wished } = await importFile(f, replace); closeSheet(); toast(`Imported ${added} cards${wished ? ` and ${wished} wishlist items` : ""}`); }
      catch (e) { toast(e?.message || "Couldn't read that file."); }
    };
    inp.click();
  };
  $("#impBtn").onclick = () => pick(false);
  $("#rsBtn").onclick = () => {
    $("#rsBtn").parentElement.innerHTML = `<span class="status">Restoring replaces everything currently in the app.</span><button type="button" class="btn" id="rsNo">Cancel</button><button type="button" class="btn danger" id="rsYes">Choose backup file</button>`;
    $("#rsNo").onclick = openSettings;
    $("#rsYes").onclick = () => pick(true);
  };
  $("#wipeBtn").onclick = () => {
    $("#wipeRow").innerHTML = `<span class="status" style="margin-right:auto">Delete all ${owned.size} cards, your wishlist and photos? This can't be undone.</span><button type="button" class="btn" id="wNo">Keep</button><button type="button" class="btn danger" id="wYes">Delete</button>`;
    $("#wNo").onclick = openSettings;
    $("#wYes").onclick = async () => {
      for (const t of ["entries", "wish", "photos"]) await store.clear(t);
      for (const u of photoUrls.values()) URL.revokeObjectURL(u);
      owned = new Map(); wish = new Map(); photoUrls = new Map();
      closeSheet(); render(); toast("Collection deleted");
    };
  };
}

// ---------- events ----------
$(".seg").addEventListener("click", ev => {
  const b = ev.target.closest("button[data-view]"); if (!b) return;
  view = b.dataset.view;
  document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  render();
});
$("#regions").addEventListener("click", ev => { const b = ev.target.closest(".reg"); if (!b) return; gen = gen === +b.dataset.gen ? 0 : +b.dataset.gen; render(); });
$("#typeSel").innerHTML += TYPES.map((t, i) => `<option value="${i + 1}">${t}</option>`).join("");
$("#typeSel").addEventListener("change", ev => { typeFilter = +ev.target.value; render(); });
let qt; $("#q").addEventListener("input", ev => { clearTimeout(qt); qt = setTimeout(() => { query = ev.target.value; render(); }, 120); });
$("#list").addEventListener("click", ev => {
  const s = ev.target.closest(".slot"); if (!s) return;
  const n = +s.dataset.dex;
  openCardSheet({ mode: owned.has(n) ? "edit" : "add", dex: n });
});
const setRapid = on => { prefs.rapid = on; savePrefs(); $("#rapidBtn").setAttribute("aria-pressed", String(on)); };
setRapid(prefs.rapid);
$("#rapidBtn").onclick = () => { setRapid(!prefs.rapid); toast(prefs.rapid ? "Rapid scan on: clear matches and spares go straight in" : "Rapid scan off"); };
$("#scanBtn").onclick = openCamera;
$("#cam").addEventListener("change", ev => { const f = ev.target.files?.[0]; if (f) startScan(f); });
$("#manualBtn").onclick = () => openCardSheet({ mode: "add" });
$("#sparesBtn").onclick = openSpares;
$("#settingsBtn").onclick = openSettings;
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !document.querySelector(".cropper")) closeSheet(); });
$("#dexList").innerHTML = NAMES.map((nm, i) => `<option value="#${pad(i + 1)} ${esc(nm)}"></option>`).join("");

// ---------- start ----------
render();
(async () => {
  try {
    owned = await store.all("entries");
    wish = await store.all("wish");
    for (const [n, blob] of await store.all("photos")) photoUrls.set(n, URL.createObjectURL(blob));
  } catch {
    const note = $("#notice"); note.hidden = false;
    note.textContent = "This browser won't let the app save. If you're in a private window, open it normally.";
  }
  render();
  askToKeepData();
  eurToGbp().then(r => { fx = r; renderViewBar(); });
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
