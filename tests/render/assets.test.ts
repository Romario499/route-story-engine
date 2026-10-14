import { describe, expect, it } from 'vitest';
import { flagsNeeded, getFlag, loadFlag, preloadOverlayAssets } from '../../src/render/assets';
import { enrichmentFor, eastLine, ok, track } from '../story/fixtures';
import { buildRoute } from '../../src/route';

describe('флаги', () => {
  it('в среде без Image флаг не грузится, но и не падает', async () => {
    expect(await loadFlag('GE')).toBeNull();
    expect(getFlag('GE')).toBeNull();
  });

  it('нужные флаги — посещённые страны без повторов, в нижнем регистре', () => {
    const route = ok(buildRoute([track('a.gpx', [eastLine(50)])]));
    const e = enrichmentFor(route);
    const iso = flagsNeeded(e);
    expect(iso).toEqual(expect.arrayContaining(['ge', 'am']));
    expect(new Set(iso).size).toBe(iso.length);
    expect(flagsNeeded(null)).toEqual([]);
  });

  it('preloadOverlayAssets без обогащения завершается сразу', async () => {
    await expect(preloadOverlayAssets(null)).resolves.toBeUndefined();
  });
});
