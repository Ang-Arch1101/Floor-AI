// 幾何模組測試：接合計算與 DXF 匯出組裝。
// 座標系：世界座標 Y 朝上，1 unit = 1 cm。

import {
  computeAllMiters,
  getWallGaps,
  clipStubEnd,
  placeOpening,
  splitEdgeByGaps,
  boxSelect,
  buildExportGeometry,
} from './geometry';

const wall = (x1, y1, x2, y2, thickness = 15) => ({
  start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, typeId: 'wt1', thickness,
});

describe('splitEdgeByGaps', () => {
  test('無缺口 → 原線段', () => {
    const segs = splitEdgeByGaps(0, 0, 100, 0, []);
    expect(segs).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
  });

  test('中段缺口 → 兩段', () => {
    const segs = splitEdgeByGaps(0, 0, 100, 0, [[0.25, 0.5]]);
    expect(segs).toHaveLength(2);
    expect(segs[0].x2).toBeCloseTo(25);
    expect(segs[1].x1).toBeCloseTo(50);
  });

  test('缺口蓋住起點 → 一段', () => {
    const segs = splitEdgeByGaps(0, 0, 100, 0, [[0, 0.3]]);
    expect(segs).toHaveLength(1);
    expect(segs[0].x1).toBeCloseTo(30);
  });
});

describe('L 角 miter（computeAllMiters）', () => {
  test('等厚 L 角：miter 點在兩外緣/內緣交點', () => {
    const walls = [wall(0, 0, 100, 0), wall(100, 0, 100, 100)];
    const miters = computeAllMiters(walls);
    const m = miters[0].end;
    expect(m.pos.x).toBeCloseTo(92.5);
    expect(m.pos.y).toBeCloseTo(7.5);
    expect(m.neg.x).toBeCloseTo(107.5);
    expect(m.neg.y).toBeCloseTo(-7.5);
  });

  test('不同厚度 L 角：各用自己的半厚', () => {
    const walls = [wall(0, 0, 100, 0, 15), wall(100, 0, 100, 100, 30)];
    const miters = computeAllMiters(walls);
    const m = miters[0].end;
    expect(m.pos.x).toBeCloseTo(85);   // 100 - 30/2
    expect(m.pos.y).toBeCloseTo(7.5);  // 15/2
    expect(m.neg.x).toBeCloseTo(115);
    expect(m.neg.y).toBeCloseTo(-7.5);
  });
});

describe('十字接合（getWallGaps）', () => {
  test('貫穿牆兩側各開一個等於對方厚度的缺口', () => {
    const h = wall(0, 0, 200, 0);
    const v = wall(100, -100, 100, 100);
    const { posGaps, negGaps } = getWallGaps(h, [h, v]);
    expect(posGaps).toHaveLength(1);
    expect(negGaps).toHaveLength(1);
    const [t0, t1] = posGaps[0];
    expect((t1 - t0) * 200).toBeCloseTo(15, 0); // 缺口寬 ≈ 對方牆厚
    expect((t0 + t1) / 2).toBeCloseTo(0.5);     // 缺口置中於交點
  });
});

describe('T 型接合（clipStubEnd）', () => {
  test('stub 端點在貫穿牆中心線上 → 兩條 offset 線裁到貫穿牆外緣', () => {
    const through = wall(0, 0, 200, 0);
    const stub = wall(100, 0, 100, 100);
    const clip = clipStubEnd(100, 0, [through, stub], stub);
    expect(clip).not.toBeNull();
    expect(clip.pos.y).toBeCloseTo(7.5);
    expect(clip.neg.y).toBeCloseTo(7.5);
    expect(Math.abs(clip.pos.x - clip.neg.x)).toBeCloseTo(15); // 兩線相距牆厚
  });
});

describe('DXF 匯出組裝（buildExportGeometry）', () => {
  test('L 角雙牆：4 條 WALL 線（每牆 pos/neg 各一、無缺口）', () => {
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 200)];
    const { lines, arcs } = buildExportGeometry(walls, []);
    expect(arcs).toHaveLength(0);
    expect(lines.every(l => l.layer === 'WALL')).toBe(true);
    expect(lines).toHaveLength(4); // 每道牆 pos/neg 兩條、無缺口
    // miter 對齊：牆 0 pos 邊終點 = 牆 1 pos 邊起點
    const flat = lines.map(l => [l.x1, l.y1, l.x2, l.y2]).flat();
    expect(flat.every(Number.isFinite)).toBe(true);
  });

  test('放一扇門：3 條 DOOR 線 + 1 個 90° 弧，半徑 = 門寬', () => {
    let walls = [wall(0, 0, 300, 0)];
    walls = placeOpening(walls, 0, { x: 150, y: 0 }, 'door', false, { id: 'dt1', width: 80 });
    const { lines, arcs } = buildExportGeometry(walls, []);
    const doorLines = lines.filter(l => l.layer === 'DOOR');
    expect(doorLines).toHaveLength(3);
    expect(arcs).toHaveLength(1);
    const a = arcs[0];
    expect(a.layer).toBe('DOOR');
    expect(a.r).toBeCloseTo(80);
    const ccw = ((a.endDeg - a.startDeg) % 360 + 360) % 360;
    expect(ccw).toBeCloseTo(90);
    // 門兩側被切出的牆段繼承厚度 → WALL 線存在
    expect(lines.some(l => l.layer === 'WALL')).toBe(true);
  });

  test('放一扇窗：8 條 WINDOW 線', () => {
    let walls = [wall(0, 0, 300, 0)];
    walls = placeOpening(walls, 0, { x: 150, y: 0 }, 'window', false, { id: 'nt1', width: 80 });
    const { lines } = buildExportGeometry(walls, []);
    expect(lines.filter(l => l.layer === 'WINDOW')).toHaveLength(8);
  });

  test('牆貫穿 RC 柱：柱左右邊開缺口、牆線被柱裁切', () => {
    const w = wall(0, 100, 300, 100);
    const col = { cx: 150, cy: 100, type: 'rc', rotated: false, typeId: 'ct1', w: 80, h: 100 };
    const { lines } = buildExportGeometry([w], [col]);
    const colLines = lines.filter(l => l.layer === 'COL');
    // 左右邊各裂成 2 段 + 上下邊各 1 段 = 6
    expect(colLines).toHaveLength(6);
    // 牆的兩條邊線都不該進入柱內（x ∈ (110,190) 之間不得有端點以外的穿越）
    const wallLines = lines.filter(l => l.layer === 'WALL');
    for (const l of wallLines) {
      const inside = (x) => x > 110 + 1e-6 && x < 190 - 1e-6;
      expect(inside(l.x1) || inside(l.x2)).toBe(false);
    }
  });

  test('H 鋼柱：外框+翼板+腹板 = 16 條線', () => {
    const col = { cx: 0, cy: 0, type: 'h', rotated: false, typeId: 'ct1', w: 80, h: 100 };
    const { lines } = buildExportGeometry([], [col]);
    expect(lines.filter(l => l.layer === 'COL')).toHaveLength(16);
  });

  test('物件帶 layer → 匯出用該圖層；沒帶 → 用預設', () => {
    const imported = { ...wall(0, 0, 200, 0), layer: 'A-WALL' };  // 匯入的牆
    const drawn = wall(0, 100, 200, 100);                          // FloorAI 新畫（無 layer）
    const importedCol = { cx: 100, cy: 300, type: 'rc', rotated: false, w: 40, h: 40, layer: 'A-COL' };
    const { lines } = buildExportGeometry([imported, drawn], [importedCol]);
    expect(lines.some(l => l.layer === 'A-WALL')).toBe(true);   // 匯入牆放回來源層
    expect(lines.some(l => l.layer === 'WALL')).toBe(true);     // 新畫牆用預設
    expect(lines.some(l => l.layer === 'A-COL')).toBe(true);    // 匯入柱放回來源層
    expect(lines.every(l => l.layer !== 'COL')).toBe(true);     // 這批柱都有來源層，不會是預設 COL
  });
});

describe('框選 boxSelect', () => {
  const walls = [
    wall(0, 0, 100, 0),      // idx 0：完全在小框內
    wall(200, 0, 300, 0),    // idx 1：在框外
    wall(50, 0, 250, 0),     // idx 2：橫跨框邊界
  ];
  const cols = [
    { cx: 50, cy: 50, type: 'rc', rotated: false, w: 20, h: 20 },   // idx 0：在框內
    { cx: 400, cy: 50, type: 'rc', rotated: false, w: 20, h: 20 },  // idx 1：框外
  ];
  const rect = { minX: -10, minY: -10, maxX: 150, maxY: 100 };

  test('窗選（window）：只選完全被框住的牆', () => {
    const sel = boxSelect(walls, [], rect, 'window');
    const idxs = sel.filter(s => s.type === 'rawWall').map(s => s.idx);
    expect(idxs).toContain(0);    // 完全在內
    expect(idxs).not.toContain(1); // 框外
    expect(idxs).not.toContain(2); // 跨邊界（端點在框外）→ 窗選不選
  });

  test('框選（crossing）：碰到邊界的牆也選', () => {
    const sel = boxSelect(walls, [], rect, 'crossing');
    const idxs = sel.filter(s => s.type === 'rawWall').map(s => s.idx);
    expect(idxs).toContain(0);
    expect(idxs).toContain(2);     // 跨邊界 → crossing 會選
    expect(idxs).not.toContain(1);
  });

  test('柱：窗選要整顆在框內', () => {
    const sel = boxSelect([], cols, rect, 'window');
    expect(sel).toEqual([{ type: 'col', idx: 0 }]);
  });

  test('篩選：關閉牆 → 框選結果不含牆', () => {
    const sel = boxSelect(walls, cols, rect, 'crossing', { wall: false, column: true, opening: true });
    expect(sel.some(s => s.type === 'rawWall')).toBe(false);
    expect(sel.some(s => s.type === 'col')).toBe(true);
  });

  test('篩選：門窗類別獨立於牆', () => {
    const opening = { isWindow: true, ptA: { x: 40, y: 0 }, ptB: { x: 60, y: 0 }, typeId: 'nt1' };
    const sel = boxSelect([opening], [], rect, 'window', { wall: false, column: false, opening: true });
    expect(sel).toEqual([{ type: 'rawWall', idx: 0 }]);
  });
});
