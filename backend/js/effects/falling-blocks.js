export const meta = {
  name: "Falling Blocks",
  description: "A self-playing game of falling tetrominoes that slide into place, clear full lines and start over when the well fills up.",
  category: "Simulations & games",
  colors: [
    { id: "a", label: "Colour one", default: "#ff4f8b" },
    { id: "b", label: "Colour two", default: "#ffc23d" },
    { id: "c", label: "Colour three", default: "#3dd6ff" },
    { id: "background", label: "Background", default: "#020308" },
  ],
  params: {
    speed: { type: "number", label: "Drop speed", min: 1, max: 15, step: 0.5, default: 6 },
    skill: { type: "number", label: "Player skill", min: 0, max: 1, step: 0.01, default: 0.85 },
    brightness: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.75 },
  },
};

const SHAPES = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], // I
  [[0, 0], [1, 0], [0, 1], [1, 1]], // O
  [[0, 0], [1, 0], [2, 0], [1, 1]], // T
  [[0, 0], [1, 0], [1, 1], [2, 1]], // S
  [[1, 0], [2, 0], [0, 1], [1, 1]], // Z
  [[0, 0], [1, 0], [2, 0], [0, 1]], // L
  [[0, 0], [1, 0], [2, 0], [2, 1]], // J
];
// On a string: short bars in three colours.
const BARS = [[[0, 0]], [[0, 0]], [[0, 0]], [[0, 0], [0, 1]], [[0, 0], [0, 1]], [[0, 0], [0, 1]]];

function rotations(shape) {
  const out = [];
  let cur = shape;
  for (let r = 0; r < 4; r++) {
    let mx = 1e9, my = 1e9;
    for (const [x, y] of cur) { mx = Math.min(mx, x); my = Math.min(my, y); }
    const norm = cur.map(([x, y]) => [x - mx, y - my]);
    const key = norm.map((p) => p.join(",")).sort().join(";");
    if (!out.some((o) => o.key === key)) out.push({ key, cells: norm });
    cur = cur.map(([x, y]) => [y, -x]);
  }
  return out.map((o) => o.cells);
}

// Logical grid mapped onto the LEDs by position. On a curtain it matches the
// LED columns and rows; on a straight string it is a single well laid along
// the string, filling up from the start.
function makeGrid(ctx, defW, defH, lineCells) {
  const { n, x, y } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = defW, H = defH;
  if (line) { W = 1; H = lineCells; }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gx[i] = line ? 0 : x[i] * (W - 1);
    gy[i] = (line ? x[i] : y[i]) * (H - 1);
  }
  return { W, H, line, gx, gy };
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const Hb = g.H + 4;
  const pieces = (g.W >= 4 ? SHAPES : BARS).map(rotations);
  const s = {
    g, Hb, pieces,
    board: new Uint8Array(g.W * Hb), // 0 empty, else colour index + 1
    level: new Float32Array(g.W * Hb), // displayed brightness per cell
    fall: new Float32Array(Hb), // display offset of each row after a clear (rows)
    clearing: [], // rows flashing before removal
    clearT: 0,
    piece: null,
    prev: new Float32Array(8),
    acc: 0,
    over: 0,
    bag: [],
  };
  spawn(s, ctx.params);
  return s;
}

function fits(s, cells, px, py) {
  const { W } = s.g;
  for (const [cx, cy] of cells) {
    const x = px + cx, y = py + cy;
    if (x < 0 || x >= W || y < 0 || y >= s.Hb) return false;
    if (s.board[y * W + x]) return false;
  }
  return true;
}

function dropY(s, cells, px) {
  let y = s.g.H;
  if (!fits(s, cells, px, y)) return -1;
  while (y > 0 && fits(s, cells, px, y - 1)) y--;
  return y;
}

// Classic heuristic: few holes, low and flat stack, many cleared lines.
function evaluate(s, cells, px, py) {
  const { W, H } = s.g;
  // Place the piece temporarily on the board itself, then take it away.
  const b = s.board;
  for (const [cx, cy] of cells) b[(py + cy) * W + px + cx] = 255;
  let lines = 0;
  for (let y = 0; y < s.Hb; y++) {
    let full = true;
    for (let x = 0; x < W; x++) if (!b[y * W + x]) { full = false; break; }
    if (full) lines++;
  }
  let agg = 0, holes = 0, bump = 0, lastH = -1, maxH = 0;
  for (let x = 0; x < W; x++) {
    let h = 0;
    for (let y = s.Hb - 1; y >= 0; y--) if (b[y * W + x]) { h = y + 1; break; }
    for (let y = 0; y < h; y++) if (!b[y * W + x]) holes++;
    agg += h;
    maxH = Math.max(maxH, h);
    if (lastH >= 0) bump += Math.abs(h - lastH);
    lastH = h;
  }
  for (const [cx, cy] of cells) b[(py + cy) * W + px + cx] = 0;
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump - (maxH > H - 2 ? 10 : 0);
}

function spawn(s, params) {
  const { W, H } = s.g;
  if (!s.bag.length) {
    s.bag = s.pieces.map((_, i) => i);
    for (let i = s.bag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]]; }
  }
  const kind = s.bag.pop();
  const rots = s.pieces[kind];
  let best = -1e9, tr = 0, tx = 0;
  const noise = 0.3 + (1 - params.skill) * 6; // also breaks ties between equal spots
  for (let r = 0; r < rots.length; r++) {
    for (let x = 0; x < W; x++) {
      const y = dropY(s, rots[r], x);
      if (y < 0) continue;
      const v = evaluate(s, rots[r], x, y) + Math.random() * noise;
      if (v > best) { best = v; tr = r; tx = x; }
    }
  }
  const px = Math.max(0, Math.min(W - 3, ((W - 2) / 2) | 0));
  const p = { kind, rot: 0, x: Math.min(px, W - 1), y: H, tr, tx };
  if (!fits(s, rots[0], p.x, p.y)) p.x = tx;
  if (!fits(s, rots[p.rot], p.x, p.y) || best === -1e9) { s.over = 1.5; s.piece = null; return; }
  s.piece = p;
  savePrev(s);
}

function colourOf(s, kind) {
  return s.g.W === 1 ? kind % 3 : kind;
}

function cellsOf(s) {
  const p = s.piece;
  return s.pieces[p.kind][p.rot];
}

function savePrev(s) {
  const p = s.piece;
  const cells = cellsOf(s);
  for (let k = 0; k < 4; k++) {
    const c = cells[Math.min(k, cells.length - 1)];
    s.prev[k * 2] = p.x + c[0];
    s.prev[k * 2 + 1] = p.y + c[1];
  }
}

function lock(s) {
  const { W } = s.g;
  const p = s.piece;
  const col = colourOf(s, p.kind) + 1;
  for (const [cx, cy] of cellsOf(s)) {
    s.board[(p.y + cy) * W + p.x + cx] = col;
    s.level[(p.y + cy) * W + p.x + cx] = 1;
  }
  s.piece = null;
  const rows = [];
  if (W >= 3) {
    for (let y = 0; y < s.Hb; y++) {
      let full = true;
      for (let x = 0; x < W; x++) if (!s.board[y * W + x]) { full = false; break; }
      if (full) rows.push(y);
    }
  } else {
    // On a string: three or more cells of the same colour in a row vanish.
    let start = 0;
    for (let y = 1; y <= s.Hb; y++) {
      if (y === s.Hb || s.board[y * W] !== s.board[start * W] || !s.board[y * W]) {
        if (s.board[start * W] && y - start >= 3) for (let k = start; k < y; k++) rows.push(k);
        start = y;
      }
    }
  }
  s.clearing = rows;
  s.clearT = rows.length ? 0.45 : 0;
}

function removeRows(s) {
  const { W } = s.g;
  const rows = s.clearing;
  let dst = 0;
  const shift = new Int32Array(s.Hb);
  for (let y = 0, removed = 0; y < s.Hb; y++) {
    if (rows.includes(y)) { removed++; continue; }
    for (let x = 0; x < W; x++) {
      s.board[dst * W + x] = s.board[y * W + x];
      s.level[dst * W + x] = s.level[y * W + x];
    }
    shift[dst] = removed + s.fall[y];
    dst++;
  }
  for (let y = dst; y < s.Hb; y++) {
    for (let x = 0; x < W; x++) { s.board[y * W + x] = 0; s.level[y * W + x] = 0; }
    shift[y] = 0;
  }
  for (let y = 0; y < s.Hb; y++) s.fall[y] = shift[y];
  s.clearing = [];
}

function tick(s, params) {
  if (!s.piece) { spawn(s, params); return; }
  savePrev(s);
  const p = s.piece;
  const rots = s.pieces[p.kind];
  if (p.rot !== p.tr && fits(s, rots[(p.rot + 1) % rots.length], p.x, p.y)) p.rot = (p.rot + 1) % rots.length;
  if (p.x !== p.tx) {
    const nx = p.x + Math.sign(p.tx - p.x);
    if (fits(s, rots[p.rot], nx, p.y)) p.x = nx;
  }
  if (fits(s, rots[p.rot], p.x, p.y - 1)) p.y--;
  else if (p.rot === p.tr && p.x === p.tx) lock(s);
  else if (!fits(s, rots[p.rot], p.x, p.y)) lock(s);
  else {
    // Stuck before reaching the plan: settle here.
    lock(s);
  }
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.25);
  const { W, H, gx, gy } = s.g;
  const step = 1 / params.speed;
  if (s.over > 0) {
    s.over -= dt;
    if (s.over <= 0) {
      s.board.fill(0); s.fall.fill(0); s.clearing = [];
      spawn(s, params);
    }
  } else if (s.clearT > 0) {
    s.clearT -= dt;
    if (s.clearT <= 0) { removeRows(s); spawn(s, params); s.acc = 0; }
  } else {
    s.acc += dt;
    while (s.acc >= step && s.over <= 0 && s.clearT <= 0) {
      s.acc -= step;
      tick(s, params);
    }
  }
  const kUp = 1 - Math.exp(-dt * 14), kDown = 1 - Math.exp(-dt * 5);
  for (let i = 0; i < s.board.length; i++) {
    const target = s.over > 0 ? 0 : s.board[i] ? 1 : 0;
    s.level[i] += (target - s.level[i]) * (target > s.level[i] ? kUp : kDown);
  }
  for (let y = 0; y < s.Hb; y++) s.fall[y] = Math.max(0, s.fall[y] - dt * 10);

  const bg = colors[3] || [0, 0, 0];
  const pal = [colors[0] || [1, 0.3, 0.5], colors[1] || [1, 0.75, 0.25], colors[2] || [0.25, 0.85, 1]];
  const nk = W === 1 ? 3 : s.pieces.length;
  const kindCol = s.kindCol || (s.kindCol = []);
  for (let k = 0; k < nk; k++) kindCol[k] = palette(pal, k / nk, true);
  const flash = s.clearT > 0 ? 0.5 + 0.5 * Math.sin(s.clearT * 40) : 0;
  const br = params.brightness;
  const p = s.piece;
  const prog = s.over > 0 || s.clearT > 0 ? 1 : ease.inOut(clamp(s.acc / step));
  const cells = p ? cellsOf(s) : null;
  for (let i = 0; i < n; i++) {
    const X = gx[i], Y = gy[i];
    let r = 0, g = 0, b = 0;
    const c0 = Math.floor(X);
    const ylo = Math.max(0, Math.floor(Y) - 5), yhi = Math.min(s.Hb - 1, Math.ceil(Y) + 1);
    for (let row = ylo; row <= yhi; row++) {
      const wy = 1 - Math.abs(Y - row - s.fall[row]);
      if (wy <= 0) continue;
      const lit = s.clearing.includes(row) ? 1 + flash : 1;
      for (let c = c0; c <= c0 + 1; c++) {
        if (c < 0 || c >= W) continue;
        const w = (W === 1 ? 1 : 1 - Math.abs(X - c)) * wy;
        if (w <= 0) continue;
        const k = row * W + c;
        const kind = s.board[k];
        if (!kind || s.level[k] <= 0) continue;
        const col = kindCol[kind - 1];
        const v = s.level[k] * w * lit;
        r += col[0] * v; g += col[1] * v; b += col[2] * v;
      }
    }
    if (p) {
      const col = kindCol[colourOf(s, p.kind)];
      for (let k = 0; k < cells.length; k++) {
        const ax = lerp(s.prev[k * 2], p.x + cells[k][0], prog);
        const ay = lerp(s.prev[k * 2 + 1], p.y + cells[k][1], prog);
        const wx = W === 1 ? 1 : 1 - Math.abs(X - ax), wy = 1 - Math.abs(Y - ay);
        if (wx <= 0 || wy <= 0) continue;
        const v = wx * wy * 1.15;
        r += col[0] * v; g += col[1] * v; b += col[2] * v;
      }
    }
    const o = i * 3;
    out[o] = bg[0] + Math.min(r, 1.3) * br;
    out[o + 1] = bg[1] + Math.min(g, 1.3) * br;
    out[o + 2] = bg[2] + Math.min(b, 1.3) * br;
  }
}
