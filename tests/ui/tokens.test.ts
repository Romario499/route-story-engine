import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import indexHtml from '../../index.html?raw';
import appTs from '../../src/ui/app.ts?raw';
import stepRouteTs from '../../src/ui/step-route.ts?raw';
import stepStyleTs from '../../src/ui/step-style.ts?raw';
import stepPreviewTs from '../../src/ui/step-preview.ts?raw';

// .css?raw в Vitest отдаёт пустую строку — читаем файл напрямую (типы node:fs — tests/e2e/node-shims.d.ts)
const css = new TextDecoder().decode(readFileSync(fileURLToPath(new URL('../../src/styles.css', import.meta.url))));
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

function token(name: string): string {
  const m = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6}|var\(--([a-z0-9-]+)\))`).exec(root);
  if (!m) throw new Error(`нет токена --${name}`);
  return m[2] ? token(m[2]) : m[1].toUpperCase();
}

const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('токены студии V3 (история 126)', () => {
  it('значения — из брифа V3 §1', () => {
    const expected: Record<string, string> = {
      'studio-bg': '#080F1A', 'studio-panel': '#101B2B', 'studio-raised': '#172638', 'studio-stroke': '#28394A',
      'studio-text': '#F4F7FA', 'studio-muted': '#A8BACB', 'route-gold': '#FFBC4D', 'accent-cyan': '#70CFE6',
    };
    for (const [name, value] of Object.entries(expected)) expect(token(name)).toBe(value);
  });

  it('рабочие имена токенов ссылаются на токены V3', () => {
    const alias: Record<string, string> = {
      bg: 'studio-bg', panel: 'studio-panel', raised: 'studio-raised', line: 'studio-stroke',
      text: 'studio-text', 'text-2': 'studio-muted', action: 'route-gold', info: 'accent-cyan',
    };
    for (const [name, target] of Object.entries(alias)) expect(root).toMatch(new RegExp(String.raw`--${name}:\s*var\(--${target}\)`));
  });

  it('контраст обычного текста ≥ 4,5:1, вторичного и границ интерактива ≥ 3:1', () => {
    const pairs: [string, string][] = [];
    for (const s of ['bg', 'panel', 'raised']) for (const fg of ['text', 'text-2', 'info', 'warn', 'error', 'action']) pairs.push([fg, s]);
    pairs.push(['action-ink', 'action']); // текст на основной кнопке
    const failed = pairs
      .map(([fg, bg]) => ({ fg, bg, ratio: contrast(token(fg), token(bg)) }))
      .filter((p) => p.ratio < 4.5);
    expect(failed).toEqual([]);
    // вторичный текст — не слабее 3:1 даже на самой светлой поверхности; рамка выбранного (action) — на любой
    expect(contrast(token('text-2'), token('raised'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('action'), token('raised'))).toBeGreaterThanOrEqual(3);
  });

  it('нет фоновых свечений, градиентов карточек и старых шрифтов в UI', () => {
    expect(css).not.toMatch(/radial-gradient/);
    expect(css).not.toMatch(/linear-gradient/);
    expect(css).not.toMatch(/box-shadow:[^;]*rgba/);
    expect(css).not.toMatch(/Unbounded|'Inter'/);
    expect(css).toMatch(/--font-ui:\s*'Manrope'/);
    expect(css).toMatch(/--font-mono:\s*'JetBrains Mono'/);
  });

  it('есть :focus-visible и prefers-reduced-motion', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('переходы 120–180 мс', () => {
    const m = /--t:\s*(\d+)ms/.exec(root);
    expect(m).not.toBeNull();
    const ms = Number(m![1]);
    expect(ms).toBeGreaterThanOrEqual(120);
    expect(ms).toBeLessThanOrEqual(180);
  });
});

describe('продукт не ссылается на Autopilot (история 110)', () => {
  it('ни UI, ни страница, ни стили', () => {
    for (const src of [indexHtml, css, appTs, stepRouteTs, stepStyleTs, stepPreviewTs]) {
      expect(src.toLowerCase()).not.toContain('autopilot');
    }
  });
});
