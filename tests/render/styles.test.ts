import { describe, expect, it } from 'vitest';
import { FONT_FAMILIES } from '../../src/render/fonts';
import { applyTone } from '../../src/render/scene';
import { mapStyleFor, STYLE_IDS, STYLES } from '../../src/render/styles';
import stylesSource from '../../src/render/styles.ts?raw';
import type { InfoKey, StyleId } from '../../src/types';

/** Все адреса тайлов и TileJSON стиля. */
function tileUrls(id: StyleId): string[] {
  const out: string[] = [];
  for (const src of Object.values(STYLES[id].mapStyle.sources)) {
    if ('tiles' in src && src.tiles) out.push(...src.tiles);
    if ('url' in src && src.url) out.push(src.url);
  }
  return out;
}

/** Относительная яркость sRGB (WCAG) цвета `#rrggbb`. */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Paint слоя стиля по id. */
const paintOf = (id: StyleId, layerId: string): Record<string, unknown> => {
  const l = STYLES[id].mapStyle.layers.find((x) => x.id === layerId);
  if (!l) throw new Error(`нет слоя ${layerId} в ${id}`);
  return (l as { paint?: Record<string, unknown> }).paint ?? {};
};

describe('STYLES', () => {
  it('три стиля, у каждого id совпадает с ключом', () => {
    expect(STYLE_IDS).toEqual(['epic', 'neon', 'atlas']);
    for (const id of STYLE_IDS) expect(STYLES[id].id).toBe(id);
  });

  it('подложки только по https, без ключей и токенов в адресе', () => {
    for (const id of STYLE_IDS) {
      const urls = tileUrls(id);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u.startsWith('https://')).toBe(true);
        expect(u).not.toMatch(/[?&](key|token|apikey|access_token)=/i);
      }
    }
  });

  it('T25: «Экспедиция» и «Атлас» с DEM, «Неон» остаётся плоским', () => {
    const epic = STYLES.epic;
    expect(tileUrls('epic').some((u) => u.includes('World_Imagery'))).toBe(true);
    expect(tileUrls('epic').some((u) => u.includes('terrarium'))).toBe(true);
    expect(epic.terrain?.exaggeration).toBeGreaterThanOrEqual(1.6); // заметная глубина (V3)
    expect(epic.mapStyle.terrain?.exaggeration).toBe(epic.terrain?.exaggeration);
    expect(STYLES.atlas.mapStyle.terrain?.source).toBe('dem');
    for (const id of ['neon'] as const) {
      expect(STYLES[id].terrain).toBeUndefined();
      expect(STYLES[id].mapStyle.terrain).toBeUndefined();
    }
  });

  it('«Атлас» берёт отмывку из AWS Terrain (hillshade), Esri в нём больше нет (ADR 0008)', () => {
    const urls = tileUrls('atlas');
    expect(urls.some((u) => u.includes('elevation-tiles-prod/terrarium'))).toBe(true);
    expect(urls.some((u) => /arcgisonline|esri/i.test(u))).toBe(false);
    const src = STYLES.atlas.mapStyle.sources.relief;
    expect(src).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
    const relief = STYLES.atlas.mapStyle.layers.find((l) => l.id === 'relief');
    expect(relief?.type).toBe('hillshade');
  });

  it('атрибуция — точные формулировки источников (ADR 0008)', () => {
    expect(STYLES.neon.attribution).toBe('OpenFreeMap © OpenMapTiles Data from OpenStreetMap');
    expect(STYLES.atlas.attribution).toContain('OpenFreeMap © OpenMapTiles Data from OpenStreetMap');
    expect(STYLES.atlas.attribution).toContain('Terrain Tiles on AWS');
    expect(STYLES.atlas.attribution).not.toMatch(/Esri/);
    expect(STYLES.epic.attribution).toContain('Esri, Vantor, Earthstar Geographics, GIS User Community');
    expect(STYLES.epic.attribution).toContain('Terrain Tiles on AWS');
  });

  it('у каждого стиля свои палитра, шрифтовая иерархия и атрибуция; кадры различимы по цвету линии', () => {
    const lines = STYLE_IDS.map((id) => STYLES[id].palette.line);
    expect(new Set(lines).size).toBe(3);
    const titles = STYLE_IDS.map((id) => JSON.stringify(STYLES[id].type.title));
    expect(new Set(titles).size).toBe(3);
    for (const id of STYLE_IDS) {
      expect(STYLES[id].attribution.length).toBeGreaterThan(8);
      expect(STYLES[id].swatchCss).toContain('gradient');
    }
  });

  it('слои стиля ссылаются на существующие источники', () => {
    for (const id of STYLE_IDS) {
      const style = STYLES[id].mapStyle;
      for (const layer of style.layers) {
        if ('source' in layer && layer.source) expect(Object.keys(style.sources)).toContain(layer.source);
      }
      if (style.terrain) expect(Object.keys(style.sources)).toContain(style.terrain.source);
    }
  });

  it('mapStyleFor возвращает стиль выбранного id', () => {
    for (const id of STYLE_IDS) expect(mapStyleFor(id, 2)).toBe(STYLES[id].mapStyle);
  });
});

describe('профиль стиля: общие поля (истории 65, 70, 120)', () => {
  it('ID не изменены; названия и миниатюры', () => {
    expect(STYLE_IDS).toEqual(['epic', 'neon', 'atlas']);
    expect(STYLES.epic.nameRu).toBe('Экспедиция');
    expect(STYLES.epic.nameEn).toBe('Expedition');
    expect(STYLES.atlas.nameRu).toBe('Атлас');
    expect(STYLES.neon.nameRu).toBe('Неон');
    for (const id of STYLE_IDS) {
      expect(STYLES[id].nameEn.length).toBeGreaterThan(2);
      expect(STYLES[id].thumb).toBe(`./style-thumbs/${id}.webp`);
    }
  });

  it('шрифты — только Manrope / PT Serif / JetBrains Mono; Unbounded и Inter в styles.ts не встречаются', () => {
    const allowed = new Set<string>(Object.values(FONT_FAMILIES));
    for (const id of STYLE_IDS) {
      const t = STYLES[id].type;
      for (const role of [t.title, t.number, t.label, t.secondary, t.kicker]) expect(allowed.has(role.family)).toBe(true);
    }
    expect(stylesSource).not.toMatch(/Unbounded|\bInter\b/);
  });

  it('роли шрифтов по истории 65: названия и числа', () => {
    const { epic, atlas, neon } = STYLES;
    expect(epic.type.title).toMatchObject({ family: FONT_FAMILIES.manrope, min: 96, max: 112 });
    expect(epic.type.title.weight).toBeGreaterThanOrEqual(700);
    expect(epic.type.title.weight).toBeLessThanOrEqual(800);
    expect(atlas.type.title).toMatchObject({ family: FONT_FAMILIES.serif, weight: 700, min: 100, max: 120 });
    expect(neon.type.title).toMatchObject({ family: FONT_FAMILIES.manrope, weight: 700, min: 88, max: 104 });
    expect(neon.type.number).toMatchObject({ family: FONT_FAMILIES.mono, weight: 500 });
    for (const def of [epic, atlas]) expect(def.type.number.family).toBe(FONT_FAMILIES.manrope);
    expect(epic.type.title.tracking).toBeCloseTo(-0.025, 3);
    expect(atlas.type.title.tracking).toBeCloseTo(-0.015, 3);
  });

  it('размеры ролей во всех стилях: подписи 30–34, вторичное 28–32, числа 64–80', () => {
    for (const id of STYLE_IDS) {
      const t = STYLES[id].type;
      expect(t.label.size, id).toBeGreaterThanOrEqual(30);
      expect(t.label.size, id).toBeLessThanOrEqual(34);
      expect(t.secondary.size, id).toBeGreaterThanOrEqual(28);
      expect(t.secondary.size, id).toBeLessThanOrEqual(32);
      expect(t.number.size, id).toBeGreaterThanOrEqual(64);
      expect(t.number.size, id).toBeLessThanOrEqual(80);
      expect(t.title.min, id).toBeLessThanOrEqual(t.title.max);
      expect(t.kicker.tracking, id).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('состав по умолчанию: 2 главных показателя + страна, остальное выключено', () => {
    for (const id of STYLE_IDS) {
      const on = (Object.entries(STYLES[id].defaultInfo) as [InfoKey, boolean][]).filter(([, v]) => v).map(([k]) => k);
      expect(on, id).toContain('country');
      expect(on.filter((k) => k !== 'country').length, id).toBe(2);
    }
  });

  it('CSS-стеки fonts собраны из ролей и несут запасные семейства', () => {
    expect(STYLES.atlas.fonts.title.startsWith(`'${FONT_FAMILIES.serif}'`)).toBe(true);
    expect(STYLES.neon.fonts.numbers.startsWith(`'${FONT_FAMILIES.mono}'`)).toBe(true);
    expect(STYLES.epic.fonts.label.startsWith(`'${FONT_FAMILIES.manrope}'`)).toBe(true);
    for (const id of STYLE_IDS) for (const css of Object.values(STYLES[id].fonts)) expect(css).toContain(',');
  });
});

describe('«Экспедиция» (истории 71, 127)', () => {
  const e = STYLES.epic;
  const alpha = (css: string) => Number(css.match(/rgba?\([^)]*,\s*([\d.]+)\)$/)?.[1] ?? 1);
  const rgb = (css: string) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

  it('T25: высокий наклон 60–65°, коралловая линия V5, светлый сердечник', () => {
    expect(e.pitch).toBeGreaterThanOrEqual(60);
    expect(e.pitch).toBeLessThanOrEqual(65);
    expect(e.palette).toMatchObject({ text: '#F5F0E5', line: '#FF6654', secondary: '#BFC9BF' });
    expect(e.line.color).toBe('#FF6654');
    expect(luminance(e.line.core)).toBeGreaterThan(luminance(e.line.color));
  });

  it('спутник приглушён, но не чёрно-белый; тени и свет — в общем тоне: navy-тени, тёплые света, дымка и виньетка', () => {
    const paint = paintOf('epic', 'imagery');
    expect(paint['raster-saturation'] as number).toBeLessThan(0);
    expect(paint['raster-saturation'] as number).toBeGreaterThan(-0.6);
    expect(paint['raster-brightness-max'] as number).toBeLessThan(0.95);
    const hills = paintOf('epic', 'hills');
    // тёплый свет и navy-тени (синий канал тени выше красного, свет — наоборот)
    const shadow = hills['hillshade-shadow-color'] as string;
    const light = hills['hillshade-highlight-color'] as string;
    expect(Number.parseInt(shadow.slice(5, 7), 16)).toBeGreaterThan(Number.parseInt(shadow.slice(1, 3), 16));
    expect(rgb(light)[0]).toBeGreaterThan(rgb(light)[2]);
    // свет — полупрозрачный: сплошной бежевый свет сплошь закрывает спутник на ровном склоне («песок» в долинах triglav)
    expect(alpha(light)).toBeGreaterThan(0.15);
    expect(alpha(light)).toBeLessThanOrEqual(0.45);
    expect(luminance(shadow)).toBeLessThan(0.02);
    expect(hills['hillshade-exaggeration'] as number).toBeGreaterThanOrEqual(0.5);
    const lighten = e.tone.tints.find((t) => t.blend === 'lighten')!;
    expect(luminance(lighten.color)).toBeLessThan(0.02);
    expect(e.tone.tints.some((t) => t.blend === 'soft-light')).toBe(true);
    expect(e.tone.vignette.strength).toBeGreaterThan(0.2);
    expect(e.tone.haze).toBeDefined();
  });

  it('карта — только данные источников: фон, спутник и отмывка; ни иконок, ни символов, ни подписей', () => {
    expect(e.mapStyle.layers.map((l) => l.type).sort()).toEqual(['background', 'fill', 'hillshade', 'line', 'line', 'raster']);
    expect(e.mapStyle.layers.filter(l => l.type === 'line' || l.type === 'fill').every(l => l.source === 'ofm')).toBe(true);
    expect(e.mapStyle.sprite).toBeUndefined();
    expect(e.mapStyle.glyphs).toBeUndefined();
  });

  it('линия: тёмная обводка-подложка шире линии, одно сдержанное свечение, остаток тише пройденного, переезд — пунктир', () => {
    const L = e.line;
    expect(L.width).toBeGreaterThanOrEqual(5);
    expect(L.width).toBeLessThanOrEqual(7);
    expect(L.glow).toBeGreaterThan(0);
    expect(L.glow).toBeLessThanOrEqual(0.5);
    expect(Math.max(...rgb(L.casing.color))).toBeLessThan(40);
    expect(alpha(L.casing.color)).toBeGreaterThanOrEqual(0.6);
    expect(L.casing.scale).toBeGreaterThanOrEqual(1.9);
    // пройденное (непрозрачное) ярче остатка (полупрозрачный след на своей тёмной подложке)
    expect(alpha(L.ghost)).toBeLessThan(0.6);
    expect(alpha(L.ghost)).toBeGreaterThan(0.2);
    expect(alpha(L.ghostCasing)).toBeGreaterThan(0);
    // переезд — пунктир: оба звена штриха положительны
    expect(L.dash[0]).toBeGreaterThan(0);
    expect(L.dash[1]).toBeGreaterThan(0);
    expect(L.gap).not.toBe(L.color);
    // маркер: светлая точка с янтарным кольцом, не прожектор
    expect(luminance(e.marker.fill)).toBeGreaterThan(0.8);
    expect(e.marker.ring).toBe(e.palette.line);
    expect(e.marker.glow).toBe(0);
  });

  it('отмывка рельефа берёт DEM не крупнее z12: на z13–14 целые метры дают блочные «ступени» на склонах и песок в долинах', () => {
    const src = (e.mapStyle.sources as Record<string, { maxzoom?: number }>).demShade;
    expect(src.maxzoom).toBeLessThanOrEqual(12);
    expect(e.mapStyle.layers.find((l) => l.id === 'hills')).toMatchObject({ source: 'demShade' });
    // 3D-рельеф (terrain) остаётся на подробном DEM — геометрия гор не огрубляется
    expect((e.mapStyle.sources as Record<string, { maxzoom?: number }>).dem.maxzoom).toBe(14);
  });

  it('янтарь отделён от любого фона: обводка (с alpha, поверх фона) темнее песка, снега и воды, контраст янтаря с ней ≥ 4,5 : 1', () => {
    const [r, g, b] = rgb(e.line.casing.color);
    const k = alpha(e.line.casing.color);
    const hex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
    for (const bg of ['#D8C39A' /* песок */, '#F2F4F7' /* снег */, '#5F8AA6' /* вода */]) {
      const under = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
      // обводка полупрозрачна: на светлом фоне она светлее своего цвета — считаем то, что реально видно
      const seen = hex([r * k + under[0] * (1 - k), g * k + under[1] * (1 - k), b * k + under[2] * (1 - k)]);
      expect(luminance(seen), `обводка на ${bg}`).toBeLessThan(luminance(bg));
      expect(contrast(e.line.color, seen), `янтарь на обводке поверх ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('«Атлас» (история 72)', () => {
  const a = STYLES.atlas;
  it('подложка — векторные слои в палитре листа', () => {
    expect(paintOf('atlas', 'bg')['background-color']).toBe('#F4F0E6');
    expect(paintOf('atlas', 'water')['fill-color']).toBe('#D8E5E1');
    expect(paintOf('atlas', 'landcover')['fill-color']).toBe('#ECE7D8');
    expect(paintOf('atlas', 'border-country')['line-color']).toBe('#B7BDAF');
    expect(a.mapStyle.layers.filter((l) => l.type === 'raster')).toEqual([]);
  });

  it('отмывка hillshade едва заметна: слабый рельеф без жёсткого контраста', () => {
    const p = paintOf('atlas', 'relief');
    expect(p['hillshade-exaggeration'] as number).toBeLessThanOrEqual(0.4);
    expect(contrast(p['hillshade-shadow-color'] as string, '#F4F0E6')).toBeLessThan(3.5);
  });

  it('дороги заметно тише трека: по контрасту с листом', () => {
    const sheet = '#F4F0E6';
    const roads = ['road-minor', 'road-major'].map((id) => paintOf('atlas', id)['line-color'] as string);
    const lineContrast = contrast(a.line.color, sheet);
    expect(lineContrast).toBeGreaterThan(3.5);
    for (const r of roads) expect(contrast(r, sheet)).toBeLessThan(lineContrast / 2.5);
  });

  it('линия контрастнее (V3): от 6 дпикс и тёмная терракота ≥ 4,5 : 1 на листе, суше и воде, без свечения', () => {
    expect(a.line.width).toBeGreaterThanOrEqual(6);
    expect(a.line.width).toBeLessThanOrEqual(8);
    expect(a.line.color).toBe(a.palette.line);
    for (const bg of ['#F4F0E6' /* лист */, '#ECE7D8' /* суша */, '#D8E5E1' /* вода */]) {
      expect(contrast(a.line.color, bg), bg).toBeGreaterThanOrEqual(4.5);
    }
    expect(a.line.casing.scale).toBeGreaterThanOrEqual(1.7);
    expect(a.line.glow).toBe(0);
    expect(a.palette).toMatchObject({ text: '#243B35', secondary: '#6F8174' });
  });

  it('T25: наклонный Atlas с DEM, светлая бумажная палитра сохранена', () => {
    expect(a.pitch).toBe(52);
    expect(a.tone.tints).toEqual([]);
    expect(a.tone.vignette.strength).toBe(0);
    expect(a.tone.grain).toBe(0);
  });

  it('название — PT Serif 700; текст появляется fade со сдвигом 8–12 дпикс', () => {
    expect(a.type.title).toMatchObject({ family: FONT_FAMILIES.serif, weight: 700 });
    expect(a.motion.appear).toBe('fade-rise');
    expect(a.motion.rise).toBeGreaterThanOrEqual(8);
    expect(a.motion.rise).toBeLessThanOrEqual(12);
  });
});

describe('«Неон» (история 74)', () => {
  const n = STYLES.neon;
  it('палитра: фон, суша, вода, линия, акцент, текст', () => {
    expect(paintOf('neon', 'bg')['background-color']).toBe('#0C1420');
    expect(paintOf('neon', 'landcover')['fill-color']).toBe('#142235');
    expect(paintOf('neon', 'water')['fill-color']).toBe('#08101A');
    expect(n.palette).toMatchObject({ line: '#67D9DB', accent: '#D99DB8', text: '#EAF4F3' });
  });

  it('T25: умеренный наклон 36°, одна линия с узким свечением', () => {
    expect(n.pitch).toBe(36);
    expect(n.line.glow).toBeGreaterThan(0);
    expect(n.line.color).toBe('#67D9DB');
  });
});

describe('самостоятельность стилей (история 73)', () => {
  it('каждая пара различается по карте, палитре, шрифтам, линии, маркеру, движению и наклону', () => {
    const dims: Record<string, (id: StyleId) => string> = {
      map: (id) => JSON.stringify(STYLES[id].mapStyle.layers.map((l) => l.id)) + JSON.stringify(Object.keys(STYLES[id].mapStyle.sources)),
      palette: (id) => JSON.stringify(STYLES[id].palette),
      type: (id) => JSON.stringify(STYLES[id].type),
      line: (id) => JSON.stringify(STYLES[id].line),
      marker: (id) => JSON.stringify(STYLES[id].marker),
      motion: (id) => JSON.stringify(STYLES[id].motion),
      pitch: (id) => String(STYLES[id].pitch),
    };
    const pairs: [StyleId, StyleId][] = [['epic', 'atlas'], ['epic', 'neon'], ['neon', 'atlas']];
    for (const [x, y] of pairs) {
      for (const [name, get] of Object.entries(dims)) expect(get(x), `${x}/${y}: ${name}`).not.toBe(get(y));
    }
  });
});

describe('applyTone: общий тон задаётся профилем стиля', () => {
  /** Холст-«магнитофон»: пишет заливки с режимом наложения. */
  function recorder() {
    const fills: string[] = [];
    const state: Record<string, unknown> = { globalCompositeOperation: 'source-over' };
    const stack: unknown[] = [];
    const ctx = new Proxy({}, {
      get(_t, prop: string) {
        if (prop in state) return state[prop];
        if (prop === 'save') return () => { stack.push(state.globalCompositeOperation); };
        if (prop === 'restore') return () => { state.globalCompositeOperation = stack.pop(); };
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
        if (prop === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
        if (prop === 'createPattern') return () => null;
        if (prop === 'fillRect') return () => { fills.push(String(state.globalCompositeOperation)); };
        return () => undefined;
      },
      set(_t, prop: string, v) { state[prop] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, fills };
  }

  it('«Атлас»: ни одной заливки поверх подложки', () => {
    const r = recorder();
    applyTone(r.ctx, STYLES.atlas, 540, 960);
    expect(r.fills).toEqual([]);
  });

  it('«Экспедиция»: оттенки подложки (приглушить, navy-тени, тёплые света), дымка у горизонта и виньетка', () => {
    const r = recorder();
    applyTone(r.ctx, STYLES.epic, 540, 960, 1);
    expect(r.fills).toEqual(['multiply', 'lighten', 'soft-light', 'source-over', 'source-over']);
  });

  it('дымка растёт с наклоном: на общем плане (pitch 0) её нет, виньетка остаётся', () => {
    const flat = recorder();
    applyTone(flat.ctx, STYLES.epic, 540, 960, 0);
    expect(flat.fills).toEqual(['multiply', 'lighten', 'soft-light', 'source-over']);
    const tilted = recorder();
    applyTone(tilted.ctx, STYLES.epic, 540, 960, 0.5);
    expect(tilted.fills.length).toBe(5);
  });
});
