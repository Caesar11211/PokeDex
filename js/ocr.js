// ocr.js — reads the Pokémon's name and the collector number ("025/165") off your cropped card photo.
// It uses Tesseract.js, a free text reader that runs on the phone itself. The first scan downloads
// its English reading data (a few MB); after that it's cached.
//
// It works on the straightened crop from the crop screen (always 504 × 704 px, card filling the frame),
// so it knows roughly where the name and number sit on the card.

let workerPromise = null;

function getWorker(onStatus) {
  if (!window.Tesseract) return Promise.reject(new Error("The text reader didn't load. Check your connection."));
  if (!workerPromise) {
    onStatus?.("Getting the text reader ready (first scan only)");
    workerPromise = window.Tesseract.createWorker("eng").catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Cut a strip out of the card, enlarge it and boost contrast so small printed text reads better.
function strip(bmp, x, y, w, h, scale = 3) {
  const sx = Math.round(bmp.width * x), sy = Math.round(bmp.height * y);
  const sw = Math.round(bmp.width * w), sh = Math.round(bmp.height * h);
  const c = document.createElement("canvas");
  c.width = sw * scale; c.height = sh * scale;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  let lo = 255, hi = 0;
  const g = new Uint8Array(d.length / 4);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    if (g[p] < lo) lo = g[p]; if (g[p] > hi) hi = g[p];
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const v = (g[p] - lo) * 255 / span; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Pull the collector number out of the bottom-strip text. */
export function parseNumber(text) {
  // OCR often reads a zero as the letter O, and a slash as | or \
  const t = String(text || "").toUpperCase().replace(/[|\\]/g, "/").replace(/(\d)O/g, "$10").replace(/O(\d)/g, "0$1");
  let m = t.match(/\b(TG|GG|SV|RC)\s?(\d{1,3})\s*\/\s*(TG|GG|SV|RC)?\s?(\d{1,3})\b/);
  if (m) return { number: m[1] + m[2].padStart(2, "0"), total: null };
  m = t.match(/(\d{1,3})\s*\/\s*(\d{2,3})(?!\d)/);
  if (m) {
    const n = parseInt(m[1], 10), total = parseInt(m[2], 10);
    if (n > 0 && total >= 10) return { number: String(n), total };
  }
  m = t.match(/\b(SVP|SWSH|SM|XY|BW|HGSS|DP)\s?(\d{1,3})\b/);      // black-star promos
  if (m) return { number: m[1] + m[2].padStart(m[1] === "SVP" ? 3 : 2, "0"), total: null };
  return { number: "", total: null };
}

function lev(a, b) {
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = v[0]; v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return v[b.length];
}
const letters = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

/** Best guess at which Pokémon the name text is, allowing for a few misread letters. Returns a Dex number or 0. */
export function matchSpecies(text, names) {
  const toks = String(text || "").split(/[^A-Za-zÀ-ÿ.'’-]+/).filter(t => letters(t).length >= 2);
  const grams = new Set();
  for (let i = 0; i < toks.length; i++) {
    grams.add(letters(toks[i]));
    if (i + 1 < toks.length) grams.add(letters(toks[i] + toks[i + 1]));
    if (i + 2 < toks.length) grams.add(letters(toks[i] + toks[i + 1] + toks[i + 2]));
  }
  let best = 0, bestScore = Infinity;
  names.forEach((name, i) => {
    const n = letters(name);
    if (n.length < 3) return;
    for (const g of grams) {
      if (g.length < 3 || Math.abs(g.length - n.length) > 2) continue;
      const d = lev(g, n);
      const allowed = n.length <= 4 ? 0 : n.length <= 7 ? 1 : 2;
      if (d <= allowed) {
        const score = d / n.length - n.length * 0.001;     // fewer mistakes first, longer names on a tie
        if (score < bestScore) { bestScore = score; best = i + 1; }
      }
    }
  });
  return best;
}

/** Read a cropped card photo. Resolves { dex, nameText, number, total, numberText }. */
export async function readCard(blob, names, onStatus) {
  const worker = await getWorker(onStatus);
  const bmp = await createImageBitmap(blob);
  onStatus?.("Reading the card");
  // The name sits along the top edge; the collector number along the bottom.
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const nameText = (await worker.recognize(strip(bmp, 0.04, 0.02, 0.74, 0.11))).data.text;
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ " });
  const numberText = (await worker.recognize(strip(bmp, 0, 0.885, 1, 0.105))).data.text;
  const { number, total } = parseNumber(numberText);
  return { dex: matchSpecies(nameText, names), nameText, number, total, numberText };
}
