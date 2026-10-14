// Темп путешествия: «время → дробный индекс головы». Считается заранее, headAt(τ) — O(log n).
//
// База — «стоимость» пути в метрах: свой ход идёт как есть, переезд — в TRANSFER_FACTOR раз дешевле
// (и не дороже TRANSFER_CAP_SHARE своего хода), поэтому проходится быстро. Темп всегда по расстоянию:
// по времени «голова» стояла бы ночами на стоянках.
// Притормаживание на битах — добавка времени δ_k, размазанная гладкой ступенькой G вокруг бита:
//   τ(u) = a·u + Σ δ_k·(G((u − u_k)/w) − G(−u_k/w)),   u ∈ [0..1] — доля стоимости пути.
// dτ/du > 0 всегда, значит «голова» не пятится; в точке бита скорость падает в несколько раз.
import type { Route } from '../types';

const TRANSFER_FACTOR = 0.25;
const TRANSFER_CAP_SHARE = 0.05;
/** Полуширина зоны торможения — столько секунд крейсерского хода. */
const SLOW_HALF_WIDTH_SEC = 0.45;
/** Дотормаживание не съедает больше этой доли времени движения. */
const MAX_DWELL_SHARE = 0.4;
const TABLE_HZ = 120;
/** Сглаживание скорости «головы» во времени — разгон на входе в переезд и выходе из него. */
const VELOCITY_SIGMA_SEC = 0.3;
/** Разгон с места в начале движения и остановка на финише. */
const EDGE_RAMP_SEC = 0.6;

export interface Dwell { idx: number; sec: number }

export interface PacePlan {
  /** Сколько секунд «голова» едет от первой точки до последней. */
  moveSec: number;
  /** Крейсерская скорость в «метрах стоимости» в секунду (для вырожденного трека — индексов). */
  cruiseMps: number;
  /** Дробный индекс головы через τ секунд после начала движения (τ зажимается в [0, moveSec]). */
  headAt(tau: number): number;
  /** Когда (с начала движения) голова проходит индекс idx. */
  timeOfIdx(idx: number): number;
}

/** Гладкая ступенька 0→1 на x ∈ [−1, 1] (smootherstep). */
function step(x: number): number {
  const s = Math.max(0, Math.min(1, (x + 1) / 2));
  return s * s * s * (s * (s * 6 - 15) + 10);
}

/**
 * Настройки стоимости переезда: factor — во сколько раз он «дешевле» своего хода (по умолчанию 0,25), capShare — потолок
 * стоимости одного переезда как доля своего хода (по умолчанию 5%). Маршрут по меткам берёт мягче: скачки между метками
 * длиннее трека, и камера на скорости ×4 не успевает за головой.
 */
export interface TransferCost { factor?: number; capShare?: number }

/** Накопленная «стоимость» пути по индексам, нормированная в [0..1]. */
export function costShares(route: Route, transfer: TransferCost = {}): { u: Float64Array; totalCost: number } {
  const pts = route.points;
  const n = pts.length;
  const own = route.ownM > 0 ? route.ownM : route.totalM;
  const factor = transfer.factor ?? TRANSFER_FACTOR;
  const cap = (transfer.capShare ?? TRANSFER_CAP_SHARE) * own;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const len = Math.max(0, pts[i].d - pts[i - 1].d);
    cum[i] = cum[i - 1] + (pts[i].transferBefore && own > 0 ? Math.min(len * factor, cap) : len);
  }
  let total = cum[n - 1];
  if (!(total > 0)) { // все точки в одном месте — идём по индексам
    for (let i = 0; i < n; i++) cum[i] = i;
    total = Math.max(1, n - 1);
  }
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) u[i] = cum[i] / total;
  u[n - 1] = 1;
  return { u, totalCost: total };
}

export function planPace(route: Route, moveSec: number, dwells: Dwell[], transfer?: TransferCost): PacePlan {
  const { u, totalCost } = costShares(route, transfer);
  const n = u.length;
  const T = Math.max(0.001, moveSec);

  const bumps = dwells
    .filter((d) => d.sec > 0 && d.idx >= 0 && d.idx < n)
    .map((d) => ({ u: u[d.idx], sec: d.sec }));

  // a (крейсерское время на весь путь) и ширина зоны w зависят друг от друга — две итерации хватает
  let w = 0.02;
  let a = T;
  let scale = 1;
  for (let iter = 0; iter < 3; iter++) {
    let eff = 0;
    for (const b of bumps) eff += b.sec * (step((1 - b.u) / w) - step(-b.u / w));
    scale = eff > MAX_DWELL_SHARE * T ? (MAX_DWELL_SHARE * T) / eff : 1;
    a = T - eff * scale;
    w = Math.max(0.002, Math.min(0.08, SLOW_HALF_WIDTH_SEC / a));
  }
  const active = bumps.map((b) => ({ u: b.u, sec: b.sec * scale, off: b.sec * scale * step(-b.u / w) }));

  const tauOf = (x: number): number => {
    let tau = a * x;
    for (const b of active) {
      const z = (x - b.u) / w;
      tau += b.sec * (z >= 1 ? 1 : z <= -1 ? 0 : step(z)) - b.off;
    }
    return tau;
  };
  // нормировка на точное T (после масштабирования остаётся погрешность границ)
  const tauEnd = tauOf(1);
  const k = tauEnd > 0 ? T / tauEnd : 1;

  // таблица u(τ) с шагом 1/TABLE_HZ: монотонная бисекция
  const K = Math.max(2, Math.ceil(T * TABLE_HZ) + 1);
  const table = new Float64Array(K);
  let lo = 0;
  for (let j = 0; j < K; j++) {
    const target = (j / (K - 1)) * T;
    let l = lo, h = 1;
    for (let it = 0; it < 32; it++) {
      const m = (l + h) / 2;
      if (tauOf(m) * k < target) l = m; else h = m;
    }
    table[j] = j === K - 1 ? 1 : Math.max(lo, h);
    lo = table[j];
  }
  table[0] = 0;

  // реальная доля пути q (по метрам; для вырожденного трека — по стоимости): по ней считается скорость на экране
  const q = new Float64Array(n);
  const totalM = route.points[n - 1].d;
  for (let i = 0; i < n; i++) q[i] = totalM > 0 ? route.points[i].d / totalM : u[i];
  q[n - 1] = 1;

  /** Последний i с arr[i] ≤ x и доля к i+1 → дробный индекс. */
  const fracIndex = (arr: Float64Array, x: number): number => {
    const m = arr.length - 1;
    if (x <= arr[0]) return 0;
    if (x >= arr[m]) return m;
    let l = 0, h = m;
    while (h - l > 1) {
      const mid = (l + h) >> 1;
      if (arr[mid] <= x) l = mid; else h = mid;
    }
    const span = arr[h] - arr[l];
    return span > 0 ? l + Math.min(1, (x - arr[l]) / span) : l;
  };
  const valueAt = (arr: Float64Array, idx: number): number => {
    const i = Math.min(arr.length - 1, Math.floor(idx));
    const j = Math.min(arr.length - 1, i + 1);
    return arr[i] + (arr[j] - arr[i]) * (idx - i);
  };

  // скорость по q из таблицы u(τ): на переездах она скачет ×4 — сглаживаем её во времени (гаусс),
  // у концов плавно гасим до нуля и перенормируем; позиция остаётся точно на маршруте, разгоны мягкие
  const vel = new Float64Array(K - 1);
  let prevQ = 0;
  for (let j = 1; j < K; j++) {
    const qj = valueAt(q, fracIndex(u, table[j]));
    vel[j - 1] = Math.max(0, qj - prevQ);
    prevQ = Math.max(prevQ, qj);
  }
  const sigma = VELOCITY_SIGMA_SEC * TABLE_HZ;
  const half = Math.ceil(3 * sigma);
  const kernel = new Float64Array(2 * half + 1);
  for (let o = -half; o <= half; o++) kernel[o + half] = Math.exp(-0.5 * (o / sigma) ** 2);
  const ramp = Math.min(EDGE_RAMP_SEC, T / 4) * TABLE_HZ;
  const sv = new Float64Array(K - 1);
  let sum = 0;
  for (let j = 0; j < K - 1; j++) {
    let acc = 0, ws = 0;
    for (let o = Math.max(-half, -j); o <= Math.min(half, K - 2 - j); o++) {
      acc += vel[j + o] * kernel[o + half]; ws += kernel[o + half];
    }
    const edge = Math.min(j + 0.5, K - 1.5 - j) / ramp;
    sv[j] = (ws > 0 ? acc / ws : 0) * step(2 * Math.min(1, edge) - 1);
    sum += sv[j];
  }
  const qt = new Float64Array(K); // доля пути q в момент j / TABLE_HZ
  for (let j = 1; j < K; j++) qt[j] = sum > 0 ? qt[j - 1] + sv[j - 1] / sum : j / (K - 1);
  qt[K - 1] = 1;

  return {
    moveSec: T,
    cruiseMps: totalCost / (a * k),
    headAt(tau: number): number {
      if (!(tau > 0)) return 0;
      if (tau >= T) return n - 1;
      const p = (tau / T) * (K - 1);
      const j = Math.floor(p);
      const x = qt[j] + (qt[Math.min(K - 1, j + 1)] - qt[j]) * (p - j);
      return fracIndex(q, x);
    },
    timeOfIdx(idx: number): number {
      const i = Math.max(0, Math.min(n - 1, Math.round(idx)));
      return Math.max(0, Math.min(T, (fracIndex(qt, q[i]) / (K - 1)) * T));
    },
  };
}
