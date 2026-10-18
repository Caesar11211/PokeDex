// detect.js — finds the card in your photo and lets you line it up (the crop screen).
// detectCore tries three ways of separating the card from the table (colour, brightness and outline edges)
// and keeps whichever result is most card-shaped (a Pokémon card is 63 × 88 mm).

function otsu(vals, n){
  const hist = new Float64Array(256); for (let i=0;i<n;i++) hist[vals[i]]++;
  let sum = 0; for (let t=0;t<256;t++) sum += t*hist[t];
  let sumB = 0, wB = 0, best = -1, thr = 128;
  for (let t=0;t<256;t++){ wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sumB += t*hist[t];
    const mB = sumB/wB, mF = (sum-sumB)/wF, v = wB*wF*(mB-mF)*(mB-mF); if (v > best){ best = v; thr = t; } }
  return thr;
}
export function detectCore(d, w, h){
  const N = w*h, gray = new Uint8Array(N);
  for (let p=0;p<N;p++){ const i=p*4; gray[p] = (d[i]*.299 + d[i+1]*.587 + d[i+2]*.114) | 0; }
  const b = Math.max(2, Math.round(Math.min(w,h)*0.04)), border = [];
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) if (x<b || y<b || x>=w-b || y>=h-b) border.push(y*w+x);
  const med = a => { a.sort((p,q)=>p-q); return a[a.length>>1]; };
  const br = med(border.map(p=>d[p*4])), bgc = med(border.map(p=>d[p*4+1])), bb = med(border.map(p=>d[p*4+2]));
  const dmap = new Uint8Array(N);
  for (let p=0;p<N;p++){ const i=p*4, r=d[i]-br, g=d[i+1]-bgc, bl=d[i+2]-bb; dmap[p] = Math.min(255, Math.sqrt(r*r+g*g+bl*bl)); }
  const morph = (src, r, dil) => {
    const t = new Uint8Array(N), o = new Uint8Array(N);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let v = dil?0:1;
      for (let q=-r;q<=r;q++){ const X=x+q; const s=(X<0||X>=w)?0:src[y*w+X]; if (dil?s:!s){ v=dil?1:0; break; } } t[y*w+x]=v; }
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let v = dil?0:1;
      for (let q=-r;q<=r;q++){ const Y=y+q; const s=(Y<0||Y>=h)?0:t[Y*w+x]; if (dil?s:!s){ v=dil?1:0; break; } } o[y*w+x]=v; }
    return o;
  };
  const fillHoles = m => {
    const seen = new Uint8Array(N), q = new Int32Array(N); let qh=0, qt=0;
    const push = p => { if (!m[p] && !seen[p]){ seen[p]=1; q[qt++]=p; } };
    for (let x=0;x<w;x++){ push(x); push((h-1)*w+x); }
    for (let y=0;y<h;y++){ push(y*w); push(y*w+w-1); }
    while (qh<qt){ const p=q[qh++], x=p%w, y=(p/w)|0;
      if (x>0) push(p-1); if (x<w-1) push(p+1); if (y>0) push(p-w); if (y<h-1) push(p+w); }
    for (let p=0;p<N;p++) if (!m[p] && !seen[p]) m[p]=1;
    return m;
  };
  const evaluate = m => {
    const lab = new Int32Array(N), queue = new Int32Array(N);
    let bestLab=0, bestSize=0, cur=0;
    for (let p=0;p<N;p++){
      if (!m[p] || lab[p]) continue;
      cur++; let qh=0, qt=0, size=0; queue[qt++]=p; lab[p]=cur;
      while (qh<qt){ const q=queue[qh++]; size++; const qx=q%w, qy=(q/w)|0;
        if (qx>0 && m[q-1] && !lab[q-1]){ lab[q-1]=cur; queue[qt++]=q-1; }
        if (qx<w-1 && m[q+1] && !lab[q+1]){ lab[q+1]=cur; queue[qt++]=q+1; }
        if (qy>0 && m[q-w] && !lab[q-w]){ lab[q-w]=cur; queue[qt++]=q-w; }
        if (qy<h-1 && m[q+w] && !lab[q+w]){ lab[q+w]=cur; queue[qt++]=q+w; } }
      if (size>bestSize){ bestSize=size; bestLab=cur; }
    }
    if (!bestLab || bestSize < N*0.04) return null;
    const cMin = new Int32Array(w).fill(-1), cMax = new Int32Array(w).fill(-1);
    for (let p=0;p<N;p++) if (lab[p]===bestLab){ const px=p%w, py=(p/w)|0; if (cMin[px]<0 || py<cMin[px]) cMin[px]=py; if (py>cMax[px]) cMax[px]=py; }
    const pts = [];
    for (let px=0;px<w;px++) if (cMin[px]>=0){ pts.push([px,cMin[px]]); pts.push([px+1,cMin[px]]); pts.push([px,cMax[px]+1]); pts.push([px+1,cMax[px]+1]); }
    pts.sort((a,c)=>a[0]-c[0] || a[1]-c[1]);
    const cross = (o,a,c) => (a[0]-o[0])*(c[1]-o[1]) - (a[1]-o[1])*(c[0]-o[0]);
    const lower=[], upper=[];
    for (const p of pts){ while (lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i=pts.length-1;i>=0;i--){ const p=pts[i]; while (upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0,-1).concat(upper.slice(0,-1));
    if (hull.length < 4) return null;
    let best = null;
    for (let i=0;i<hull.length;i++){
      const a=hull[i], c=hull[(i+1)%hull.length], th=Math.atan2(c[1]-a[1], c[0]-a[0]), co=Math.cos(th), si=Math.sin(th);
      let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
      for (const [px,py] of hull){ const u=px*co+py*si, v=-px*si+py*co; if(u<u0)u0=u; if(u>u1)u1=u; if(v<v0)v0=v; if(v>v1)v1=v; }
      const area=(u1-u0)*(v1-v0);
      if (!best || area<best.area) best={area, th, co, si, wU:u1-u0, hV:v1-v0, uc:(u0+u1)/2, vc:(v0+v1)/2};
    }
    const long=Math.max(best.wU,best.hV), short=Math.min(best.wU,best.hV);
    const ratio=short/long, cover=best.area/N, solid=bestSize/best.area;
    if (ratio<0.58 || ratio>0.88 || cover<0.05 || cover>0.97 || solid<0.82) return null;
    let ang = best.wU>=best.hV ? Math.PI/2 - best.th : -best.th;
    ang = ((ang + Math.PI/2) % Math.PI + Math.PI) % Math.PI - Math.PI/2;
    return { cx: best.uc*best.co - best.vc*best.si, cy: best.uc*best.si + best.vc*best.co, long, ang,
             score: solid - 2.5*Math.abs(ratio - 0.716) + 0.15*Math.min(cover, 0.6), how: "" };
  };
  const cands = [];
  const tryMask = (m, how) => { const r = evaluate(fillHoles(m)); if (r){ r.how = how; cands.push(r); } };
  // 1. colour difference from the table
  { const t = Math.max(24, otsu(dmap, N)); const m = new Uint8Array(N); for (let p=0;p<N;p++) m[p] = dmap[p] > t; tryMask(morph(morph(m,2,true),2,false), "colour"); }
  // 2. brightness
  { const t = otsu(gray, N); let bm = 0; for (const p of border) bm += gray[p]; bm /= border.length;
    const bright = bm <= t; const m = new Uint8Array(N); for (let p=0;p<N;p++) m[p] = bright ? gray[p] > t : gray[p] <= t;
    tryMask(morph(morph(m,2,true),2,false), "brightness"); }
  // 3. outline edges
  { const mag = new Uint8Array(N);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++){ const p=y*w+x;
      const gx = -gray[p-w-1]-2*gray[p-1]-gray[p+w-1]+gray[p-w+1]+2*gray[p+1]+gray[p+w+1];
      const gy = -gray[p-w-1]-2*gray[p-w]-gray[p-w+1]+gray[p+w-1]+2*gray[p+w]+gray[p+w+1];
      mag[p] = Math.min(255, Math.hypot(gx,gy)/4); }
    const t = Math.max(18, otsu(mag, N)); const m = new Uint8Array(N); for (let p=0;p<N;p++) m[p] = mag[p] > t;
    const filled = fillHoles(morph(m,2,true));
    const r = evaluate(morph(filled,2,false)); if (r){ r.how = "edges"; cands.push(r); } }
  if (!cands.length) return null;
  cands.sort((a,c) => c.score - a.score);
  return cands[0];
}

/** Find the card in a photo. Returns its centre (relative to the photo's centre), long side and tilt, or null. */
export function detectCard(bmp) {
  try {
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const w = Math.max(16, Math.round(bmp.width * k)), h = Math.max(16, Math.round(bmp.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(bmp, 0, 0, w, h);
    const r = detectCore(x.getImageData(0, 0, w, h).data, w, h);
    if (!r) return null;
    return { cx: r.cx / k - bmp.width / 2, cy: r.cy / k - bmp.height / 2, long: r.long / k, ang: r.ang };
  } catch { return null; }
}

// Draws the photo through a transform: centre + offset, then rotate, then scale.
function makeView(bmp) {
  return {
    s: 1, ang: 0, tx: 0, ty: 0,
    draw(c, W, H) { c.save(); c.translate(W / 2 + this.tx, H / 2 + this.ty); c.rotate(this.ang); c.scale(this.s, this.s); c.drawImage(bmp, -bmp.width / 2, -bmp.height / 2); c.restore(); },
    centreOn(px, py) { const co = Math.cos(this.ang), si = Math.sin(this.ang); this.tx = -this.s * (px * co - py * si); this.ty = -this.s * (px * si + py * co); },
    centrePoint() { const co = Math.cos(-this.ang), si = Math.sin(-this.ang), x = -this.tx / this.s, y = -this.ty / this.s; return [x * co - y * si, x * si + y * co]; },
  };
}
function cropFromView(v, frame, W, H) {
  const OW = 504, OH = 704, oc = document.createElement("canvas"); oc.width = OW; oc.height = OH;
  const o = oc.getContext("2d"); o.fillStyle = "#ffffff"; o.fillRect(0, 0, OW, OH);
  o.setTransform(OW / frame.w, 0, 0, OH / frame.h, -frame.x * OW / frame.w, -frame.y * OH / frame.h);
  v.draw(o, W, H);
  return new Promise(r => oc.toBlob(r, "image/jpeg", .9));
}

const TRIM = 0.985;   // zoom in a touch so no table shows along the card's edges

/**
 * Show the crop screen in `root` and resolve with the straightened card as a JPEG blob,
 * the original file ("Whole photo"), or null if cancelled.
 * With skipIfFound, a cleanly detected card is cropped straight away without showing the screen.
 */
export function cropCard(file, bmp, found, root, { skipIfFound = false } = {}) {
  return new Promise(async resolve => {
    if (!bmp) { resolve(file); return; }
    if (skipIfFound && found) {
      const W = 400, H = 560, frame = { x: 0, y: 0, w: W, h: H }, v = makeView(bmp);
      v.ang = found.ang; v.s = H / (found.long * TRIM); v.centreOn(found.cx, found.cy);
      resolve((await cropFromView(v, frame, W, H)) || file); return;
    }
    root.innerHTML = `<div class="cropper" role="dialog" aria-modal="true" aria-labelledby="cropT">
      <div class="crop-top"><span id="cropT">Line up the card</span><button type="button" class="x" id="cX" aria-label="Cancel scan">×</button></div>
      <p class="crop-hint" id="cHint"></p>
      <canvas id="cropCv" aria-label="Card photo"></canvas>
      <div class="crop-bar"><button type="button" class="btn" id="cRot">Rotate</button><button type="button" class="btn" id="cAuto">Auto</button><button type="button" class="btn" id="cSkip">Whole photo</button><button type="button" class="btn primary" id="cOk">Use this crop</button></div>
    </div>`;
    const $ = s => root.querySelector(s);
    const cv = $("#cropCv"), ctx = cv.getContext("2d"), hint = $("#cHint");
    const v = makeView(bmp);
    let W = 0, H = 0, dpr = 1, frame = null, minS = .05, maxS = 20;
    function layout() {
      const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const fh = Math.min(H * .88, W * .86 * 88 / 63), fw = fh * 63 / 88;
      frame = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    }
    function fitWhole() {
      const turned = Math.round(v.ang / (Math.PI / 2)) % 2 !== 0;
      const iw = turned ? bmp.height : bmp.width, ih = turned ? bmp.width : bmp.height;
      v.s = Math.max(frame.w / iw, frame.h / ih); v.tx = v.ty = 0;
    }
    function applyAuto() {
      if (found) {
        v.ang = found.ang; v.s = frame.h / (found.long * TRIM); v.centreOn(found.cx, found.cy);
        hint.className = "crop-hint found"; hint.textContent = "Card found and zoomed in. Nudge it if an edge is off.";
      } else {
        v.ang = 0; fitWhole();
        hint.className = "crop-hint"; hint.textContent = "Couldn't spot the card's edges. Drag and pinch to line it up. A plain, contrasting background helps.";
      }
      minS = v.s * .25; maxS = v.s * 8;
    }
    function rr(c, f) { const r = f.w * .045; c.roundRect ? c.roundRect(f.x, f.y, f.w, f.h, r) : c.rect(f.x, f.y, f.w, f.h); }
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); v.draw(ctx, W, H);
      ctx.fillStyle = "rgba(8,10,16,.66)"; ctx.beginPath(); ctx.rect(0, 0, W, H); rr(ctx, frame); ctx.fill("evenodd");
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); rr(ctx, frame); ctx.stroke();
    }
    function zoomAt(f, cx, cy) {
      const r = cv.getBoundingClientRect();
      const ns = Math.min(maxS, Math.max(minS, v.s * f)), k = ns / v.s;
      const px = cx - r.left - W / 2 - v.tx, py = cy - r.top - H / 2 - v.ty;
      v.tx -= px * (k - 1); v.ty -= py * (k - 1); v.s = ns;
    }
    // Drag with one finger, pinch with two.
    const pts = new Map(); let last = null;
    const snap = () => {
      const a = [...pts.values()];
      if (a.length >= 2) return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
      if (a.length === 1) return { x: a[0].x, y: a[0].y, d: 0 };
      return null;
    };
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = snap(); });
    cv.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = snap();
      if (last && now) { if (now.d && last.d) zoomAt(now.d / last.d, now.x, now.y); v.tx += now.x - last.x; v.ty += now.y - last.y; draw(); }
      last = now;
    });
    const lift = e => { pts.delete(e.pointerId); last = snap(); };
    cv.addEventListener("pointerup", lift); cv.addEventListener("pointercancel", lift);
    cv.addEventListener("wheel", e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); draw(); }, { passive: false });
    const onResize = () => { layout(); draw(); };
    window.addEventListener("resize", onResize);
    const done = val => { window.removeEventListener("resize", onResize); resolve(val); };
    $("#cRot").onclick = () => { const [px, py] = v.centrePoint(); v.ang += Math.PI / 2; v.centreOn(px, py); draw(); };
    $("#cAuto").onclick = () => { applyAuto(); draw(); };
    $("#cX").onclick = () => { root.innerHTML = ""; done(null); };
    $("#cSkip").onclick = () => done(file);
    $("#cOk").onclick = async () => done((await cropFromView(v, frame, W, H)) || file);
    requestAnimationFrame(() => { layout(); applyAuto(); draw(); });
  });
}
