// 純幾何模組：牆/柱/門窗的接合計算，與 React 無關。
// 由 App.js 渲染管線與 DXF 匯出共用；npm test 直接對這裡斷言。

const GRID = 20;
const THICKNESS = 15;
const DOOR_WIDTH = 80;
const WINDOW_WIDTH = 80;
const WINDOW_INSET = 8;
const GLASS_OFFSET = 1;
const FLIP_ICON_OFFSET = 28;
const COL_W = 80;
const COL_H = 100;

function snap(v) { return Math.round(v / GRID) * GRID; }

function applyOrthoLock(pt, ref) {
  const dx = pt.x - ref.x, dy = pt.y - ref.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: pt.x, y: ref.y }
    : { x: ref.x, y: pt.y };
}

function getNorm(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  return { dx, dy, len, nx: -dy / len, ny: dx / len };
}

function computeWallLines(start, end, thickness = THICKNESS) {
  const n = getNorm(start, end);
  if (!n) return null;
  const h = thickness / 2;
  return {
    line1: { x1: start.x + n.nx * h, y1: start.y + n.ny * h, x2: end.x + n.nx * h, y2: end.y + n.ny * h },
    line2: { x1: start.x - n.nx * h, y1: start.y - n.ny * h, x2: end.x - n.nx * h, y2: end.y - n.ny * h },
  };
}

function distToWall(pt, wall) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return Infinity;
  const t = ((pt.x - wall.start.x) * n.dx + (pt.y - wall.start.y) * n.dy) / (n.len * n.len);
  if (t < 0 || t > 1) return Infinity;
  const cx = wall.start.x + t * n.dx, cy = wall.start.y + t * n.dy;
  return Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
}

function ptBetweenWallLines(pt, wall) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return false;
  const t = ((pt.x - wall.start.x) * n.dx + (pt.y - wall.start.y) * n.dy) / (n.len * n.len);
  if (t < 0 || t > 1) return false;
  const normalDist = Math.abs((pt.x - wall.start.x) * n.nx + (pt.y - wall.start.y) * n.ny);
  return normalDist < (wall.thickness ?? THICKNESS) / 2;
}

function distToOpening(pt, obj) {
  const cx = (obj.ptA.x + obj.ptB.x) / 2;
  const cy = (obj.ptA.y + obj.ptB.y) / 2;
  return Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
}

function projectOnWall(pt, wall) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return 0;
  const t = ((pt.x - wall.start.x) * n.dx + (pt.y - wall.start.y) * n.dy) / (n.len * n.len);
  return Math.max(0, Math.min(1, t));
}

function getFixedEnd(wall, rawWalls) {
  function isTJunction(pt) {
    for (const other of rawWalls) {
      if (other === wall || other.isDoor || other.isWindow) continue;
      const n = getNorm(other.start, other.end);
      if (!n) continue;
      const EPS = (other.thickness ?? THICKNESS) / 2 + 2;
      const t = ((pt.x - other.start.x) * n.dx + (pt.y - other.start.y) * n.dy) / (n.len * n.len);
      if (t < ENDPOINT_EPS || t > 1 - ENDPOINT_EPS) continue;
      const cx = other.start.x + t * n.dx, cy = other.start.y + t * n.dy;
      if (Math.hypot(pt.x - cx, pt.y - cy) < EPS) return true;
    }
    return false;
  }
  const startIsT = isTJunction(wall.start);
  const endIsT   = isTJunction(wall.end);
  if (startIsT && !endIsT) return 'start';
  if (endIsT && !startIsT) return 'end';
  return 'center';
}

function placeOpening(walls, wallIdx, clickPt, type, flipped = false, openingType = null) {
  const wall = walls[wallIdx];
  const n = getNorm(wall.start, wall.end);
  if (!n) return walls;
  const WIDTH = openingType?.width ?? (type === 'door' ? DOOR_WIDTH : WINDOW_WIDTH);
  const halfT = (WIDTH / 2) / n.len;
  let t = projectOnWall(clickPt, wall);
  t = Math.max(halfT, Math.min(1 - halfT, t));
  const tA = t - halfT, tB = t + halfT;
  if (tA < 0 || tB > 1) return walls;
  const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
  const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
  // The opening carries its OWN door/window type id + width, plus the host
  // wall's thickness so its jambs render flush with the wall faces.
  const obj = {
    [type === 'door' ? 'isDoor' : 'isWindow']: true,
    ptA, ptB, nx: n.nx, ny: n.ny,
    ux: n.dx / n.len, uy: n.dy / n.len, flipped,
    width: WIDTH, typeId: openingType?.id, thickness: wall.thickness,
  };
  // Flanking segments keep the host wall's own type/thickness + source layer.
  const carrier = { typeId: wall.typeId, thickness: wall.thickness, layer: wall.layer };
  const next = [...walls];
  next.splice(wallIdx, 1,
    { start: wall.start, end: ptA, ...carrier },
    obj,
    { start: ptB, end: wall.end, ...carrier });
  return next;
}

function findOpeningGroup(walls, idx) {
  const left = walls[idx - 1], right = walls[idx + 1];
  if (!left || !right || left.isDoor || left.isWindow || right.isDoor || right.isWindow) return null;
  return { objIdx: idx, leftIdx: idx - 1, rightIdx: idx + 1 };
}

function mergeOpening(walls, group) {
  const left = walls[group.leftIdx];
  const merged = { start: left.start, end: walls[group.rightIdx].end, typeId: left.typeId, thickness: left.thickness, layer: left.layer };
  const next = [...walls];
  next.splice(group.leftIdx, 3, merged);
  return next;
}

function getColCorners(col) {
  const cw = col.w ?? COL_W;
  const ch = col.h ?? COL_H;
  const hw = col.rotated ? ch / 2 : cw / 2;
  const hh = col.rotated ? cw / 2 : ch / 2;
  return { hw, hh };
}

function ptInCol(pt, col) {
  const { cx, cy } = col;
  const { hw, hh } = getColCorners(col);
  return pt.x >= cx - hw - 1 && pt.x <= cx + hw + 1 &&
         pt.y >= cy - hh - 1 && pt.y <= cy + hh + 1;
}

function splitWallByColumns(wall, columns) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return [wall];
  const rcCols = columns.filter(c => c.type === 'rc' || c.type === 'h');
  if (!rcCols.length) return [wall];
  const { start, end } = wall;
  const dx = end.x - start.x, dy = end.y - start.y;
  let intervals = [];
  for (const col of rcCols) {
    const { cx, cy } = col;
    const { hw, hh } = getColCorners(col);
    const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (start.x < x0 || start.x > x1) continue;
    } else {
      const ta = (x0 - start.x) / dx, tb = (x1 - start.x) / dx;
      tmin = Math.max(tmin, Math.min(ta, tb));
      tmax = Math.min(tmax, Math.max(ta, tb));
    }
    if (Math.abs(dy) < 1e-9) {
      if (start.y < y0 || start.y > y1) continue;
    } else {
      const ta = (y0 - start.y) / dy, tb = (y1 - start.y) / dy;
      tmin = Math.max(tmin, Math.min(ta, tb));
      tmax = Math.min(tmax, Math.max(ta, tb));
    }
    if (tmax <= tmin + 1e-6) continue;
    intervals.push([Math.max(0, tmin), Math.min(1, tmax)]);
  }
  if (!intervals.length) return [wall];
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [[...intervals[0]]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) last[1] = Math.max(last[1], intervals[i][1]);
    else merged.push([...intervals[i]]);
  }
  const segs = [];
  let cur = 0;
  for (const [tA, tB] of merged) {
    if (tA > cur + 1e-4) segs.push({ start: { x: start.x + cur * dx, y: start.y + cur * dy }, end: { x: start.x + tA * dx, y: start.y + tA * dy } });
    cur = tB;
  }
  if (cur < 1 - 1e-4) segs.push({ start: { x: start.x + cur * dx, y: start.y + cur * dy }, end: wall.end });
  return segs.length > 0 ? segs : [];
}

function splitAllWallsByColumn(rawWalls, col) {
  const result = [];
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) { result.push(w); continue; }
    result.push(...splitWallByColumns(w, [col]));
  }
  return result;
}

function segIntersectT(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  const dax = ax1 - ax0, day = ay1 - ay0;
  const dbx = bx1 - bx0, dby = by1 - by0;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = bx0 - ax0, dy = by0 - ay0;
  const tA = (dx * dby - dy * dbx) / denom;
  const tB = (dx * day - dy * dax) / denom;
  if (tA < -1e-6 || tA > 1 + 1e-6) return null;
  if (tB < -1e-6 || tB > 1 + 1e-6) return null;
  return { tA: Math.max(0, Math.min(1, tA)), tB: Math.max(0, Math.min(1, tB)) };
}

const ENDPOINT_EPS = 0.02;

function splitByWallIntersections(newWall, rawWalls) {
  const newDx = newWall.end.x - newWall.start.x;
  const newDy = newWall.end.y - newWall.start.y;
  const newLen = Math.sqrt(newDx * newDx + newDy * newDy);
  if (newLen < 1e-9) return { newSegments: [newWall], updatedWalls: [...rawWalls] };

  const hits = [];

  rawWalls.forEach((w, i) => {
    if (w.isDoor || w.isWindow) return;
    const nExist = getNorm(w.start, w.end);
    if (!nExist) return;
    const hit = segIntersectT(
      newWall.start.x, newWall.start.y, newWall.end.x, newWall.end.y,
      w.start.x, w.start.y, w.end.x, w.end.y
    );
    if (!hit) return;
    hits.push({ tA: hit.tA, tB: hit.tB, existingIdx: i, nExist, w });
  });

  hits.sort((a, b) => a.tA - b.tA);

  const newTcuts = [];

  for (const { tA, tB, nExist, w } of hits) {
    const tAisEndpoint = tA < ENDPOINT_EPS || tA > 1 - ENDPOINT_EPS;
    const tBisEndpoint = tB < ENDPOINT_EPS || tB > 1 - ENDPOINT_EPS;
    if (tAisEndpoint && tBisEndpoint) continue; // L-corner: handled by miters

    const centerPx = w.start.x + tB * (w.end.x - w.start.x);
    const centerPy = w.start.y + tB * (w.end.y - w.start.y);
    const sampleT = tA < 0.5 ? Math.min(1, tA + 0.01) : Math.max(0, tA - 0.01);
    const samplePx = newWall.start.x + sampleT * newDx;
    const samplePy = newWall.start.y + sampleT * newDy;
    const sideSign = (
      (samplePx - centerPx) * nExist.nx +
      (samplePy - centerPy) * nExist.ny
    ) >= 0 ? 1 : -1;

    if (tAisEndpoint && !tBisEndpoint) {
      // T-junction (new wall is stub): cut new wall at outer face, cut existing wall
      const hExist = (w.thickness ?? THICKNESS) / 2;
      const facePx = centerPx + sideSign * nExist.nx * hExist;
      const facePy = centerPy + sideSign * nExist.ny * hExist;
      const correctedTa = (
        (facePx - newWall.start.x) * newDx +
        (facePy - newWall.start.y) * newDy
      ) / (newLen * newLen);
      const clampedTa = Math.max(0, Math.min(1, correctedTa));
      if (clampedTa > ENDPOINT_EPS && clampedTa < 1 - ENDPOINT_EPS) {
        newTcuts.push(clampedTa);
      }
    }
    // Cross (!tAisEndpoint && !tBisEndpoint): no data cuts — gaps handled at render time
    // T (exist=stub, tBisEndpoint): no cuts anywhere
  }

  // Split new wall at cut points
  const sortedNew = [...newTcuts].sort((a, b) => a - b);
  const newSegments = [];
  let prev = 0;
  for (const t of sortedNew) {
    newSegments.push({
      start: { x: newWall.start.x + prev * newDx, y: newWall.start.y + prev * newDy },
      end:   { x: newWall.start.x + t    * newDx, y: newWall.start.y + t    * newDy },
    });
    prev = t;
  }
  newSegments.push({
    start: { x: newWall.start.x + prev * newDx, y: newWall.start.y + prev * newDy },
    end: newWall.end,
  });

  // Filter out stub segments whose midpoint lies inside an existing wall's body
  const filteredSegments = newSegments.filter(seg => {
    const midX = (seg.start.x + seg.end.x) / 2;
    const midY = (seg.start.y + seg.end.y) / 2;
    return !rawWalls.some(w => {
      if (w.isDoor || w.isWindow) return false;
      return ptBetweenWallLines({ x: midX, y: midY }, w);
    });
  });

  return { newSegments: filteredSegments, updatedWalls: [...rawWalls] };
}

function getWallGaps(wall, rawWalls) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return { posGaps: [], negGaps: [] };
  const hSelf = (wall.thickness ?? THICKNESS) / 2;
  const posLine = {
    x0: wall.start.x + n.nx * hSelf, y0: wall.start.y + n.ny * hSelf,
    x1: wall.end.x   + n.nx * hSelf, y1: wall.end.y   + n.ny * hSelf,
  };
  const negLine = {
    x0: wall.start.x - n.nx * hSelf, y0: wall.start.y - n.ny * hSelf,
    x1: wall.end.x   - n.nx * hSelf, y1: wall.end.y   - n.ny * hSelf,
  };

  const posGaps = [], negGaps = [];

  for (const other of rawWalls) {
    if (other === wall || other.isDoor || other.isWindow) continue;
    const nO = getNorm(other.start, other.end);
    if (!nO) continue;

    const centerHit = segIntersectT(
      wall.start.x, wall.start.y, wall.end.x, wall.end.y,
      other.start.x, other.start.y, other.end.x, other.end.y
    );

    if (!centerHit) {
      // Drawn T-junction: splitByWallIntersections moves stub endpoint to our outer face,
      // so the centerlines no longer intersect. Detect by checking if other's endpoint
      // lies on our outer face (normalDist ≈ h).
      const isOuterFaceT = [other.start, other.end].some(pt => {
        const tAlong = ((pt.x - wall.start.x) * n.dx + (pt.y - wall.start.y) * n.dy) / (n.len * n.len);
        if (tAlong < ENDPOINT_EPS || tAlong > 1 - ENDPOINT_EPS) return false;
        const nd = Math.abs((pt.x - wall.start.x) * n.nx + (pt.y - wall.start.y) * n.ny);
        return nd >= hSelf - 1 && nd <= hSelf + 2;
      });
      if (!isOuterFaceT) continue;
      // Fall through to offset-line gap computation below
    } else {
      const tA = centerHit.tA, tB = centerHit.tB;
      const tAisEndpoint = tA < ENDPOINT_EPS || tA > 1 - ENDPOINT_EPS;
      const tBisEndpoint = tB < ENDPOINT_EPS || tB > 1 - ENDPOINT_EPS;
      if (tAisEndpoint && tBisEndpoint) continue;
      if (tAisEndpoint) continue;  // this wall is stub — no gap on itself
      // tBisEndpoint: stub endpoint at our centerline — extend its offset lines by h so far face gets a gap too
    }

    const hOther = (other.thickness ?? THICKNESS) / 2;
    const otherPos = {
      x0: other.start.x + nO.nx * hOther, y0: other.start.y + nO.ny * hOther,
      x1: other.end.x   + nO.nx * hOther, y1: other.end.y   + nO.ny * hOther,
    };
    const otherNeg = {
      x0: other.start.x - nO.nx * hOther, y0: other.start.y - nO.ny * hOther,
      x1: other.end.x   - nO.nx * hOther, y1: other.end.y   - nO.ny * hOther,
    };

    for (const [myLine, gapArr] of [[posLine, posGaps], [negLine, negGaps]]) {
      const tHits = [];
      for (const edge of [otherPos, otherNeg]) {
        const hit = segIntersectT(myLine.x0, myLine.y0, myLine.x1, myLine.y1, edge.x0, edge.y0, edge.x1, edge.y1);
        if (hit !== null) tHits.push(hit.tA);
      }
      if (tHits.length === 2) {
        const epsT = hSelf*4 / n.len;
        const bothNearStart = tHits[0] < epsT && tHits[1] < epsT;
        const bothNearEnd   = tHits[0] > 1 - epsT && tHits[1] > 1 - epsT;
        if (bothNearStart || bothNearEnd) continue;
        const t0 = Math.max(0, Math.min(tHits[0], tHits[1]));
        const t1 = Math.min(1, Math.max(tHits[0], tHits[1]));
        if (t1 - t0 > 1e-4) gapArr.push([t0, t1]);
      }
    }
  }

  return { posGaps, negGaps };
}

function getColGaps(col, rawWalls) {
  const { cx, cy } = col;
  const { hw, hh } = getColCorners(col);
  const gaps = { top: [], bottom: [], left: [], right: [] };
  const colEdges = [
    { key: 'top',    x0: cx-hw, y0: cy-hh, x1: cx+hw, y1: cy-hh },
    { key: 'bottom', x0: cx-hw, y0: cy+hh, x1: cx+hw, y1: cy+hh },
    { key: 'left',   x0: cx-hw, y0: cy-hh, x1: cx-hw, y1: cy+hh },
    { key: 'right',  x0: cx+hw, y0: cy-hh, x1: cx+hw, y1: cy+hh },
  ];
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) continue;
    const n = getNorm(w.start, w.end);
    if (!n) continue;
    const hh2 = (w.thickness ?? THICKNESS) / 2;
    const offsets = [
      { x0: w.start.x + n.nx*hh2, y0: w.start.y + n.ny*hh2, x1: w.end.x + n.nx*hh2, y1: w.end.y + n.ny*hh2 },
      { x0: w.start.x - n.nx*hh2, y0: w.start.y - n.ny*hh2, x1: w.end.x - n.nx*hh2, y1: w.end.y - n.ny*hh2 },
    ];
    for (const edge of colEdges) {
      const tHits = [];
      for (const seg of offsets) {
        const hit = segIntersectT(seg.x0, seg.y0, seg.x1, seg.y1, edge.x0, edge.y0, edge.x1, edge.y1);
        if (hit !== null) tHits.push(hit.tB);
      }
      if (tHits.length === 2) {
        const t0 = Math.max(0, Math.min(tHits[0], tHits[1]));
        const t1 = Math.min(1, Math.max(tHits[0], tHits[1]));
        if (t1 - t0 > 1e-4) gaps[edge.key].push([t0, t1]);
      }
    }
  }
  return gaps;
}

function clipOffsetLineOutsideCol(x0, y0, x1, y1, col) {
  const { cx, cy } = col;
  const { hw, hh } = getColCorners(col);
  const rx0 = cx - hw, rx1 = cx + hw, ry0 = cy - hh, ry1 = cy + hh;
  function insideCol(x, y) { return x > rx0 - 1e-6 && x < rx1 + 1e-6 && y > ry0 - 1e-6 && y < ry1 + 1e-6; }
  const p0in = insideCol(x0, y0), p1in = insideCol(x1, y1);
  if (!p0in && !p1in) return [x0, y0, x1, y1];
  const dx = x1 - x0, dy = y1 - y0;
  const hits = [];
  function tryEdge(t) {
    if (t < -1e-6 || t > 1 + 1e-6) return;
    const px = x0 + t * dx, py = y0 + t * dy;
    if (px >= rx0 - 1e-4 && px <= rx1 + 1e-4 && py >= ry0 - 1e-4 && py <= ry1 + 1e-4) hits.push(Math.max(0, Math.min(1, t)));
  }
  if (Math.abs(dx) > 1e-9) { tryEdge((rx0 - x0) / dx); tryEdge((rx1 - x0) / dx); }
  if (Math.abs(dy) > 1e-9) { tryEdge((ry0 - y0) / dy); tryEdge((ry1 - y0) / dy); }
  hits.sort((a, b) => a - b);
  if (!hits.length) return [x0, y0, x1, y1];
  let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
  if (p1in) { const t = hits[hits.length - 1]; nx1 = x0 + t * dx; ny1 = y0 + t * dy; }
  if (p0in) { const t = hits[0]; nx0 = x0 + t * dx; ny0 = y0 + t * dy; }
  return [nx0, ny0, nx1, ny1];
}

function computeMiter(wallA, wallB, hA = THICKNESS / 2, hB = THICKNESS / 2) {
  const nA = getNorm(wallA.start, wallA.end);
  const nB = getNorm(wallB.start, wallB.end);
  if (!nA || !nB) return null;
  const P = wallA.end;
  const uAx = nA.dx / nA.len, uAy = nA.dy / nA.len;
  const uBx = nB.dx / nB.len, uBy = nB.dy / nB.len;
  function lineIntersect(px, py, dx, dy, qx, qy, ex, ey) {
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((qx - px) * ey - (qy - py) * ex) / denom;
    return { x: px + t * dx, y: py + t * dy };
  }
  const pos = lineIntersect(P.x + nA.nx * hA, P.y + nA.ny * hA, uAx, uAy, P.x + nB.nx * hB, P.y + nB.ny * hB, uBx, uBy);
  const neg = lineIntersect(P.x - nA.nx * hA, P.y - nA.ny * hA, uAx, uAy, P.x - nB.nx * hB, P.y - nB.ny * hB, uBx, uBy);
  if (!pos || !neg) return null;
  return { pos, neg };
}

function computeAllMiters(rawWalls) {
  const miters = {};
  const plains = rawWalls.map((w, i) => ({ w, i })).filter(({ w }) => !w.isDoor && !w.isWindow);
  const endpointCount = new Map();
  const ptKey = (p) => `${p.x},${p.y}`;
  for (const { w } of plains) {
    const ks = ptKey(w.start), ke = ptKey(w.end);
    endpointCount.set(ks, (endpointCount.get(ks) ?? 0) + 1);
    endpointCount.set(ke, (endpointCount.get(ke) ?? 0) + 1);
  }
  for (const { w: wA, i: iA } of plains) {
    for (const { w: wB, i: iB } of plains) {
      if (iA === iB) continue;
      const cases = [
        { match: () => Math.abs(wA.end.x-wB.start.x)<1 && Math.abs(wA.end.y-wB.start.y)<1,
          argA: wA, argB: wB, keyA: 'end', keyB: 'start', pt: wA.end, flipA: false, flipB: false },
        { match: () => Math.abs(wA.start.x-wB.start.x)<1 && Math.abs(wA.start.y-wB.start.y)<1,
          argA: {start:wA.end,end:wA.start}, argB: wB, keyA: 'start', keyB: 'start', pt: wA.start, flipA: true, flipB: false },
        { match: () => Math.abs(wA.end.x-wB.end.x)<1 && Math.abs(wA.end.y-wB.end.y)<1,
          argA: wA, argB: {start:wB.end,end:wB.start}, keyA: 'end', keyB: 'end', pt: wA.end, flipA: false, flipB: true },
        { match: () => Math.abs(wA.start.x-wB.end.x)<1 && Math.abs(wA.start.y-wB.end.y)<1,
          argA: {start:wA.end,end:wA.start}, argB: {start:wB.end,end:wB.start}, keyA: 'start', keyB: 'end', pt: wA.start, flipA: true, flipB: true },
      ];
      for (const { match, argA, argB, keyA, keyB, pt, flipA, flipB } of cases) {
        if (!match()) continue;
        const count = endpointCount.get(ptKey(pt)) ?? 0;
        if (count > 2) continue;
        const isStubEnd = plains.some(({ w }) => {
          if (w === wA || w === wB || w.isDoor || w.isWindow) return false;
          const nW = getNorm(w.start, w.end);
          if (!nW) return false;
          const tW = ((pt.x - w.start.x) * nW.dx + (pt.y - w.start.y) * nW.dy) / (nW.len * nW.len);
          if (tW < ENDPOINT_EPS || tW > 1 - ENDPOINT_EPS) return false;
          const normalDist = Math.abs((pt.x - w.start.x) * nW.nx + (pt.y - w.start.y) * nW.ny);
          return normalDist < 2;
        });
        if (isStubEnd) continue;
        const hA = (wA.thickness ?? THICKNESS) / 2;
        const hB = (wB.thickness ?? THICKNESS) / 2;
        let m = computeMiter(argA, argB, hA, hB);
        if (!m) continue;
        const mA = flipA ? { pos: m.neg, neg: m.pos } : m;
        const mB = flipB ? { pos: m.neg, neg: m.pos } : m;
        if (!miters[iA]) miters[iA] = {};
        if (!miters[iB]) miters[iB] = {};
        if (!miters[iA][keyA]) miters[iA][keyA] = mA;
        if (!miters[iB][keyB]) miters[iB][keyB] = mB;
        break;
      }
    }
  }
  return miters;
}

function computeWallDragInfo(wall, wallIdx, rawWalls, columns) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return null;
  // Force normal to positive-axis direction so proj is consistent regardless of draw direction
  const isVertical = Math.abs(n.dx) < Math.abs(n.dy);
  const normal = isVertical ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const proj = (p) => p.x * normal.x + p.y * normal.y;
  const wallStartProj = proj(wall.start);

  // Constraint from one through-wall: centerline can reach the endpoint (no THICKNESS/2 inset)
  // so the dragged wall can snap to a T-join position at the through-wall's endpoints.
  function constraintFromOther(other) {
    const pStart = proj(other.start);
    const pEnd   = proj(other.end);
    const lo = Math.min(pStart, pEnd);
    const hi = Math.max(pStart, pEnd);
    return {
      min: lo - wallStartProj,
      max: hi - wallStartProj,
      snapPts: [other.start, { x:(other.start.x+other.end.x)/2, y:(other.start.y+other.end.y)/2 }, other.end],
    };
  }

  let limitMin = -Infinity, limitMax = Infinity;
  const snapPoints = [];

  for (const other of rawWalls) {
    if (other === wall || other.isDoor || other.isWindow) continue;
    const nO = getNorm(other.start, other.end);
    if (!nO) continue;
    const hit = segIntersectT(
      wall.start.x, wall.start.y, wall.end.x, wall.end.y,
      other.start.x, other.start.y, other.end.x, other.end.y
    );
    let connected = !!hit;
    if (!connected) {
      // Check if either endpoint is near other's body (trimmed T-junction stub end)
      // Threshold: other's half-thickness + GRID to account for grid snapping and trim offset
      const halfOther = (other.thickness ?? THICKNESS) / 2;
      for (const pt of [wall.start, wall.end]) {
        const tAlong = ((pt.x - other.start.x) * nO.dx + (pt.y - other.start.y) * nO.dy) / (nO.len * nO.len);
        if (tAlong < -0.01 || tAlong > 1.01) continue;
        const dist = Math.abs((pt.x - other.start.x) * nO.nx + (pt.y - other.start.y) * nO.ny);
        if (dist <= halfOther + GRID) { connected = true; break; }
      }
    }
    if (!connected) continue;
    const r = constraintFromOther(other);
    limitMin = Math.max(limitMin, r.min);
    limitMax = Math.min(limitMax, r.max);
    snapPoints.push(...r.snapPts);
  }

  for (const col of columns) {
    const { hw, hh } = getColCorners(col);
    const corners = [
      { x: col.cx - hw, y: col.cy - hh }, { x: col.cx + hw, y: col.cy - hh },
      { x: col.cx - hw, y: col.cy + hh }, { x: col.cx + hw, y: col.cy + hh },
    ];
    const FACE_EPS = GRID;
    const colConnected = [wall.start, wall.end].some(pt => {
      const nearXFace = Math.abs(pt.x - (col.cx - hw)) <= FACE_EPS || Math.abs(pt.x - (col.cx + hw)) <= FACE_EPS;
      const inYRange  = pt.y >= col.cy - hh - FACE_EPS && pt.y <= col.cy + hh + FACE_EPS;
      const nearYFace = Math.abs(pt.y - (col.cy - hh)) <= FACE_EPS || Math.abs(pt.y - (col.cy + hh)) <= FACE_EPS;
      const inXRange  = pt.x >= col.cx - hw - FACE_EPS && pt.x <= col.cx + hw + FACE_EPS;
      return (nearXFace && inYRange) || (nearYFace && inXRange);
    });
    if (!colConnected) continue;
    const projs = corners.map(proj);
    limitMin = Math.max(limitMin, Math.min(...projs) - wallStartProj);
    limitMax = Math.min(limitMax, Math.max(...projs) - wallStartProj);
    const h_wall = (wall.thickness ?? THICKNESS) / 2;
    const adjustedCorners = [
      { x: col.cx - hw + h_wall, y: col.cy - hh + h_wall },
      { x: col.cx + hw - h_wall, y: col.cy - hh + h_wall },
      { x: col.cx - hw + h_wall, y: col.cy + hh - h_wall },
      { x: col.cx + hw - h_wall, y: col.cy + hh - h_wall },
    ];
    snapPoints.push(...adjustedCorners, { x: col.cx, y: col.cy });
  }

  return { normal, limitMin, limitMax, snapPoints };
}

function clipStubEnd(px, py, rawWalls, currentWall) {
  const hSelf = (currentWall.thickness ?? THICKNESS) / 2;
  const nS = getNorm(currentWall.start, currentWall.end);
  if (!nS) return null;
  // Determine if this is the end or start of the stub (affects which face to clip to)
  const isEnd = Math.abs(px - currentWall.end.x) < 1 && Math.abs(py - currentWall.end.y) < 1;
  const preSign = isEnd ? -1 : 1; // move toward interior of stub to find approach direction

  for (const other of rawWalls) {
    if (other === currentWall || other.isDoor || other.isWindow) continue;
    const nO = getNorm(other.start, other.end);
    if (!nO) continue;
    const t = ((px - other.start.x) * nO.dx + (py - other.start.y) * nO.dy) / (nO.len * nO.len);
    if (t < ENDPOINT_EPS || t > 1 - ENDPOINT_EPS) continue;
    const normalDist = Math.abs((px - other.start.x) * nO.nx + (py - other.start.y) * nO.ny);
    if (normalDist > 2) continue;

    // Find which face of the through-wall the stub connects to
    const hOther = (other.thickness ?? THICKNESS) / 2;
    const preDist = (px + preSign * nS.dx / nS.len - other.start.x) * nO.nx
                  + (py + preSign * nS.dy / nS.len - other.start.y) * nO.ny;
    const faceSign = preDist >= 0 ? 1 : -1;
    const facePx = px + faceSign * nO.nx * hOther;
    const facePy = py + faceSign * nO.ny * hOther;

    // Intersect stub's pos/neg offset lines with the through-wall face line
    function faceIntersect(offsetSign) {
      const lx = px + offsetSign * nS.nx * hSelf;
      const ly = py + offsetSign * nS.ny * hSelf;
      const denom = nS.dx * nO.dy - nS.dy * nO.dx;
      if (Math.abs(denom) < 1e-9) return { x: facePx, y: facePy };
      const tI = ((facePx - lx) * nO.dy - (facePy - ly) * nO.dx) / denom;
      return { x: lx + tI * nS.dx, y: ly + tI * nS.dy };
    }

    return { pos: faceIntersect(1), neg: faceIntersect(-1) };
  }
  return null;
}

// ── DXF 匯出組裝 ────────────────────────────────────────────────────────────────
// 把「畫面上實際渲染的幾何」收集成線段/弧清單（所見即所得），
// 各段邏輯對應 App.js 的渲染元件：WallSegment / DoorSegment / WindowSegment / RCColumn / HColumn。

// EdgeWithGaps 的計算部分：一條邊被 gaps（[t0,t1] 參數區間）切開後剩下的子線段
function splitEdgeByGaps(x0, y0, x1, y1, gaps) {
  if (!gaps || gaps.length === 0) return [{ x1: x0, y1: y0, x2: x1, y2: y1 }];
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = 0;
  for (const [ta, tb] of sorted) {
    if (ta > cur + 1e-4) segs.push([cur, ta]);
    cur = Math.max(cur, tb);
  }
  if (cur < 1 - 1e-4) segs.push([cur, 1]);
  return segs.map(([ta, tb]) => ({
    x1: x0 + ta * (x1 - x0), y1: y0 + ta * (y1 - y0),
    x2: x0 + tb * (x1 - x0), y2: y0 + tb * (y1 - y0),
  }));
}

// 對應 WallSegment：miter/T 裁切端點覆寫 → 柱裁切 → 十字缺口
function wallExportLines(wall, rawWalls, columns, miter = {}) {
  const geo = computeWallLines(wall.start, wall.end, wall.thickness ?? THICKNESS);
  if (!geo) return [];
  const rcCols = columns.filter(c => c.type === 'rc');

  const startClip = clipStubEnd(wall.start.x, wall.start.y, rawWalls, wall);
  const endClip   = clipStubEnd(wall.end.x,   wall.end.y,   rawWalls, wall);

  let [ax1, ay1, ax2, ay2] = [
    startClip?.pos?.x ?? miter.start?.pos?.x ?? geo.line1.x1,
    startClip?.pos?.y ?? miter.start?.pos?.y ?? geo.line1.y1,
    endClip?.pos?.x   ?? miter.end?.pos?.x   ?? geo.line1.x2,
    endClip?.pos?.y   ?? miter.end?.pos?.y   ?? geo.line1.y2,
  ];
  let [bx1, by1, bx2, by2] = [
    startClip?.neg?.x ?? miter.start?.neg?.x ?? geo.line2.x1,
    startClip?.neg?.y ?? miter.start?.neg?.y ?? geo.line2.y1,
    endClip?.neg?.x   ?? miter.end?.neg?.x   ?? geo.line2.x2,
    endClip?.neg?.y   ?? miter.end?.neg?.y   ?? geo.line2.y2,
  ];
  for (const col of rcCols) {
    [ax1, ay1, ax2, ay2] = clipOffsetLineOutsideCol(ax1, ay1, ax2, ay2, col);
    [bx1, by1, bx2, by2] = clipOffsetLineOutsideCol(bx1, by1, bx2, by2, col);
  }
  const { posGaps, negGaps } = getWallGaps(wall, rawWalls);
  return [
    ...splitEdgeByGaps(ax1, ay1, ax2, ay2, posGaps),
    ...splitEdgeByGaps(bx1, by1, bx2, by2, negGaps),
  ];
}

// 對應 DoorSegment：兩條門框線 + 門扇線 + 開門弧
function doorExportGeometry(door) {
  const { ptA, ptB, flipped } = door;
  const nx = door.nx, ny = door.ny;
  const h = (door.thickness ?? THICKNESS) / 2;
  const dx = ptB.x - ptA.x, dy = ptB.y - ptA.y;
  const span = Math.hypot(dx, dy);
  const doorEndX = ptA.x + (flipped ? -dy : dy), doorEndY = ptA.y + (flipped ? dx : -dx);
  const lines = [
    { x1: ptA.x + nx * h, y1: ptA.y + ny * h, x2: ptA.x - nx * h, y2: ptA.y - ny * h },
    { x1: ptB.x + nx * h, y1: ptB.y + ny * h, x2: ptB.x - nx * h, y2: ptB.y - ny * h },
    { x1: ptA.x, y1: ptA.y, x2: doorEndX, y2: doorEndY },
  ];
  // DXF 的 ARC 一律從 startDeg 逆時針畫到 endDeg；門弧固定 90°，
  // 依兩端角度的逆時針差挑出正確方向（差 ≤180° 的那個順序）。
  const degLeaf = Math.atan2(doorEndY - ptA.y, doorEndX - ptA.x) * 180 / Math.PI;
  const degB = Math.atan2(ptB.y - ptA.y, ptB.x - ptA.x) * 180 / Math.PI;
  const ccw = (from, to) => ((to - from) % 360 + 360) % 360;
  const arc = ccw(degLeaf, degB) <= 180
    ? { cx: ptA.x, cy: ptA.y, r: span, startDeg: degLeaf, endDeg: degB }
    : { cx: ptA.x, cy: ptA.y, r: span, startDeg: degB, endDeg: degLeaf };
  return { lines, arcs: [arc] };
}

// 對應 WindowSegment：6 條框線 + 2 條玻璃線
function windowExportLines(win) {
  const { ptA, ptB, nx, ny, ux, uy } = win;
  const h = (win.thickness ?? THICKNESS) / 2;
  const fA = { x: ptA.x + ux * WINDOW_INSET, y: ptA.y + uy * WINDOW_INSET };
  const fB = { x: ptB.x - ux * WINDOW_INSET, y: ptB.y - uy * WINDOW_INSET };
  return [
    { x1: ptA.x + nx * h, y1: ptA.y + ny * h, x2: ptA.x - nx * h, y2: ptA.y - ny * h },
    { x1: ptB.x + nx * h, y1: ptB.y + ny * h, x2: ptB.x - nx * h, y2: ptB.y - ny * h },
    { x1: ptA.x + nx * h, y1: ptA.y + ny * h, x2: ptB.x + nx * h, y2: ptB.y + ny * h },
    { x1: ptA.x - nx * h, y1: ptA.y - ny * h, x2: ptB.x - nx * h, y2: ptB.y - ny * h },
    { x1: fA.x + nx * h, y1: fA.y + ny * h, x2: fA.x - nx * h, y2: fA.y - ny * h },
    { x1: fB.x + nx * h, y1: fB.y + ny * h, x2: fB.x - nx * h, y2: fB.y - ny * h },
    { x1: fB.x + nx * GLASS_OFFSET, y1: fB.y + ny * GLASS_OFFSET, x2: fA.x + nx * GLASS_OFFSET, y2: fA.y + ny * GLASS_OFFSET },
    { x1: fA.x - nx * GLASS_OFFSET, y1: fA.y - ny * GLASS_OFFSET, x2: fB.x - nx * GLASS_OFFSET, y2: fB.y - ny * GLASS_OFFSET },
  ];
}

// 對應 RCColumn（四邊含缺口）與 HColumn（外框 + 上下翼板 + 腹板）
function columnExportLines(col, rawWalls) {
  const { cx, cy } = col;
  const { hw, hh } = getColCorners(col);
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  if (col.type === 'h') {
    const flangeT = hh * 0.18, webT = hw * 0.18;
    const rect = (rx0, ry0, rx1, ry1) => [
      { x1: rx0, y1: ry0, x2: rx1, y2: ry0 },
      { x1: rx1, y1: ry0, x2: rx1, y2: ry1 },
      { x1: rx1, y1: ry1, x2: rx0, y2: ry1 },
      { x1: rx0, y1: ry1, x2: rx0, y2: ry0 },
    ];
    return [
      ...rect(x0, y0, x1, y1),
      ...rect(x0, y0, x1, y0 + flangeT),
      ...rect(x0, y1 - flangeT, x1, y1),
      ...rect(cx - webT / 2, y0 + flangeT, cx + webT / 2, y1 - flangeT),
    ];
  }
  const gaps = getColGaps(col, rawWalls);
  return [
    ...splitEdgeByGaps(x0, y0, x1, y0, gaps.top),
    ...splitEdgeByGaps(x0, y1, x1, y1, gaps.bottom),
    ...splitEdgeByGaps(x0, y0, x0, y1, gaps.left),
    ...splitEdgeByGaps(x1, y0, x1, y1, gaps.right),
  ];
}

// 主入口：整個場景 → { lines: [{x1,y1,x2,y2,layer}], arcs: [{cx,cy,r,startDeg,endDeg,layer}] }
// 每個物件用自己的來源圖層（匯入時記下的 `layer`）；沒有的（FloorAI 新畫）用預設圖層。
// 後端 app.py 會把預設的 COL 併進 WALL，並依需要建出來源圖層。
function buildExportGeometry(rawWalls, columns) {
  const lines = [];
  const arcs = [];
  const tag = (segs, layer) => segs.forEach(s => lines.push({ ...s, layer }));
  const miters = computeAllMiters(rawWalls);
  rawWalls.forEach((w, i) => {
    if (w.isDoor) {
      const g = doorExportGeometry(w);
      const layer = w.layer ?? 'DOOR';
      tag(g.lines, layer);
      g.arcs.forEach(a => arcs.push({ ...a, layer }));
    } else if (w.isWindow) {
      tag(windowExportLines(w), w.layer ?? 'WINDOW');
    } else {
      tag(wallExportLines(w, rawWalls, columns, miters[i] || {}), w.layer ?? 'WALL');
    }
  });
  columns.forEach(c => tag(columnExportLines(c, rawWalls), c.layer ?? 'COL'));
  return { lines, arcs };
}

export {
  GRID,
  THICKNESS,
  DOOR_WIDTH,
  WINDOW_WIDTH,
  WINDOW_INSET,
  GLASS_OFFSET,
  FLIP_ICON_OFFSET,
  COL_W,
  COL_H,
  ENDPOINT_EPS,
  snap,
  applyOrthoLock,
  getNorm,
  computeWallLines,
  distToWall,
  ptBetweenWallLines,
  distToOpening,
  projectOnWall,
  getFixedEnd,
  placeOpening,
  findOpeningGroup,
  mergeOpening,
  getColCorners,
  ptInCol,
  splitWallByColumns,
  splitAllWallsByColumn,
  segIntersectT,
  splitByWallIntersections,
  getWallGaps,
  getColGaps,
  clipOffsetLineOutsideCol,
  computeMiter,
  computeAllMiters,
  computeWallDragInfo,
  clipStubEnd,
  splitEdgeByGaps,
  buildExportGeometry,
};
