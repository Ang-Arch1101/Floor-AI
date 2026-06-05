import React, { useRef, useState, useEffect, useMemo } from 'react';

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

function computeWallLines(start, end) {
  const n = getNorm(start, end);
  if (!n) return null;
  const h = THICKNESS / 2;
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
  return normalDist < THICKNESS / 2;
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

function placeOpening(walls, wallIdx, clickPt, type, flipped = false) {
  const wall = walls[wallIdx];
  const n = getNorm(wall.start, wall.end);
  if (!n) return walls;
  const WIDTH = type === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
  const halfT = (WIDTH / 2) / n.len;
  let t = projectOnWall(clickPt, wall);
  t = Math.max(halfT, Math.min(1 - halfT, t));
  const tA = t - halfT, tB = t + halfT;
  if (tA < 0 || tB > 1) return walls;
  const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
  const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
  const obj = {
    [type === 'door' ? 'isDoor' : 'isWindow']: true,
    ptA, ptB, nx: n.nx, ny: n.ny,
    ux: n.dx / n.len, uy: n.dy / n.len, flipped,
  };
  const next = [...walls];
  next.splice(wallIdx, 1, { start: wall.start, end: ptA }, obj, { start: ptB, end: wall.end });
  return next;
}

function findOpeningGroup(walls, idx) {
  const left = walls[idx - 1], right = walls[idx + 1];
  if (!left || !right || left.isDoor || left.isWindow || right.isDoor || right.isWindow) return null;
  return { objIdx: idx, leftIdx: idx - 1, rightIdx: idx + 1 };
}

function mergeOpening(walls, group) {
  const merged = { start: walls[group.leftIdx].start, end: walls[group.rightIdx].end };
  const next = [...walls];
  next.splice(group.leftIdx, 3, merged);
  return next;
}

function getColCorners(col) {
  const hw = col.rotated ? COL_H / 2 : COL_W / 2;
  const hh = col.rotated ? COL_W / 2 : COL_H / 2;
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
const FACE_SNAP_EPS = THICKNESS / 2 + 10; // px — 外緣 snap 容差

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
      const facePx = centerPx + sideSign * nExist.nx * (THICKNESS / 2);
      const facePy = centerPy + sideSign * nExist.ny * (THICKNESS / 2);
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
  const h = THICKNESS / 2;
  const posLine = {
    x0: wall.start.x + n.nx * h, y0: wall.start.y + n.ny * h,
    x1: wall.end.x   + n.nx * h, y1: wall.end.y   + n.ny * h,
  };
  const negLine = {
    x0: wall.start.x - n.nx * h, y0: wall.start.y - n.ny * h,
    x1: wall.end.x   - n.nx * h, y1: wall.end.y   - n.ny * h,
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
    if (!centerHit) continue;
    const tA = centerHit.tA, tB = centerHit.tB;
    const tAisEndpoint = tA < ENDPOINT_EPS || tA > 1 - ENDPOINT_EPS;
    const tBisEndpoint = tB < ENDPOINT_EPS || tB > 1 - ENDPOINT_EPS;
    if (tAisEndpoint && tBisEndpoint) continue;
    if (tAisEndpoint) continue;  // this wall is stub — no gap on itself
    // tBisEndpoint: stub endpoint at our centerline — extend its offset lines by h so far face gets a gap too

    const otherPos = {
      x0: other.start.x + nO.nx * h, y0: other.start.y + nO.ny * h,
      x1: other.end.x   + nO.nx * h, y1: other.end.y   + nO.ny * h,
    };
    const otherNeg = {
      x0: other.start.x - nO.nx * h, y0: other.start.y - nO.ny * h,
      x1: other.end.x   - nO.nx * h, y1: other.end.y   - nO.ny * h,
    };

    for (const [myLine, gapArr] of [[posLine, posGaps], [negLine, negGaps]]) {
      const tHits = [];
      for (const edge of [otherPos, otherNeg]) {
        const hit = segIntersectT(myLine.x0, myLine.y0, myLine.x1, myLine.y1, edge.x0, edge.y0, edge.x1, edge.y1);
        if (hit !== null) tHits.push(hit.tA);
      }
      if (tHits.length === 2) {
        const epsT = THICKNESS*2 / n.len;
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
    const hh2 = THICKNESS / 2;
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

function computeMiter(wallA, wallB) {
  const nA = getNorm(wallA.start, wallA.end);
  const nB = getNorm(wallB.start, wallB.end);
  if (!nA || !nB) return null;
  const P = wallA.end;
  const h = THICKNESS / 2;
  const uAx = nA.dx / nA.len, uAy = nA.dy / nA.len;
  const uBx = nB.dx / nB.len, uBy = nB.dy / nB.len;
  function lineIntersect(px, py, dx, dy, qx, qy, ex, ey) {
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((qx - px) * ey - (qy - py) * ex) / denom;
    return { x: px + t * dx, y: py + t * dy };
  }
  const pos = lineIntersect(P.x + nA.nx * h, P.y + nA.ny * h, uAx, uAy, P.x + nB.nx * h, P.y + nB.ny * h, uBx, uBy);
  const neg = lineIntersect(P.x - nA.nx * h, P.y - nA.ny * h, uAx, uAy, P.x - nB.nx * h, P.y - nB.ny * h, uBx, uBy);
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
        let m = computeMiter(argA, argB);
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
  const half = THICKNESS / 2;

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
      // Threshold: half + GRID to account for grid snapping and trim offset
      for (const pt of [wall.start, wall.end]) {
        const tAlong = ((pt.x - other.start.x) * nO.dx + (pt.y - other.start.y) * nO.dy) / (nO.len * nO.len);
        if (tAlong < -0.01 || tAlong > 1.01) continue;
        const dist = Math.abs((pt.x - other.start.x) * nO.nx + (pt.y - other.start.y) * nO.ny);
        if (dist <= half + GRID) { connected = true; break; }
      }
    }
    if (!connected) continue;
    const r = constraintFromOther(other);
    console.log('constraint', {r, limitMin, limitMax, wallStartProj, otherStart: other.start, otherEnd: other.end});
    limitMin = Math.max(limitMin, r.min);
    limitMax = Math.min(limitMax, r.max);
    snapPoints.push(...r.snapPts);
  }
  console.log('final limits', {limitMin, limitMax});

  for (const col of columns) {
    const { hw, hh } = getColCorners(col);
    const corners = [
      { x: col.cx - hw, y: col.cy - hh }, { x: col.cx + hw, y: col.cy - hh },
      { x: col.cx - hw, y: col.cy + hh }, { x: col.cx + hw, y: col.cy + hh },
    ];
    if (![wall.start, wall.end].some(pt => ptInCol(pt, col))) continue;
    const projs = corners.map(proj);
    limitMin = Math.max(limitMin, Math.min(...projs) - wallStartProj);
    limitMax = Math.min(limitMax, Math.max(...projs) - wallStartProj);
    snapPoints.push(...corners, { x: col.cx, y: col.cy });
  }

  return { normal, limitMin, limitMax, snapPoints };
}

function EdgeWithGaps({ x0, y0, x1, y1, gaps, color }) {
  if (!gaps || gaps.length === 0) return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth="1.5" />;
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = 0;
  for (const [ta, tb] of sorted) {
    if (ta > cur + 1e-4) segs.push([cur, ta]);
    cur = tb;
  }
  if (cur < 1 - 1e-4) segs.push([cur, 1]);
  return <>{segs.map(([ta, tb], i) => <line key={i} x1={x0+ta*(x1-x0)} y1={y0+ta*(y1-y0)} x2={x0+tb*(x1-x0)} y2={y0+tb*(y1-y0)} stroke={color} strokeWidth="1.5" />)}</>;
}

function clipStubEnd(px, py, rawWalls, currentWall) {
  const h = THICKNESS / 2;
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
    const preDist = (px + preSign * nS.dx / nS.len - other.start.x) * nO.nx
                  + (py + preSign * nS.dy / nS.len - other.start.y) * nO.ny;
    const faceSign = preDist >= 0 ? 1 : -1;
    const facePx = px + faceSign * nO.nx * h;
    const facePy = py + faceSign * nO.ny * h;

    // Intersect stub's pos/neg offset lines with the through-wall face line
    function faceIntersect(offsetSign) {
      const lx = px + offsetSign * nS.nx * h;
      const ly = py + offsetSign * nS.ny * h;
      const denom = nS.dx * nO.dy - nS.dy * nO.dx;
      if (Math.abs(denom) < 1e-9) return { x: facePx, y: facePy };
      const tI = ((facePx - lx) * nO.dy - (facePy - ly) * nO.dx) / denom;
      return { x: lx + tI * nS.dx, y: ly + tI * nS.dy };
    }

    return { pos: faceIntersect(1), neg: faceIntersect(-1) };
  }
  return null;
}

function WallSegment({ wall, isSelected, columns = [], miter = {}, rawWalls = [] }) {
  const geo = computeWallLines(wall.start, wall.end);
  if (!geo) return null;
  const color = isSelected ? '#ff6b9d' : '#00d4aa';
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

  return (
    <g>
      <EdgeWithGaps x0={ax1} y0={ay1} x1={ax2} y1={ay2} gaps={posGaps} color={color} />
      <EdgeWithGaps x0={bx1} y0={by1} x1={bx2} y1={by2} gaps={negGaps} color={color} />
    </g>
  );
}

function DoorSegment({ door, isPreview = false, isSelected = false }) {
  const { ptA, ptB, flipped } = door;
  const nx = flipped ? -door.nx : door.nx, ny = flipped ? -door.ny : door.ny;
  const h = THICKNESS / 2, color = isSelected ? '#ff6b9d' : '#00d4aa';
  const dx = ptB.x - ptA.x, dy = ptB.y - ptA.y;
  const doorEndX = ptA.x + (flipped ? -dy : dy), doorEndY = ptA.y + (flipped ? dx : -dx);
  const arcPath = `M ${doorEndX} ${doorEndY} A ${DOOR_WIDTH} ${DOOR_WIDTH} 0 0 ${flipped ? 0 : 1} ${ptB.x} ${ptB.y}`;
  return <g opacity={isPreview ? 0.5 : 1}><line x1={ptA.x+nx*h} y1={ptA.y+ny*h} x2={ptA.x-nx*h} y2={ptA.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptB.x+nx*h} y1={ptB.y+ny*h} x2={ptB.x-nx*h} y2={ptB.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptA.x} y1={ptA.y} x2={doorEndX} y2={doorEndY} stroke={color} strokeWidth="1.5" /><path d={arcPath} stroke={color} strokeWidth="1" fill="none" strokeDasharray="4 3" /></g>;
}

function WindowSegment({ win, isPreview = false, isSelected = false }) {
  const { ptA, ptB, nx, ny, ux, uy } = win;
  const h = THICKNESS / 2, color = isSelected ? '#ff6b9d' : '#00d4aa';
  const fA = { x: ptA.x + ux * WINDOW_INSET, y: ptA.y + uy * WINDOW_INSET };
  const fB = { x: ptB.x - ux * WINDOW_INSET, y: ptB.y - uy * WINDOW_INSET };
  return <g opacity={isPreview ? 0.5 : 1}><line x1={ptA.x+nx*h} y1={ptA.y+ny*h} x2={ptA.x-nx*h} y2={ptA.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptB.x+nx*h} y1={ptB.y+ny*h} x2={ptB.x-nx*h} y2={ptB.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptA.x+nx*h} y1={ptA.y+ny*h} x2={ptB.x+nx*h} y2={ptB.y+ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptA.x-nx*h} y1={ptA.y-ny*h} x2={ptB.x-nx*h} y2={ptB.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={fA.x+nx*h} y1={fA.y+ny*h} x2={fA.x-nx*h} y2={fA.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={fB.x+nx*h} y1={fB.y+ny*h} x2={fB.x-nx*h} y2={fB.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={fB.x+nx*GLASS_OFFSET} y1={fB.y+ny*GLASS_OFFSET} x2={fA.x+nx*GLASS_OFFSET} y2={fA.y+ny*GLASS_OFFSET} stroke={color} strokeWidth="1" /><line x1={fA.x-nx*GLASS_OFFSET} y1={fA.y-ny*GLASS_OFFSET} x2={fB.x-nx*GLASS_OFFSET} y2={fB.y-ny*GLASS_OFFSET} stroke={color} strokeWidth="1" /></g>;
}

function RCColumn({ col, isSelected, isPreview = false, rawWalls = [] }) {
  const { cx, cy } = col, { hw, hh } = getColCorners(col), color = isSelected ? '#ff6b9d' : '#00d4aa';
  const gaps = isPreview ? { top: [], bottom: [], left: [], right: [] } : getColGaps(col, rawWalls);
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  return <g opacity={isPreview ? 0.5 : 1}><EdgeWithGaps x0={x0} y0={y0} x1={x1} y1={y0} gaps={gaps.top} color={color} /><EdgeWithGaps x0={x0} y0={y1} x1={x1} y1={y1} gaps={gaps.bottom} color={color} /><EdgeWithGaps x0={x0} y0={y0} x1={x0} y1={y1} gaps={gaps.left} color={color} /><EdgeWithGaps x0={x1} y0={y0} x1={x1} y1={y1} gaps={gaps.right} color={color} /></g>;
}

function HColumn({ col, isSelected, isPreview = false }) {
  const { cx, cy } = col, { hw, hh } = getColCorners(col), color = isSelected ? '#ff6b9d' : '#00d4aa';
  const flangeT = hh * 0.18, webT = hw * 0.18;
  return <g opacity={isPreview ? 0.5 : 1}><rect x={cx-hw} y={cy-hh} width={hw*2} height={hh*2} stroke={color} strokeWidth="1.5" fill="none" /><rect x={cx-hw} y={cy-hh} width={hw*2} height={flangeT} stroke={color} strokeWidth="0.8" fill="none" /><rect x={cx-hw} y={cy+hh-flangeT} width={hw*2} height={flangeT} stroke={color} strokeWidth="0.8" fill="none" /><rect x={cx-webT/2} y={cy-hh+flangeT} width={webT} height={hh*2-flangeT*2} stroke={color} strokeWidth="0.8" fill="none" /></g>;
}

function FlipIcon({ obj }) {
  const cx = (obj.ptA.x + obj.ptB.x) / 2, cy = (obj.ptA.y + obj.ptB.y) / 2;
  const ix = cx + obj.nx * FLIP_ICON_OFFSET, iy = cy + obj.ny * FLIP_ICON_OFFSET;
  const { nx, ny, ux, uy } = obj;
  const AL = 10, AH = 4, GAP = 6;
  const a1x = ix - ux*GAP, a1y = iy - uy*GAP, a2x = ix + ux*GAP, a2y = iy + uy*GAP;
  return <g><line x1={a1x-nx*AL/2} y1={a1y-ny*AL/2} x2={a1x+nx*AL/2} y2={a1y+ny*AL/2} stroke="#ff6b9d" strokeWidth="1.5" strokeLinecap="round" /><polygon points={`${a1x+nx*AL/2},${a1y+ny*AL/2} ${a1x+nx*(AL/2-AH)-ny*AH/2},${a1y+ny*(AL/2-AH)+nx*AH/2} ${a1x+nx*(AL/2-AH)+ny*AH/2},${a1y+ny*(AL/2-AH)-nx*AH/2}`} fill="#ff6b9d" /><line x1={a2x+nx*AL/2} y1={a2y+ny*AL/2} x2={a2x-nx*AL/2} y2={a2y-ny*AL/2} stroke="#ff6b9d" strokeWidth="1.5" strokeLinecap="round" /><polygon points={`${a2x-nx*AL/2},${a2y-ny*AL/2} ${a2x-nx*(AL/2-AH)-ny*AH/2},${a2y-ny*(AL/2-AH)+nx*AH/2} ${a2x-nx*(AL/2-AH)+ny*AH/2},${a2y-ny*(AL/2-AH)-nx*AH/2}`} fill="#ff6b9d" /></g>;
}

function isInSel(selected, item) { return selected.some(s => s.type === item.type && s.idx === item.idx); }

const PLACE_MODES = [
  { key: 'column', label: '柱 [C]' },
  { key: 'wall',   label: '牆 [W]' },
  { key: 'door',   label: '門 [D]' },
  { key: 'window', label: '窗 [N]' },
];

export default function App() {
  const [rawWalls, setRawWalls] = useState([]);
  const [columns, setColumns] = useState([]);
  const [startPt, setStartPt] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [mode, setMode] = useState('column');
  const [colType, setColType] = useState('rc');
  const [dragging, setDragging] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [previewRotated, setPreviewRotated] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [dragWall, setDragWall] = useState(null);
  // dragWall: { wallIdx, origStart, origEnd, normal, mouseStart, active, limitMin, limitMax, snapPoints }
  const [wallDragPending, setWallDragPending] = useState(null);
  const wallDragPendingRef = useRef(null);
  // wallDragPending: { wallIdx, origStart, origEnd, info, mouseStart } — set on mousedown, promoted to dragWall on move
  const [snapIndicator, setSnapIndicator] = useState(null);
  const svgRef = useRef();
  const [viewTransform, setViewTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [panning, setPanning] = useState(null);

  const wallMiters = useMemo(() => computeAllMiters(rawWalls), [rawWalls]);

  const singleSel = selected.length === 1 ? selected[0] : null;
  const selWallObj = singleSel?.type === 'rawWall' ? rawWalls[singleSel.idx] : null;

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') {
        if (mode === 'select') { setSelected([]); }
        else if (mode === 'wall' && startPt) { setStartPt(null); }
        else if (suspended) { setSuspended(false); setStartPt(null); setSelected([]); setMode('select'); }
        else { setStartPt(null); setSelected([]); setSuspended(true); }
        return;
      }
      if (e.key === 'c' || e.key === 'C') { setMode('column'); setStartPt(null); setSelected([]); setSuspended(false); }
      if (e.key === 'w' || e.key === 'W') { setMode('wall');   setStartPt(null); setSelected([]); setSuspended(false); }
      if (e.key === 'd' || e.key === 'D') { setMode('door');   setStartPt(null); setSelected([]); setSuspended(false); }
      if (e.key === 'n' || e.key === 'N') { setMode('window'); setStartPt(null); setSelected([]); setSuspended(false); }
      if (e.key === ' ') {
        e.preventDefault();
        if (mode === 'column' || mode === 'select') {
          if (singleSel?.type === 'col') {
            setColumns(prev => { const next = [...prev]; next[singleSel.idx] = { ...next[singleSel.idx], rotated: !next[singleSel.idx].rotated }; return next; });
          } else if (mode === 'column') { setPreviewRotated(r => !r); }
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selected.length > 0) deleteSelected(selected); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selected, singleSel, mode, suspended, startPt]);

  function deleteSelected(sel) {
    if (!sel || sel.length === 0) return;
    const wallItems = sel.filter(s => s.type === 'rawWall').map(s => s.idx).sort((a, b) => b - a);
    const colItems  = sel.filter(s => s.type === 'col').map(s => s.idx).sort((a, b) => b - a);
    setRawWalls(prev => {
      let next = [...prev];
      for (const idx of wallItems) {
        const obj = next[idx];
        if (!obj) continue;
        if (obj.isDoor || obj.isWindow) {
          const left = next[idx - 1], right = next[idx + 1];
          if (left && right && !left.isDoor && !left.isWindow && !right.isDoor && !right.isWindow) {
            next.splice(idx - 1, 3, { start: left.start, end: right.end });
          }
        } else {
          next = next.filter((_, i) => i !== idx);
        }
      }
      return next;
    });
    setColumns(prev => prev.filter((_, i) => !colItems.includes(i)));
    setSelected([]);
  }

  function screenToWorld(sx, sy) {
    const svgH = svgRef.current?.clientHeight ?? 600;
    return {
      x: (sx - viewTransform.offsetX) / viewTransform.scale,
      y: (svgH - sy - viewTransform.offsetY) / viewTransform.scale,
    };
  }

  function worldToScreen(wx, wy) {
    const svgH = svgRef.current?.clientHeight ?? 600;
    return {
      x: wx * viewTransform.scale + viewTransform.offsetX,
      y: svgH - (wy * viewTransform.scale + viewTransform.offsetY),
    };
  }

  function getRawPt(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (svgRef.current.clientWidth / rect.width);
    const sy = (e.clientY - rect.top) * (svgRef.current.clientHeight / rect.height);
    return screenToWorld(sx, sy);
  }

  function getPoint(e) { const r = getRawPt(e); return { x: snap(r.x), y: snap(r.y) }; }

  function hitTest(pt) {
    for (let i = columns.length - 1; i >= 0; i--) { if (ptInCol(pt, columns[i])) return { type: 'col', idx: i }; }
    let minDist = Infinity, openingIdx = -1;
    rawWalls.forEach((w, i) => { if (!w.isDoor && !w.isWindow) return; const d = distToOpening(pt, w); if (d < 40 && d < minDist) { minDist = d; openingIdx = i; } });
    if (openingIdx !== -1) return { type: 'rawWall', idx: openingIdx };
    for (let i = rawWalls.length - 1; i >= 0; i--) { const w = rawWalls[i]; if (w.isDoor || w.isWindow) continue; if (ptBetweenWallLines(pt, w)) return { type: 'rawWall', idx: i }; }
    return null;
  }

  function handleMouseDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      setPanning({ startX: e.clientX, startY: e.clientY, origOffsetX: viewTransform.offsetX, origOffsetY: viewTransform.offsetY });
      return;
    }
    if (mode !== 'door' && mode !== 'window' && mode !== 'select') return;
    const rawPt = getRawPt(e);
    const pt = { x: snap(rawPt.x), y: snap(rawPt.y) };

    if (mode === 'select') {
      // Check for opening drag first
      let closestIdx = -1, minDist = Infinity;
      rawWalls.forEach((w, i) => {
        if (!w.isDoor && !w.isWindow) return;
        const d = distToOpening(pt, w);
        if (d < 40 && d < minDist) { minDist = d; closestIdx = i; }
      });
      if (closestIdx !== -1) {
        const group = findOpeningGroup(rawWalls, closestIdx);
        if (!group) return;
        const type = rawWalls[closestIdx].isDoor ? 'door' : 'window';
        const flipped = rawWalls[closestIdx].flipped || false;
        const wallsMerged = mergeOpening(rawWalls, group);
        setDragging({ wallsMerged, mergedWallIdx: group.leftIdx, type, flipped, dragStartPt: rawPt, pending: true });
        setSelected([]);
        e.stopPropagation();
        return;
      }
      // Check for wall drag (pending — only activate on mousemove)
      for (let i = rawWalls.length - 1; i >= 0; i--) {
        const w = rawWalls[i];
        if (w.isDoor || w.isWindow) continue;
        if (!ptBetweenWallLines(rawPt, w)) continue;
        const info = computeWallDragInfo(w, i, rawWalls, columns);
        console.log('wallDragPending candidate', i, info);  // 加這行
        if (!info) continue;
        const pending = {
          wallIdx: i,
          origStart: { ...w.start },
          origEnd: { ...w.end },
          info,
          mouseStart: rawPt,
        };
        setWallDragPending(pending);
        wallDragPendingRef.current = pending;
        return;
      }
      return;
    }

    // door / window mode
    if (selWallObj?.isDoor || selWallObj?.isWindow) {
      const mcx = (selWallObj.ptA.x + selWallObj.ptB.x) / 2, mcy = (selWallObj.ptA.y + selWallObj.ptB.y) / 2;
      const ix = mcx + selWallObj.nx * FLIP_ICON_OFFSET, iy = mcy + selWallObj.ny * FLIP_ICON_OFFSET;
      if (Math.sqrt((rawPt.x-ix)**2 + (rawPt.y-iy)**2) < 40) return;
    }
    let closestIdx = -1, minDist = Infinity;
    rawWalls.forEach((w, i) => { if (!w.isDoor && !w.isWindow) return; const d = distToOpening(pt, w); if (d < 40 && d < minDist) { minDist = d; closestIdx = i; } });
    if (closestIdx === -1) return;
    const group = findOpeningGroup(rawWalls, closestIdx);
    if (!group) return;
    const wallsMerged = mergeOpening(rawWalls, group);
    const type = rawWalls[closestIdx].isDoor ? 'door' : 'window';
    const flipped = rawWalls[closestIdx].flipped || false;
    setDragging({ wallsMerged, mergedWallIdx: group.leftIdx, type, flipped });
    setDragPreview(rawWalls[closestIdx]);
    setSelected([]);
    e.stopPropagation();
  }

function applyWallSnap(pt) {
  // Phase 1: centerline snap
  const SNAP_DIST = THICKNESS + 8;
  let best = null, bestD = SNAP_DIST;
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) continue;
    const n = getNorm(w.start, w.end);
    if (!n) continue;
    const t = ((pt.x - w.start.x) * n.dx + (pt.y - w.start.y) * n.dy) / (n.len * n.len);
    if (t < -0.01 || t > 1.01) continue;
    const tc = Math.max(0, Math.min(1, t));
    const cx = w.start.x + tc * n.dx, cy = w.start.y + tc * n.dy;
    const normalDist = Math.abs((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny);
    if (normalDist < bestD) { bestD = normalDist; best = { x: cx, y: cy }; }
  }
  if (best) return { pt: best, snapPt: best };

  // Phase 2: face snap — 游標靠近外緣，snap 到 centerline
  let faceBest = null, faceBestD = FACE_SNAP_EPS;
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) continue;
    const n = getNorm(w.start, w.end);
    if (!n) continue;
    const t = ((pt.x - w.start.x) * n.dx + (pt.y - w.start.y) * n.dy) / (n.len * n.len);
    if (t < -0.01 || t > 1.01) continue;
    const tc = Math.max(0, Math.min(1, t));
    const cx = w.start.x + tc * n.dx, cy = w.start.y + tc * n.dy;
    const normalDist = Math.abs((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny);
    // 游標在牆 body 內，不是外緣，跳過
    if (normalDist < THICKNESS / 2 - 2) continue;
    const faceDist = Math.abs(normalDist - THICKNESS / 2);
    if (faceDist < faceBestD) {
      faceBestD = faceDist;
      // snap 目標是 centerline，但紅圈顯示在外緣的投影點
      const sign = ((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny) >= 0 ? 1 : -1;
      const facePt = { x: cx + sign * n.nx * (THICKNESS / 2), y: cy + sign * n.ny * (THICKNESS / 2) };
      faceBest = { pt: { x: cx, y: cy }, snapPt: facePt };
    }
  }
  if (faceBest) return faceBest;

  return { pt, snapPt: null };
}

  function handleMouseMove(e) {
    if (panning) {
      const dx = e.clientX - panning.startX;
      const dy = e.clientY - panning.startY;
      setViewTransform(prev => ({ ...prev, offsetX: panning.origOffsetX + dx, offsetY: panning.origOffsetY + dy }));
      return;
    }
    let pt = getPoint(e);
    if (mode === 'wall' && startPt) pt = applyOrthoLock(pt, startPt);
    let wallSnapPt = null;
if (mode === 'wall') {
  const result = applyWallSnap(pt);
  pt = result.pt;
  wallSnapPt = result.snapPt;
}
setCursor(pt);
setSnapIndicator(wallSnapPt);

    // Promote wallDragPending to active dragWall after threshold
    if (wallDragPending && !dragWall) {
      const rawPt = getRawPt(e);
      const dx = rawPt.x - wallDragPending.mouseStart.x;
      const dy = rawPt.y - wallDragPending.mouseStart.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist >= 6) {
        const { wallIdx, origStart, origEnd, info, mouseStart } = wallDragPending;
        setDragWall({ wallIdx, origStart, origEnd, normal: info.normal, mouseStart, active: true, limitMin: info.limitMin, limitMax: info.limitMax, snapPoints: info.snapPoints });
        setSelected([{ type: 'rawWall', idx: wallIdx }]);
        if (wallDragPending) {
      setWallDragPending(null);
        wallDragPendingRef.current = null;
      return;
    }
      }
      return;
    }

    if (dragWall) {
      const rawPt = getRawPt(e);
      const dx = rawPt.x - dragWall.mouseStart.x;
      const dy = rawPt.y - dragWall.mouseStart.y;

      const { normal, limitMin, limitMax, snapPoints, origStart, origEnd } = dragWall;
      let delta = dx * normal.x + dy * normal.y;
      delta = Math.max(limitMin, Math.min(limitMax, delta));

      const SNAP_THRESHOLD = 12;
      const origNormalProj = origStart.x * normal.x + origStart.y * normal.y;
      let bestSnap = null, bestSnapDist = SNAP_THRESHOLD, bestSnapPt = null;
      for (const sp of snapPoints) {
        const spProj = sp.x * normal.x + sp.y * normal.y;
        const snapDelta = spProj - origNormalProj;
        const d = Math.abs(delta - snapDelta);
        if (d < bestSnapDist) { bestSnapDist = d; bestSnap = snapDelta; bestSnapPt = sp; }
      }
      if (bestSnap !== null) delta = Math.max(limitMin, Math.min(limitMax, bestSnap));
      setSnapIndicator(bestSnapPt ?? null);
      setRawWalls(prev => {
        const next = [...prev];
        next[dragWall.wallIdx] = {
          ...next[dragWall.wallIdx],
          start: { x: origStart.x + delta * normal.x, y: origStart.y + delta * normal.y },
          end:   { x: origEnd.x   + delta * normal.x, y: origEnd.y   + delta * normal.y },
        };
        return next;
      });
      return;
    }
if (mode !== 'wall') setSnapIndicator(null);
    if (!dragging) return;
    if (dragging.pending) {
      const dx = getRawPt(e).x - dragging.dragStartPt.x;
      const dy = getRawPt(e).y - dragging.dragStartPt.y;
      if (Math.sqrt(dx*dx + dy*dy) < (DOOR_WIDTH / 2)+10) return;
      setDragging(prev => ({ ...prev, pending: false }));
    }
    const { wallsMerged, mergedWallIdx, type, flipped } = dragging;
    const wall = wallsMerged[mergedWallIdx];
    if (!wall || wall.isDoor || wall.isWindow) return;
    const n = getNorm(wall.start, wall.end);
    if (!n) return;
    const WIDTH = type === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
    const halfT = (WIDTH / 2) / n.len;
    let t = projectOnWall(pt, wall);
    t = Math.max(halfT, Math.min(1 - halfT, t));
    const tA = t - halfT, tB = t + halfT;
    const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
    const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
    setDragPreview({ [type === 'door' ? 'isDoor' : 'isWindow']: true, ptA, ptB, nx: n.nx, ny: n.ny, ux: n.dx / n.len, uy: n.dy / n.len, flipped });
  }

  function handleMouseUp(e) {
    if (panning) { setPanning(null); return; }
    if (wallDragPending) {
      setWallDragPending(null);
       wallDragPendingRef.current = null;
      return;
    }
    if (dragWall) {
      setDragWall(null);
      return;
    }
    if (!dragging) return;
    const pt = getPoint(e);
    const { wallsMerged, mergedWallIdx, type, flipped } = dragging;
    setRawWalls(placeOpening(wallsMerged, mergedWallIdx, pt, type, flipped));
    setDragging(null); setDragPreview(null);
  }

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setViewTransform(prev => ({
      scale: prev.scale * factor,
      offsetX: sx - (sx - prev.offsetX) * factor,
      offsetY: sy - (sy - prev.offsetY) * factor,
    }));
  }

  function handleFlip() {
    if (singleSel?.type !== 'rawWall') return;
    setRawWalls(prev => { const next = [...prev]; next[singleSel.idx] = { ...next[singleSel.idx], flipped: !next[singleSel.idx].flipped }; return next; });
  }

  function handleClick(e) {
     console.log('handleClick fired', { mode, dragging: !!dragging, dragWall: !!dragWall });
    if (dragging) return;
    const rawPt = getRawPt(e);
    const pt = { x: snap(rawPt.x), y: snap(rawPt.y) };
    const ctrlHeld = e.ctrlKey || e.metaKey;

    if (selWallObj?.isDoor || selWallObj?.isWindow) {
      const mcx = (selWallObj.ptA.x + selWallObj.ptB.x) / 2, mcy = (selWallObj.ptA.y + selWallObj.ptB.y) / 2;
      const ix = mcx + selWallObj.nx * FLIP_ICON_OFFSET, iy = mcy + selWallObj.ny * FLIP_ICON_OFFSET;
      if (Math.sqrt((rawPt.x-ix)**2 + (rawPt.y-iy)**2) < 25) { handleFlip(); return; }
    }

    if (suspended) { setSuspended(false); return; }

    if (mode === 'select') {
      const hit = hitTest(rawPt);
       console.log('hitTest result', hit, pt);
      if (hit) {
        if (ctrlHeld) {
          setSelected(prev => isInSel(prev, hit) ? prev.filter(s => !(s.type === hit.type && s.idx === hit.idx)) : [...prev, hit]);
        } else {
          setSelected(prev => prev.length === 1 && isInSel(prev, hit) ? [] : [hit]);
        }
      } else {
        if (!ctrlHeld) setSelected([]);
      }
      return;
    }

    if (mode === 'column') {
      const newCol = { cx: pt.x, cy: pt.y, type: colType, rotated: previewRotated };
      setRawWalls(prev => splitAllWallsByColumn(prev, newCol));
      setColumns(prev => [...prev, newCol]);
      return;
    }

    if (mode === 'wall') {
      if (!startPt) { setStartPt(pt); return; }
      const endPt = applyOrthoLock(pt, startPt);
      const n = getNorm(startPt, endPt);
      if (n && n.len > 5) {
        const newWall = { start: startPt, end: endPt };
        const colSegs = splitWallByColumns(newWall, columns);
        setRawWalls(prev => {
          let current = prev;
          const allNewSegs = [];
          for (const seg of colSegs) {
            const { newSegments, updatedWalls } = splitByWallIntersections(seg, current);
            current = updatedWalls;
            allNewSegs.push(...newSegments);
          }
          return [...current, ...allNewSegs];
        });
      }
      setStartPt(endPt);
      return;
    }

    if (mode === 'door' || mode === 'window') {
      const THRESHOLD = THICKNESS / 2 + 5;
      const idx = rawWalls.findIndex(w => !w.isDoor && !w.isWindow && distToWall(pt, w) < THRESHOLD);
      if (idx !== -1) setRawWalls(prev => placeOpening(prev, idx, pt, mode));
      return;
    }
  }

  const preview = startPt && cursor && !dragging && mode === 'wall' && !suspended ? computeWallLines(startPt, cursor) : null;
  const colPreview = mode === 'column' && cursor && !suspended ? { cx: cursor.x, cy: cursor.y, type: colType, rotated: previewRotated } : null;
  const DOOR_WIN_THRESHOLD = THICKNESS / 2 + 5;
  const openingPreview = !suspended && cursor && (mode === 'door' || mode === 'window') ? (() => {
    const idx = rawWalls.findIndex(w => !w.isDoor && !w.isWindow && distToWall(cursor, w) < DOOR_WIN_THRESHOLD);
    if (idx === -1) return null;
    const wall = rawWalls[idx];
    const n = getNorm(wall.start, wall.end);
    if (!n) return null;
    const WIDTH = mode === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
    const halfT = (WIDTH / 2) / n.len;
    let t = projectOnWall(cursor, wall);
    t = Math.max(halfT, Math.min(1 - halfT, t));
    const tA = t - halfT, tB = t + halfT;
    const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
    const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
    return { isDoor: mode === 'door', isWindow: mode === 'window', ptA, ptB, nx: n.nx, ny: n.ny, ux: n.dx/n.len, uy: n.dy/n.len, flipped: false };
  })() : null;

  function getHint() {
    const n = selected.length;
    if (n > 1) return `已選取 ${n} 個物件 — Delete 全部刪除，ESC 清除選取`;
    if (n === 1) {
      const obj = singleSel?.type === 'rawWall' ? rawWalls[singleSel.idx] : null;
      if (singleSel?.type === 'col') return '已選取柱 — 空白鍵旋轉，Delete 刪除，Ctrl+點擊複選';
      if (obj?.isDoor)   return '已選取門 — 點雙箭頭反轉，Delete 刪除，Ctrl+點擊複選';
      if (obj?.isWindow) return '已選取窗 — 點雙箭頭反轉，Delete 刪除，Ctrl+點擊複選';
      if (obj) return '已選取牆段 — 拖拉平移，Delete 刪除，Ctrl+點擊複選';
    }
    if (suspended) return `已暫停（${mode === 'column' ? '柱' : mode === 'wall' ? '牆' : mode === 'door' ? '門' : '窗'}模式）— 點擊繼續放置，再按 ESC 回到選取`;
    if (mode === 'select')  return '選取模式 — 點擊選取，Ctrl+點擊複選';
    if (mode === 'column')  return `放置 ${colType === 'rc' ? 'RC 柱' : 'H 鋼柱'}（80×100）— 點擊放置，空白鍵旋轉，ESC 暫停`;
    if (mode === 'wall')    return startPt ? '點第二點完成牆段（鎖定正交），ESC 取消本段' : '點空白處開始畫牆，ESC 暫停';
    if (mode === 'door')    return dragging ? '拖拉中⋯ 放開確認' : '靠近牆放置門，ESC 暫停';
    if (mode === 'window')  return dragging ? '拖拉中⋯ 放開確認' : '靠近牆放置窗，ESC 暫停';
    return '';
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f0f0f', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8, zIndex: 10, alignItems: 'center' }}>
        {PLACE_MODES.map(m => (
          <button key={m.key}
            onClick={() => { setMode(m.key); setStartPt(null); setSelected([]); setSuspended(false); }}
            style={{ padding: '6px 16px', background: mode === m.key ? '#00d4aa22' : '#1a1a1a', color: mode === m.key ? '#00d4aa' : '#888', border: `1px solid ${mode === m.key ? '#00d4aa66' : '#333'}`, borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            {m.label}
          </button>
        ))}
        {mode === 'column' && (
          <select value={colType} onChange={e => setColType(e.target.value)}
            style={{ padding: '6px 10px', background: '#1a1a1a', color: '#00d4aa', border: '1px solid #00d4aa66', borderRadius: 6, cursor: 'pointer', fontSize: 13, outline: 'none' }}>
            <option value="rc">RC 柱</option>
            <option value="h">H 鋼柱</option>
          </select>
        )}
        {selected.length > 0 && (
          <button onClick={() => deleteSelected(selected)}
            style={{ padding: '6px 16px', background: '#ff6b9d22', color: '#ff6b9d', border: '1px solid #ff6b9d66', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            刪除 {selected.length > 1 ? `(${selected.length})` : ''} [Del]
          </button>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 16, left: 16, color: '#555', fontSize: 12 }}>{getHint()}</div>

      <svg ref={svgRef}
        style={{ width: '100%', height: '100%', cursor: panning ? 'grabbing' : dragging ? 'grabbing' : 'crosshair', touchAction: 'none' }}
        onClick={handleClick} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onWheel={handleWheel}>

        {(() => {
          const { x: ox, y: oy } = worldToScreen(0, 0);
          return (
            <g>
              <line x1={ox - 20} y1={oy} x2={ox + 20} y2={oy} stroke="#444" strokeWidth="1" />
              <line x1={ox} y1={oy - 20} x2={ox} y2={oy + 20} stroke="#444" strokeWidth="1" />
              <circle cx={ox} cy={oy} r={3} fill="#666" />
            </g>
          );
        })()}

        <g transform={`matrix(${viewTransform.scale}, 0, 0, ${-viewTransform.scale}, ${viewTransform.offsetX}, ${(svgRef.current?.clientHeight ?? 600) - viewTransform.offsetY})`}>
          {columns.map((col, i) => {
            const isSel = isInSel(selected, { type: 'col', idx: i });
            return col.type === 'rc'
              ? <RCColumn key={`col-${i}`} col={col} isSelected={isSel} rawWalls={rawWalls} />
              : <HColumn  key={`col-${i}`} col={col} isSelected={isSel} />;
          })}

          {rawWalls.map((w, i) => {
            const isSel = isInSel(selected, { type: 'rawWall', idx: i });
            if (w.isDoor) return <DoorSegment key={i} door={w} isSelected={isSel} />;
            if (w.isWindow) return <WindowSegment key={i} win={w} isSelected={isSel} />;
            return <WallSegment key={i} wall={w} isSelected={isSel} columns={columns} miter={wallMiters[i] || {}} rawWalls={rawWalls} />;
          })}

          {selWallObj && (selWallObj.isDoor || selWallObj.isWindow) && <FlipIcon obj={selWallObj} />}
          {dragging && dragPreview && (dragPreview.isDoor ? <DoorSegment door={dragPreview} isPreview /> : <WindowSegment win={dragPreview} isPreview />)}
          {preview && <g opacity={0.4}><line {...preview.line1} stroke="#00d4aa" strokeWidth="1.5" /><line {...preview.line2} stroke="#00d4aa" strokeWidth="1.5" /></g>}
          {colPreview && (colPreview.type === 'rc' ? <RCColumn col={colPreview} isSelected={false} isPreview rawWalls={[]} /> : <HColumn col={colPreview} isSelected={false} isPreview />)}
          {openingPreview && !dragging && (openingPreview.isDoor ? <DoorSegment door={openingPreview} isPreview /> : <WindowSegment win={openingPreview} isPreview />)}
          {snapIndicator && (
            <circle cx={snapIndicator.x} cy={snapIndicator.y} r={6} stroke="#ff4466" strokeWidth="1.5" fill="none" />
          )}
        </g>
      </svg>
    </div>
  );
}