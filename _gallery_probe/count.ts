import { Baker } from '../src/city/bake';
import { buildHeavenGallery, heavenGalleryStats } from '../src/sky/heavenGallery';

const D = Math.PI / 180;

const CASES = [
  { name: 'probe(r=120,200deg)', r: 120, a0: 0, a1: 200 * D },
  { name: 'old-arc(r=660,23deg)', r: 660, a0: Math.PI / 2 - 11.5 * D, a1: Math.PI / 2 + 11.5 * D },
  { name: 'x2(r=660,46deg)', r: 660, a0: Math.PI / 2 - 23 * D, a1: Math.PI / 2 + 23 * D },
  { name: 'half(r=660,180deg)', r: 660, a0: 0, a1: Math.PI },
  { name: 'half(r=150,180deg)', r: 150, a0: 0, a1: Math.PI },
];

for (const c of CASES) {
  for (const forced of [false, true]) {
    const b = new Baker();
    buildHeavenGallery(b, {
      cx: 0, cz: 0, y: 0, r: c.r, a0: c.a0, a1: c.a1, width: 12, eaveH: 14,
      ...(forced ? { maxTris: 1e9 } : {}),
    });
    const s = b.stats();
    let tri = 0;
    for (const v of Object.values(s.groups)) tri += v.triangles;
    const tag = forced ? 'forced' : 'budget';
    console.log(
      `${c.name.padEnd(22)} ${tag.padEnd(6)} tier=${heavenGalleryStats.tier} bays=${heavenGalleryStats.bays} ` +
      `cols=${heavenGalleryStats.columns} dg=${heavenGalleryStats.dougong} ribs=${heavenGalleryStats.tileRibs} ` +
      `lamps=${heavenGalleryStats.lanterns} posts=${heavenGalleryStats.railPosts} bricks=${heavenGalleryStats.goldBricks} ` +
      `tri=${Math.round(tri)} over=${heavenGalleryStats.overBudget}`,
    );
  }
}
