export const meta = {
  name: "Snake",
  description: "A self-playing snake glides between cells, eats food and starts over when it gets stuck.",
  category: "Simulations & games",
  colors: [
    { id: "head", label: "Head", default: "#b8ff5a" },
    { id: "tail", label: "Tail", default: "#11a36b" },
    { id: "food", label: "Food", default: "#ff3d6e" },
    { id: "background", label: "Background", default: "#020406" },
  ],
  params: {
    speed: { type: "number", label: "Cells per second", min: 1, max: 12, step: 0.5, default: 5 },
    start: { type: "number", label: "Starting length", min: 2, max: 8, step: 1, default: 3 },
    width: { type: "number", label: "Thickness", min: 0.6, max: 2, step: 0.05, default: 1 },
  },
};

// Logical grid mapped onto the LEDs by position. On a curtain the grid
// matches the LED columns and rows; on a straight string it is one row.
function makeGrid(ctx, defW, defH, lineCells) {
  const { n, x, y } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = defW, H = defH;
  if (line) { W = lineCells; H = 1; }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let i = 0; i < n; i++) { gx[i] = x[i] * (W - 1); gy[i] = line ? 0 : y[i] * (H - 1); }
  return { W, H, line, gx, gy };
}

function neighbours(g, c, res) {
  const { W, H } = g;
  const cx = c % W, cy = (c / W) | 0;
  let k = 0;
  if (cx > 0) res[k++] = c - 1;
  if (cx < W - 1) res[k++] = c + 1;
  if (cy > 0) res[k++] = c - W;
  if (cy < H - 1) res[k++] = c + W;
  return k;
}

function reset(s, len) {
  const { W, H } = s.g;
  s.blocked.fill(0);
  s.body.length = 0;
  const row = (H / 2) | 0;
  const startX = Math.min(len, W - 2);
  for (let k = 0; k < Math.min(len, W - 1); k++) {
    const c = row * W + startX - k;
    s.body.push(c);
    s.blocked[c] = 1;
  }
  s.ghost = s.body[s.body.length - 1];
  s.dying = 0;
  s.acc = 0;
  placeFood(s);
}

function placeFood(s) {
  const size = s.g.W * s.g.H;
  const head = s.body[0];
  for (let tries = 0; tries < 200; tries++) {
    const c = (Math.random() * size) | 0;
    if (s.blocked[c]) continue;
    if (tries < 100 && Math.abs((c % s.g.W) - (head % s.g.W)) + Math.abs(((c / s.g.W) | 0) - ((head / s.g.W) | 0)) < 3) continue;
    s.food = c;
    s.foodAge = 0;
    return true;
  }
  return false;
}

// Breadth-first search from the head; returns the first step towards `goal`, or -1.
function firstStep(s, goal) {
  const { prev, queue, blocked } = s;
  prev.fill(-1);
  const head = s.body[0];
  const tail = s.body[s.body.length - 1];
  let qh = 0, qt = 0;
  queue[qt++] = head;
  prev[head] = head;
  while (qh < qt) {
    const c = queue[qh++];
    if (c === goal) break;
    const k = neighbours(s.g, c, s.nb);
    for (let j = 0; j < k; j++) {
      const d = s.nb[j];
      if (prev[d] !== -1 || (blocked[d] && d !== tail)) continue;
      prev[d] = c;
      queue[qt++] = d;
    }
  }
  if (prev[goal] === -1) return -1;
  let c = goal;
  while (prev[c] !== head) c = prev[c];
  return c;
}

function area(s, start) {
  const { prev, queue, blocked } = s;
  prev.fill(-1);
  let qh = 0, qt = 0;
  queue[qt++] = start;
  prev[start] = start;
  const nb = [0, 0, 0, 0];
  while (qh < qt) {
    const c = queue[qh++];
    const k = neighbours(s.g, c, nb);
    for (let j = 0; j < k; j++) {
      const d = nb[j];
      if (prev[d] !== -1 || blocked[d]) continue;
      prev[d] = c;
      queue[qt++] = d;
    }
  }
  return qt;
}

function tick(s, params, turned) {
  const { body, blocked } = s;
  const tail = body[body.length - 1];
  let next = firstStep(s, s.food);
  if (next >= 0 && !s.g.line) {
    // Don't walk into a pocket smaller than the snake.
    if (area(s, next) < body.length) next = -1;
  }
  if (next < 0) {
    let best = -1;
    const k = neighbours(s.g, body[0], s.nb);
    const cand = s.nb.slice(0, k);
    for (const d of cand) {
      if (blocked[d] && d !== tail) continue;
      const a = area(s, d) + Math.random() * 0.5;
      if (a > best) { best = a; next = d; }
    }
  }
  if (next < 0) {
    if (s.g.line && body.length > 1 && !turned) {
      body.reverse(); // on a string the snake turns around by swapping ends
      s.ghost = body[body.length - 1];
      return tick(s, params, true);
    }
    s.dying = 1.6;
    return;
  }
  const eats = next === s.food;
  body.unshift(next);
  if (eats) {
    s.ghost = body[body.length - 1];
  } else {
    s.ghost = body.pop();
    blocked[s.ghost] = 0;
  }
  blocked[next] = 1;
  const size = s.g.W * s.g.H;
  if (eats && (body.length > size * (s.g.line ? 0.4 : 0.55) || !placeFood(s))) s.dying = 1.6;
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const size = g.W * g.H;
  const s = {
    g,
    body: [],
    ghost: 0,
    food: 0,
    foodAge: 0,
    blocked: new Uint8Array(size),
    prev: new Int32Array(size),
    queue: new Int32Array(size),
    nb: [0, 0, 0, 0],
    px: new Float32Array(size + 2),
    py: new Float32Array(size + 2),
    acc: 0,
    dying: 0,
  };
  reset(s, ctx.params.start);
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.25);
  const step = 1 / params.speed;
  if (s.dying > 0) {
    s.dying -= dt;
    if (s.dying <= 0) reset(s, params.start);
  } else {
    s.acc += dt;
    while (s.acc >= step && s.dying <= 0) {
      s.acc -= step;
      tick(s, params);
    }
  }
  s.foodAge += dt;
  const p = s.dying > 0 ? 1 : clamp(s.acc / step);
  const { W, gx, gy } = s.g;
  const { body, px, py } = s;
  const L = body.length;
  // Polyline from the moving head through the body to the moving tail end.
  const cx = (c) => c % W, cy = (c) => (c / W) | 0;
  if (L > 1) {
    px[0] = lerp(cx(body[1]), cx(body[0]), p); py[0] = lerp(cy(body[1]), cy(body[0]), p);
  } else { px[0] = cx(body[0]); py[0] = cy(body[0]); }
  for (let k = 1; k < L; k++) { px[k] = cx(body[k]); py[k] = cy(body[k]); }
  px[L] = lerp(cx(s.ghost), cx(body[L - 1]), p); py[L] = lerp(cy(s.ghost), cy(body[L - 1]), p);

  const head = colors[0] || [0.7, 1, 0.35];
  const tailC = colors[1] || [0.1, 0.6, 0.4];
  const foodC = colors[2] || [1, 0.25, 0.4];
  const bg = colors[3] || [0, 0, 0];
  const fx = cx(s.food), fy = cy(s.food);
  const foodK = clamp(s.foodAge * 2) * (0.65 + 0.35 * Math.sin(s.foodAge * 5));
  const fade = s.dying > 0 ? clamp(s.dying / 1.6) * (0.6 + 0.4 * Math.cos(s.dying * 12)) : 1;
  const inv = 1 / params.width;
  for (let i = 0; i < n; i++) {
    const X = gx[i], Y = gy[i];
    let best = 1e9, arc = 0;
    for (let k = 0; k < L; k++) {
      const ax = px[k], ay = py[k], bx = px[k + 1] - ax, by = py[k + 1] - ay;
      const len2 = bx * bx + by * by;
      let u = len2 > 1e-6 ? ((X - ax) * bx + (Y - ay) * by) / len2 : 0;
      u = clamp(u);
      const dx = X - ax - bx * u, dy = Y - ay - by * u;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; arc = (k + u) / L; }
    }
    const kSnake = clamp(1 - Math.sqrt(best) * 1.1 * inv);
    const ks = kSnake * kSnake * (3 - 2 * kSnake) * fade * (1 - 0.5 * arc);
    const dfx = X - fx, dfy = Y - fy;
    const kf = clamp(1 - Math.sqrt(dfx * dfx + dfy * dfy) * 1.2) * foodK;
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      const sc = head[c] + (tailC[c] - head[c]) * arc;
      out[o + c] = Math.max(bg[c] + (sc - bg[c]) * ks, foodC[c] * kf * 0.9);
    }
  }
}
