/** Холст-«магнитофон»: пишет вызовы рисования и тексты; measureText — условная ширина. */
export function recorder() {
  const ops: string[] = [];
  const texts: string[] = [];
  const fonts = new Set<string>();
  const shadows = new Set<string>();
  /** Тексты с учётом сдвигов translate (масштабов в тексте нет): итоговое положение на кадре. */
  const placed: { text: string; x: number; y: number }[] = [];
  const textRects: { text: string; x: number; y: number; w: number; h: number }[] = [];
  const fills: { x: number; y: number; w: number; h: number; alpha: number }[] = [];
  const strokes: { segments: { from: [number, number]; to: [number, number] }[]; color: string }[] = [];
  const stack: { tx: number; ty: number; sx: number; sy: number; state: Record<string, unknown> }[] = [];
  let path: [number, number][] = [];
  let segments: { from: [number, number]; to: [number, number] }[] = [];
  let pen: [number, number] = [0, 0];
  let tx = 0, ty = 0;
  let sx = 1, sy = 1;
  const point = (x: number, y: number): [number, number] => [x * sx + tx, y * sy + ty];
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1 };
  const grad = { addColorStop: () => undefined };
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'measureText':
          return (s: string) => ({ width: s.length * Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? '10') * 0.55 });
        case 'createLinearGradient':
        case 'createRadialGradient':
          return () => grad;
        case 'createPattern':
          return () => null;
        case 'getTransform':
          return () => ({ a: sx, b: 0, c: 0, d: sy, e: tx, f: ty });
        case 'save':
          return () => { stack.push({ tx, ty, sx, sy, state: { ...state } }); ops.push('save:'); };
        case 'restore':
          return () => { const saved = stack.pop(); if (saved) { tx = saved.tx; ty = saved.ty; sx = saved.sx; sy = saved.sy; for (const key of Object.keys(state)) delete state[key]; Object.assign(state, saved.state); } ops.push('restore:'); };
        case 'translate':
          return (dx: number, dy: number) => { tx += dx * sx; ty += dy * sy; ops.push(`translate:${Math.round(dx)},${Math.round(dy)}`); };
        case 'scale':
          return (dx: number, dy: number) => { sx *= dx; sy *= dy; ops.push(`scale:${dx},${dy}`); };
        case 'beginPath':
          return () => { path = []; segments = []; ops.push('beginPath:'); };
        case 'moveTo':
        case 'lineTo':
          return (x: number, y: number) => { const p = point(x, y); if (prop === 'lineTo') segments.push({ from: pen, to: p }); pen = p; path.push(p); ops.push(prop + ':' + Math.round(x) + ',' + Math.round(y)); };
        case 'stroke':
          return () => { strokes.push({ segments: [...segments], color: String(state.strokeStyle) }); ops.push('stroke:'); };
        case 'arcTo':
          return (x1: number, y1: number, x2: number, y2: number, r: number) => { path.push([x1 + tx, y1 + ty], [x2 + tx, y2 + ty]); ops.push('arcTo:' + [x1, y1, x2, y2, r].map(Math.round).join(',')); };
        case 'arc':
          return (x: number, y: number, r: number, start: number, end: number, anticlockwise = false) => {
            const tau = Math.PI * 2, delta = anticlockwise ? start - end : end - start;
            const sweep = Math.abs(end - start) >= tau ? tau : (delta % tau + tau) % tau;
            for (const angle of [start, end, 0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
              const distance = ((anticlockwise ? start - angle : angle - start) % tau + tau) % tau;
              if (angle === start || angle === end || distance <= sweep) path.push(point(x + r * Math.cos(angle), y + r * Math.sin(angle)));
            }
            ops.push('arc:' + [x, y, r, start, end, ...(anticlockwise ? [1] : [])].map(Math.round).join(','));
          };
        case 'fill':
          return () => { if (path.length) {
            const xs = path.map(([x]) => x), ys = path.map(([, y]) => y);
            fills.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), alpha: Number(state.globalAlpha) });
          } ops.push('fill:'); };
        case 'fillText':
        case 'strokeText':
          return (s: string, x: number, y: number) => { const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? '10');
            const w = s.length * size * 0.55;
            const dx = state.textAlign === 'right' || state.textAlign === 'end' ? -w : state.textAlign === 'center' ? -w / 2 : 0;
            const dy = state.textBaseline === 'middle' ? -size / 2 : state.textBaseline === 'top' ? 0 : -size * 0.8;
            textRects.push({ text: s, x: x + tx + dx, y: y + ty + dy, w, h: size });
            placed.push({ text: s, x: x + tx, y: y + ty }); texts.push(s); ops.push(`${prop}:${s}@${Math.round(x)},${Math.round(y)}`); };
        default:
          return (...args: unknown[]) => { ops.push(`${prop}:${args.map((a) => (typeof a === 'number' ? Math.round(a) : typeof a)).join(',')}`); };
      }
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      if (prop === 'font') fonts.add(String(value));
      if (prop === 'shadowColor' && value !== 'transparent') shadows.add(String(value));
      return true;
    },
    has: () => true,
  };
  const ctx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, texts, fonts, shadows, placed, textRects, fills, strokes };
}

