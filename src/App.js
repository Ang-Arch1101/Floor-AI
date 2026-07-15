import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  GRID,
  THICKNESS,
  DOOR_WIDTH,
  WINDOW_WIDTH,
  WINDOW_INSET,
  GLASS_OFFSET,
  FLIP_ICON_OFFSET,
  COL_W,
  COL_H,
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
  splitByWallIntersections,
  getWallGaps,
  getColGaps,
  clipOffsetLineOutsideCol,
  computeAllMiters,
  computeWallDragInfo,
  clipStubEnd,
  buildExportGeometry,
} from './geometry';


const API_BASE = 'http://localhost:5000';
// jsdom smoke test（NODE_ENV=test）或無 fetch 的環境不啟用前後端同步
const SYNC_DISABLED = typeof fetch !== 'function' || process.env.NODE_ENV === 'test';

// 7 碼 base36 亂數 id；MCP 端用 uuid hex 前 7 碼，同為短字串格式、可互通
function genId() { return Math.random().toString(36).slice(2, 9); }

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

const DIM_OFFSET = 30;
const ARROW_SIZE = 6;

function WallDimAnnotation({ wall, onClickValue }) {
  const n = getNorm(wall.start, wall.end);
  if (!n) return null;
  const { nx, ny } = n;
  const ux = n.dx / n.len, uy = n.dy / n.len;
  const dimColor = '#ffcc00';

  const dx1 = wall.start.x + nx * DIM_OFFSET, dy1 = wall.start.y + ny * DIM_OFFSET;
  const dx2 = wall.end.x   + nx * DIM_OFFSET, dy2 = wall.end.y   + ny * DIM_OFFSET;

  const extFrom = (wall.thickness ?? THICKNESS) / 2, extTo = DIM_OFFSET + 4;
  const ext1 = { x1: wall.start.x + nx*extFrom, y1: wall.start.y + ny*extFrom, x2: wall.start.x + nx*extTo, y2: wall.start.y + ny*extTo };
  const ext2 = { x1: wall.end.x   + nx*extFrom, y1: wall.end.y   + ny*extFrom, x2: wall.end.x   + nx*extTo, y2: wall.end.y   + ny*extTo };

  const hw = ARROW_SIZE / 2;
  const a1 = `${dx1},${dy1} ${dx1-ux*ARROW_SIZE+nx*hw},${dy1-uy*ARROW_SIZE+ny*hw} ${dx1-ux*ARROW_SIZE-nx*hw},${dy1-uy*ARROW_SIZE-ny*hw}`;
  const a2 = `${dx2},${dy2} ${dx2+ux*ARROW_SIZE+nx*hw},${dy2+uy*ARROW_SIZE+ny*hw} ${dx2+ux*ARROW_SIZE-nx*hw},${dy2+uy*ARROW_SIZE-ny*hw}`;

  const textX = (dx1 + dx2) / 2, textY = (dy1 + dy2) / 2;
  const length = Math.round(n.len);

  return (
    <g>
      <line {...ext1} stroke={dimColor} strokeWidth="0.8" />
      <line {...ext2} stroke={dimColor} strokeWidth="0.8" />
      <line x1={dx1} y1={dy1} x2={dx2} y2={dy2} stroke={dimColor} strokeWidth="0.8" />
      <polygon points={a1} fill={dimColor} />
      <polygon points={a2} fill={dimColor} />
      <g transform={`translate(${textX},${textY}) scale(1,-1)`}>
        <rect x={-18} y={-9} width={36} height={14} fill="#0f0f0f" rx="2" />
        <text x={0} y={2} textAnchor="middle" fontSize={11} fill={dimColor}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={e => { e.stopPropagation(); onClickValue(e); }}>
          {length}
        </text>
      </g>
    </g>
  );
}

function WallSegment({ wall, isSelected, columns = [], miter = {}, rawWalls = [] }) {
  const geo = computeWallLines(wall.start, wall.end, wall.thickness ?? THICKNESS);
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
  const h = (door.thickness ?? THICKNESS) / 2, color = isSelected ? '#ff6b9d' : '#00d4aa';
  const dx = ptB.x - ptA.x, dy = ptB.y - ptA.y;
  const span = Math.hypot(dx, dy); // actual door leaf length = swing arc radius
  const doorEndX = ptA.x + (flipped ? -dy : dy), doorEndY = ptA.y + (flipped ? dx : -dx);
  const arcPath = `M ${doorEndX} ${doorEndY} A ${span} ${span} 0 0 ${flipped ? 0 : 1} ${ptB.x} ${ptB.y}`;
  return <g opacity={isPreview ? 0.5 : 1}><line x1={ptA.x+nx*h} y1={ptA.y+ny*h} x2={ptA.x-nx*h} y2={ptA.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptB.x+nx*h} y1={ptB.y+ny*h} x2={ptB.x-nx*h} y2={ptB.y-ny*h} stroke={color} strokeWidth="1.5" /><line x1={ptA.x} y1={ptA.y} x2={doorEndX} y2={doorEndY} stroke={color} strokeWidth="1.5" /><path d={arcPath} stroke={color} strokeWidth="1" fill="none" strokeDasharray="4 3" /></g>;
}

function WindowSegment({ win, isPreview = false, isSelected = false }) {
  const { ptA, ptB, nx, ny, ux, uy } = win;
  const h = (win.thickness ?? THICKNESS) / 2, color = isSelected ? '#ff6b9d' : '#00d4aa';
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

// 仿 Revit ribbon：一組工具按鈕 + 下方的群組名稱
function RibbonGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '0 10px', borderRight: '1px solid #262626' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>{children}</div>
      <div style={{ fontSize: 10, color: '#555', textAlign: 'center', marginTop: 4, userSelect: 'none' }}>{label}</div>
    </div>
  );
}

// 性質面板的一列「參數名：值」
function PropRow({ k, v }) {
  return (
    <div style={{ display: 'flex', padding: '3px 0', borderBottom: '1px solid #1e1e1e', fontSize: 12 }}>
      <span style={{ color: '#666', width: 64, flexShrink: 0 }}>{k}</span>
      <span style={{ color: '#bbb', flex: 1 }}>{v}</span>
    </div>
  );
}

const PLACE_MODES = [
  { key: 'column', label: '柱 [C]' },
  { key: 'wall',   label: '牆 [W]' },
  { key: 'door',   label: '門 [D]' },
  { key: 'window', label: '窗 [N]' },
];

export default function App() {
  const [rawWalls, setRawWalls] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_rawWalls') ?? 'null') ?? []; } catch { return []; }
  });
  const [columns, setColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_columns') ?? 'null') ?? []; } catch { return []; }
  });
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
  const [editingDim, setEditingDim] = useState(null);
  const svgRef = useRef();
  const [viewTransform, setViewTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [panning, setPanning] = useState(null);
  const [endpointDrag, setEndpointDrag] = useState(null);
  // 匯入 DXF 的來源圖層外觀（name→{color,linetype,lineweight}），匯出時放回同樣設定
  const [importedLayers, setImportedLayers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_importedLayers') ?? 'null') ?? []; } catch { return []; }
  });
  const [wallTypes, setWallTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_wallTypes') ?? 'null') ?? [{ id: 'wt1', name: '一般牆', thickness: 15 }]; } catch { return [{ id: 'wt1', name: '一般牆', thickness: 15 }]; }
  });
  const [activeWallTypeId, setActiveWallTypeId] = useState('wt1');
  const [colTypes, setColTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_colTypes') ?? 'null') ?? [{ id: 'ct1', name: 'RC 柱', w: 80, h: 100 }]; } catch { return [{ id: 'ct1', name: 'RC 柱', w: 80, h: 100 }]; }
  });
  const [activeColTypeId, setActiveColTypeId] = useState('ct1');
  const [doorTypes, setDoorTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_doorTypes') ?? 'null') ?? [{ id: 'dt1', name: '單開門', width: 80 }]; } catch { return [{ id: 'dt1', name: '單開門', width: 80 }]; }
  });
  const [activeDoorTypeId, setActiveDoorTypeId] = useState('dt1');
  const [windowTypes, setWindowTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('floorAI_windowTypes') ?? 'null') ?? [{ id: 'nt1', name: '一般窗', width: 80 }]; } catch { return [{ id: 'nt1', name: '一般窗', width: 80 }]; }
  });
  const [activeWindowTypeId, setActiveWindowTypeId] = useState('nt1');
  const [wallTypePanel, setWallTypePanel] = useState(false);
  const [wallTypeForm, setWallTypeForm] = useState({ name: '', thickness: '' });
  const [colTypePanel, setColTypePanel] = useState(false);
  const [colTypeForm, setColTypeForm] = useState({ name: '', w: '', h: '' });
  const [doorTypePanel, setDoorTypePanel] = useState(false);
  const [doorTypeForm, setDoorTypeForm] = useState({ name: '', width: '' });
  const [windowTypePanel, setWindowTypePanel] = useState(false);
  const [windowTypeForm, setWindowTypeForm] = useState({ name: '', width: '' });
  const [editingWallTypeId, setEditingWallTypeId] = useState(null);
  const [editingWallTypeForm, setEditingWallTypeForm] = useState({});
  const [editingColTypeId, setEditingColTypeId] = useState(null);
  const [editingColTypeForm, setEditingColTypeForm] = useState({});
  const [editingDoorTypeId, setEditingDoorTypeId] = useState(null);
  const [editingDoorTypeForm, setEditingDoorTypeForm] = useState({});
  const [editingWindowTypeId, setEditingWindowTypeId] = useState(null);
  const [editingWindowTypeForm, setEditingWindowTypeForm] = useState({});
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const wallMiters = useMemo(() => computeAllMiters(rawWalls), [rawWalls]);

  const singleSel = selected.length === 1 ? selected[0] : null;
  const selWallObj = singleSel?.type === 'rawWall' ? rawWalls[singleSel.idx] : null;

  useEffect(() => {
    function handleKey(e) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        if (mode === 'select') { setSelected([]); }
        else if (mode === 'wall' && startPt) { setStartPt(null); }
        else if (suspended) { setSuspended(false); setStartPt(null); setSelected([]); setMode('select'); }
        else { setStartPt(null); setSelected([]); setSuspended(false); setMode('select'); }
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, singleSel, mode, suspended, startPt, rawWalls, columns, history, future]);

  useEffect(() => {
    localStorage.setItem('floorAI_rawWalls', JSON.stringify(rawWalls));
    localStorage.setItem('floorAI_columns', JSON.stringify(columns));
    localStorage.setItem('floorAI_wallTypes', JSON.stringify(wallTypes));
    localStorage.setItem('floorAI_colTypes', JSON.stringify(colTypes));
    localStorage.setItem('floorAI_doorTypes', JSON.stringify(doorTypes));
    localStorage.setItem('floorAI_windowTypes', JSON.stringify(windowTypes));
    localStorage.setItem('floorAI_importedLayers', JSON.stringify(importedLayers));
  }, [rawWalls, columns, wallTypes, colTypes, doorTypes, windowTypes, importedLayers]);

  // 補穩定 id：舊 localStorage 資料、DXF 匯入、開口切段產生的新牆段，
  // 缺 id 就補一個（已有的不動）。MCP server 靠這個 id 指定要改/刪哪個物件。
  useEffect(() => {
    if (rawWalls.some(w => !w.id)) setRawWalls(prev => prev.map(w => w.id ? w : { ...w, id: genId() }));
    if (columns.some(c => !c.id)) setColumns(prev => prev.map(c => c.id ? c : { ...c, id: genId() }));
  }, [rawWalls, columns]);

  // ── 前後端狀態同步（backend/floor_plan.json，MCP server 操控畫布的通道）──
  // 機制：輪詢 + 版本號。GET 到的 version 比 syncVersion 新 → 套用到畫布；
  // 本地變動 debounce 400ms 後 POST（帶 baseVersion 樂觀鎖），拖曳中不送；
  // POST 撞到 409（多半是 MCP 剛寫入）→ 套用後端版本收斂。
  const syncVersion = useRef(0);
  const applyingRemote = useRef(false);
  const interacting = !!(dragging || dragWall || wallDragPending || endpointDrag);
  const interactingRef = useRef(false);
  interactingRef.current = interacting;

  function applyServerState(s) {
    applyingRemote.current = true;
    syncVersion.current = s.version ?? 0;
    setSelected([]); // 選取以索引記錄，整包替換後不可靠
    setRawWalls(s.rawWalls ?? []);
    setColumns(s.columns ?? []);
    if (s.wallTypes?.length) setWallTypes(s.wallTypes);
    if (s.colTypes?.length) setColTypes(s.colTypes);
    if (s.doorTypes?.length) setDoorTypes(s.doorTypes);
    if (s.windowTypes?.length) setWindowTypes(s.windowTypes);
  }

  useEffect(() => {
    if (SYNC_DISABLED) return;
    const iv = setInterval(async () => {
      if (interactingRef.current) return;
      try {
        const res = await fetch(`${API_BASE}/api/state`);
        if (!res.ok) return;
        const s = await res.json();
        if ((s.version ?? 0) > syncVersion.current) applyServerState(s);
      } catch { /* 後端沒開就靜默略過 */ }
    }, 1000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (SYNC_DISABLED) return;
    if (applyingRemote.current) { applyingRemote.current = false; return; } // 這批變更來自後端，不用送回去
    if (interacting) return; // 拖曳結束時 interacting 變化會再進來一次
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseVersion: syncVersion.current, rawWalls, columns, wallTypes, colTypes, doorTypes, windowTypes }),
        });
        if (res.status === 409) {
          const data = await res.json().catch(() => null);
          if (data?.state) applyServerState(data.state);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (typeof data.version === 'number') syncVersion.current = data.version;
        }
      } catch { /* 後端沒開就靜默略過 */ }
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawWalls, columns, wallTypes, colTypes, doorTypes, windowTypes, interacting]);

  function saveHistory() {
    setHistory(prev => [...prev.slice(-49), { rawWalls, columns }]);
    setFuture([]);
  }

  function undo() {
    if (history.length === 0) return;
    setFuture(f => [{ rawWalls, columns }, ...f]);
    setRawWalls(history[history.length - 1].rawWalls);
    setColumns(history[history.length - 1].columns);
    setHistory(h => h.slice(0, -1));
  }

  function redo() {
    if (future.length === 0) return;
    setHistory(h => [...h, { rawWalls, columns }]);
    setRawWalls(future[0].rawWalls);
    setColumns(future[0].columns);
    setFuture(f => f.slice(1));
  }

  function applyNewLength(wallIdx, newLen) {
    setRawWalls(prev => {
      const wall = prev[wallIdx];
      const n = getNorm(wall.start, wall.end);
      if (!n || newLen <= 0) return prev;
      const fixedEnd = getFixedEnd(wall, prev);
      const ux = n.dx / n.len, uy = n.dy / n.len;
      const next = [...prev];
      if (fixedEnd === 'start') {
        next[wallIdx] = { ...wall, end: { x: wall.start.x + ux * newLen, y: wall.start.y + uy * newLen } };
      } else if (fixedEnd === 'end') {
        next[wallIdx] = { ...wall, start: { x: wall.end.x - ux * newLen, y: wall.end.y - uy * newLen } };
      } else {
        const cx = (wall.start.x + wall.end.x) / 2;
        const cy = (wall.start.y + wall.end.y) / 2;
        const h = newLen / 2;
        next[wallIdx] = { ...wall, start: { x: cx - ux * h, y: cy - uy * h }, end: { x: cx + ux * h, y: cy + uy * h } };
      }
      return next;
    });
  }

  function handleClear() {
    if (!window.confirm('清除所有牆與柱？此動作無法復原。')) return;
    saveHistory();
    setRawWalls([]);
    setColumns([]);
  }

  function handleAddWallType() {
    const t = parseInt(wallTypeForm.thickness);
    if (!wallTypeForm.name || isNaN(t) || t <= 0) return;
    const id = `wt${Date.now()}`;
    setWallTypes(prev => [...prev, { id, name: wallTypeForm.name, thickness: t }]);
    setActiveWallTypeId(id);
    setWallTypeForm({ name: '', thickness: '' });
    setWallTypePanel(false);
  }

  function handleAddColType() {
    const w = parseInt(colTypeForm.w), h = parseInt(colTypeForm.h);
    if (!colTypeForm.name || isNaN(w) || w <= 0 || isNaN(h) || h <= 0) return;
    const id = `ct${Date.now()}`;
    setColTypes(prev => [...prev, { id, name: colTypeForm.name, w, h }]);
    setActiveColTypeId(id);
    setColTypeForm({ name: '', w: '', h: '' });
    setColTypePanel(false);
  }

  function handleEditWallType(id, name, thickness) {
    saveHistory();
    setWallTypes(prev => prev.map(t => t.id === id ? { ...t, name, thickness } : t));
    setRawWalls(prev => prev.map(w => w.typeId === id ? { ...w, thickness } : w));
    setEditingWallTypeId(null);
  }

  function handleDeleteWallType(id) {
    if (wallTypes.length <= 1) return;
    const count = rawWalls.filter(w => !w.isDoor && !w.isWindow && w.typeId === id).length;
    if (count > 0 && !window.confirm(`${count} 個牆段使用此種類，刪除後將改為預設種類。繼續？`)) return;
    saveHistory();
    const fallback = wallTypes.find(t => t.id !== id);
    setRawWalls(prev => prev.map(w => w.typeId === id ? { ...w, typeId: fallback.id, thickness: fallback.thickness } : w));
    setWallTypes(prev => prev.filter(t => t.id !== id));
    if (activeWallTypeId === id) setActiveWallTypeId(fallback.id);
  }

  function handleEditColType(id, name, w, h) {
    saveHistory();
    setColTypes(prev => prev.map(t => t.id === id ? { ...t, name, w, h } : t));
    setColumns(prev => prev.map(c => c.typeId === id ? { ...c, w, h } : c));
    setEditingColTypeId(null);
  }

  function handleDeleteColType(id) {
    if (colTypes.length <= 1) return;
    const count = columns.filter(c => c.typeId === id).length;
    if (count > 0 && !window.confirm(`${count} 個柱使用此種類，刪除後將改為預設種類。繼續？`)) return;
    saveHistory();
    const fallback = colTypes.find(t => t.id !== id);
    setColumns(prev => prev.map(c => c.typeId === id ? { ...c, typeId: fallback.id, w: fallback.w, h: fallback.h } : c));
    setColTypes(prev => prev.filter(t => t.id !== id));
    if (activeColTypeId === id) setActiveColTypeId(fallback.id);
  }

  function handleAddDoorType() {
    const w = parseInt(doorTypeForm.width);
    if (!doorTypeForm.name || isNaN(w) || w <= 0) return;
    const id = `dt${Date.now()}`;
    setDoorTypes(prev => [...prev, { id, name: doorTypeForm.name, width: w }]);
    setActiveDoorTypeId(id);
    setDoorTypeForm({ name: '', width: '' });
    setDoorTypePanel(false);
  }

  // Edits the type definition (affects future placements); existing openings
  // keep their baked-in geometry/width — re-flowing them is a deferred stretch.
  function handleEditDoorType(id, name, width) {
    setDoorTypes(prev => prev.map(t => t.id === id ? { ...t, name, width } : t));
    setEditingDoorTypeId(null);
  }

  function handleDeleteDoorType(id) {
    if (doorTypes.length <= 1) return;
    const count = rawWalls.filter(w => w.isDoor && w.typeId === id).length;
    if (count > 0 && !window.confirm(`${count} 個門使用此種類，刪除後將改為預設種類。繼續？`)) return;
    saveHistory();
    const fallback = doorTypes.find(t => t.id !== id);
    setRawWalls(prev => prev.map(w => (w.isDoor && w.typeId === id) ? { ...w, typeId: fallback.id } : w));
    setDoorTypes(prev => prev.filter(t => t.id !== id));
    if (activeDoorTypeId === id) setActiveDoorTypeId(fallback.id);
  }

  function handleAddWindowType() {
    const w = parseInt(windowTypeForm.width);
    if (!windowTypeForm.name || isNaN(w) || w <= 0) return;
    const id = `nt${Date.now()}`;
    setWindowTypes(prev => [...prev, { id, name: windowTypeForm.name, width: w }]);
    setActiveWindowTypeId(id);
    setWindowTypeForm({ name: '', width: '' });
    setWindowTypePanel(false);
  }

  function handleEditWindowType(id, name, width) {
    setWindowTypes(prev => prev.map(t => t.id === id ? { ...t, name, width } : t));
    setEditingWindowTypeId(null);
  }

  function handleDeleteWindowType(id) {
    if (windowTypes.length <= 1) return;
    const count = rawWalls.filter(w => w.isWindow && w.typeId === id).length;
    if (count > 0 && !window.confirm(`${count} 個窗使用此種類，刪除後將改為預設種類。繼續？`)) return;
    saveHistory();
    const fallback = windowTypes.find(t => t.id !== id);
    setRawWalls(prev => prev.map(w => (w.isWindow && w.typeId === id) ? { ...w, typeId: fallback.id } : w));
    setWindowTypes(prev => prev.filter(t => t.id !== id));
    if (activeWindowTypeId === id) setActiveWindowTypeId(fallback.id);
  }

  function deleteSelected(sel) {
    if (!sel || sel.length === 0) return;
    saveHistory();
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
            next.splice(idx - 1, 3, { start: left.start, end: right.end, typeId: left.typeId, thickness: left.thickness, layer: left.layer });
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
      // Check for endpoint drag (handle at wall start/end)
      if (singleSel?.type === 'rawWall') {
        const selW = rawWalls[singleSel.idx];
        if (selW && !selW.isDoor && !selW.isWindow) {
          const rect = svgRef.current.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const sp = worldToScreen(selW.start.x, selW.start.y);
          const ep = worldToScreen(selW.end.x,   selW.end.y);
          const dStart = Math.hypot(sx - sp.x, sy - sp.y);
          const dEnd   = Math.hypot(sx - ep.x, sy - ep.y);
          if (dStart < 10 || dEnd < 10) {
            saveHistory();
            setEndpointDrag({ wallIdx: singleSel.idx, endpoint: dStart <= dEnd ? 'start' : 'end' });
            e.stopPropagation();
            return;
          }
        }
      }
      // Check for wall drag (pending — only activate on mousemove)
      for (let i = rawWalls.length - 1; i >= 0; i--) {
        const w = rawWalls[i];
        if (w.isDoor || w.isWindow) continue;
        if (!ptBetweenWallLines(rawPt, w)) continue;
        const info = computeWallDragInfo(w, i, rawWalls, columns);
        if (!info) continue;
        const pending = {
          wallIdx: i,
          origStart: { ...w.start },
          origEnd: { ...w.end },
          info,
          mouseStart: rawPt,
        };
        saveHistory();
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
  let best = null, bestD = THICKNESS + 8;
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) continue;
    const wt = w.thickness ?? THICKNESS;
    const snapDist = wt + 8;
    const n = getNorm(w.start, w.end);
    if (!n) continue;
    const t = ((pt.x - w.start.x) * n.dx + (pt.y - w.start.y) * n.dy) / (n.len * n.len);
    if (t < -0.01 || t > 1.01) continue;
    const tc = Math.max(0, Math.min(1, t));
    const cx = w.start.x + tc * n.dx, cy = w.start.y + tc * n.dy;
    const normalDist = Math.abs((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny);
    if (normalDist < snapDist && normalDist < bestD) { bestD = normalDist; best = { x: cx, y: cy }; }
  }
  if (best) return { pt: best, snapPt: best };

  // Phase 2: face snap — 游標靠近外緣，snap 到 centerline
  let faceBest = null, faceBestD = Infinity;
  for (const w of rawWalls) {
    if (w.isDoor || w.isWindow) continue;
    const wt = w.thickness ?? THICKNESS;
    const faceEps = wt / 2 + 10;
    const n = getNorm(w.start, w.end);
    if (!n) continue;
    const t = ((pt.x - w.start.x) * n.dx + (pt.y - w.start.y) * n.dy) / (n.len * n.len);
    if (t < -0.01 || t > 1.01) continue;
    const tc = Math.max(0, Math.min(1, t));
    const cx = w.start.x + tc * n.dx, cy = w.start.y + tc * n.dy;
    const normalDist = Math.abs((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny);
    // 游標在牆 body 內，不是外緣，跳過
    if (normalDist < wt / 2 - 2) continue;
    const faceDist = Math.abs(normalDist - wt / 2);
    if (faceDist < faceEps && faceDist < faceBestD) {
      faceBestD = faceDist;
      // snap 目標是 centerline，但紅圈顯示在外緣的投影點
      const sign = ((pt.x - w.start.x) * n.nx + (pt.y - w.start.y) * n.ny) >= 0 ? 1 : -1;
      const facePt = { x: cx + sign * n.nx * (wt / 2), y: cy + sign * n.ny * (wt / 2) };
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
      setViewTransform(prev => ({ ...prev, offsetX: panning.origOffsetX + dx, offsetY: panning.origOffsetY - dy }));
      return;
    }
    if (endpointDrag) {
      const rawPt = getRawPt(e);
      const snapped = { x: snap(rawPt.x), y: snap(rawPt.y) };
      setRawWalls(prev => {
        const next = [...prev];
        const w = next[endpointDrag.wallIdx];
        next[endpointDrag.wallIdx] = { ...w, [endpointDrag.endpoint]: snapped };
        return next;
      });
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
    const activeOT = type === 'door' ? doorTypes.find(t => t.id === activeDoorTypeId) : windowTypes.find(t => t.id === activeWindowTypeId);
    const WIDTH = activeOT?.width ?? (type === 'door' ? DOOR_WIDTH : WINDOW_WIDTH);
    const halfT = (WIDTH / 2) / n.len;
    let t = projectOnWall(pt, wall);
    t = Math.max(halfT, Math.min(1 - halfT, t));
    const tA = t - halfT, tB = t + halfT;
    const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
    const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
    setDragPreview({ [type === 'door' ? 'isDoor' : 'isWindow']: true, ptA, ptB, nx: n.nx, ny: n.ny, ux: n.dx / n.len, uy: n.dy / n.len, flipped, thickness: wall.thickness });
  }

  function handleMouseUp(e) {
    if (panning) { setPanning(null); return; }
    if (endpointDrag) { setEndpointDrag(null); return; }
    if (wallDragPending) {
      setWallDragPending(null);
       wallDragPendingRef.current = null;
      return;
    }
    if (dragWall) {
      // Snap endpoint to nearby wall endpoints to convert T→L junction
      setRawWalls(prev => {
        const wall = prev[dragWall.wallIdx];
        if (!wall || wall.isDoor || wall.isWindow) return prev;
        const EPS = THICKNESS + GRID;
        let { start, end } = wall;
        for (let i = 0; i < prev.length; i++) {
          if (i === dragWall.wallIdx) continue;
          const other = prev[i];
          if (other.isDoor || other.isWindow) continue;
          for (const otherPt of [other.start, other.end]) {
            if (Math.hypot(start.x - otherPt.x, start.y - otherPt.y) < EPS) start = { x: otherPt.x, y: otherPt.y };
            if (Math.hypot(end.x - otherPt.x, end.y - otherPt.y) < EPS) end = { x: otherPt.x, y: otherPt.y };
          }
        }
        if (start === wall.start && end === wall.end) return prev;
        const next = [...prev];
        next[dragWall.wallIdx] = { ...wall, start, end };
        return next;
      });
      setDragWall(null);
      return;
    }
    if (!dragging) return;
    const pt = getPoint(e);
    const { wallsMerged, mergedWallIdx, type, flipped } = dragging;
    saveHistory();
    const openingType = type === 'door' ? doorTypes.find(t => t.id === activeDoorTypeId) : windowTypes.find(t => t.id === activeWindowTypeId);
    setRawWalls(placeOpening(wallsMerged, mergedWallIdx, pt, type, flipped, openingType));
    setDragging(null); setDragPreview(null);
  }

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const svgH = svgRef.current.clientHeight;
    const qy = svgH - sy;
    setViewTransform(prev => ({
      scale: prev.scale * factor,
      offsetX: sx - (sx - prev.offsetX) * factor,
      offsetY: qy - (qy - prev.offsetY) * factor,
    }));
  }

  function handleFlip() {
    if (singleSel?.type !== 'rawWall') return;
    setRawWalls(prev => { const next = [...prev]; next[singleSel.idx] = { ...next[singleSel.idx], flipped: !next[singleSel.idx].flipped }; return next; });
  }

  function handleClick(e) {
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
      const ct = colTypes.find(t => t.id === activeColTypeId);
      const newCol = { cx: pt.x, cy: pt.y, type: colType, rotated: previewRotated, typeId: activeColTypeId, w: ct?.w ?? COL_W, h: ct?.h ?? COL_H };
      saveHistory();
      setRawWalls(prev => splitAllWallsByColumn(prev, newCol));
      setColumns(prev => [...prev, newCol]);
      return;
    }

    if (mode === 'wall') {
      if (!startPt) { setStartPt(pt); return; }
      const endPt = applyOrthoLock(pt, startPt);
      const n = getNorm(startPt, endPt);
      if (n && n.len > 5) {
        const wt = wallTypes.find(t => t.id === activeWallTypeId);
        const wallThickness = wt?.thickness ?? THICKNESS;
        const newWall = { start: startPt, end: endPt, typeId: activeWallTypeId, thickness: wallThickness };
        const colSegs = splitWallByColumns(newWall, columns);
        saveHistory();
        setRawWalls(prev => {
          let current = prev;
          const allNewSegs = [];
          for (const seg of colSegs) {
            const { newSegments, updatedWalls } = splitByWallIntersections(seg, current);
            current = updatedWalls;
            allNewSegs.push(...newSegments.map(s => ({ ...s, typeId: activeWallTypeId, thickness: wallThickness })));
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
      const openingType = mode === 'door' ? doorTypes.find(t => t.id === activeDoorTypeId) : windowTypes.find(t => t.id === activeWindowTypeId);
      if (idx !== -1) setRawWalls(prev => placeOpening(prev, idx, pt, mode, false, openingType));
      return;
    }
  }

  const activeWT = wallTypes.find(t => t.id === activeWallTypeId);
  const preview = startPt && cursor && !dragging && mode === 'wall' && !suspended ? computeWallLines(startPt, cursor, activeWT?.thickness ?? THICKNESS) : null;
  const activeCT = colTypes.find(t => t.id === activeColTypeId);
  const colPreview = mode === 'column' && cursor && !suspended ? { cx: cursor.x, cy: cursor.y, type: colType, rotated: previewRotated, typeId: activeColTypeId, w: activeCT?.w ?? COL_W, h: activeCT?.h ?? COL_H } : null;
  const DOOR_WIN_THRESHOLD = THICKNESS / 2 + 5;
  const openingPreview = !suspended && cursor && (mode === 'door' || mode === 'window') ? (() => {
    const idx = rawWalls.findIndex(w => !w.isDoor && !w.isWindow && distToWall(cursor, w) < DOOR_WIN_THRESHOLD);
    if (idx === -1) return null;
    const wall = rawWalls[idx];
    const n = getNorm(wall.start, wall.end);
    if (!n) return null;
    const activeOT = mode === 'door' ? doorTypes.find(t => t.id === activeDoorTypeId) : windowTypes.find(t => t.id === activeWindowTypeId);
    const WIDTH = activeOT?.width ?? (mode === 'door' ? DOOR_WIDTH : WINDOW_WIDTH);
    const halfT = (WIDTH / 2) / n.len;
    let t = projectOnWall(cursor, wall);
    t = Math.max(halfT, Math.min(1 - halfT, t));
    const tA = t - halfT, tB = t + halfT;
    const ptA = { x: wall.start.x + tA * n.dx, y: wall.start.y + tA * n.dy };
    const ptB = { x: wall.start.x + tB * n.dx, y: wall.start.y + tB * n.dy };
    return { isDoor: mode === 'door', isWindow: mode === 'window', ptA, ptB, nx: n.nx, ny: n.ny, ux: n.dx/n.len, uy: n.dy/n.len, flipped: false, thickness: wall.thickness };
  })() : null;

  function getHint() {
    const n = selected.length;
    if (n > 1) return `已選取 ${n} 個物件 — Delete 全部刪除，ESC 清除選取`;
    if (n === 1) {
      const obj = singleSel?.type === 'rawWall' ? rawWalls[singleSel.idx] : null;
      if (singleSel?.type === 'col') return '已選取柱 — 空白鍵旋轉，Delete 刪除，Ctrl+點擊複選';
      if (obj?.isDoor)   return '已選取門 — 點雙箭頭反轉，Delete 刪除，Ctrl+點擊複選';
      if (obj?.isWindow) return '已選取窗 — 點雙箭頭反轉，Delete 刪除，Ctrl+點擊複選';
      if (obj) return '已選取牆段 — 拖拉平移，點標註數字修改長度，Delete 刪除，Ctrl+點擊複選';
    }
    if (suspended) return `已暫停（${mode === 'column' ? '柱' : mode === 'wall' ? '牆' : mode === 'door' ? '門' : '窗'}模式）— 點擊繼續放置，再按 ESC 回到選取`;
    if (mode === 'select')  return '選取模式 — 點擊選取，Ctrl+點擊複選';
    if (mode === 'column')  return `放置 ${colType === 'rc' ? 'RC 柱' : 'H 鋼柱'}（80×100）— 點擊放置，空白鍵旋轉，ESC 暫停`;
    if (mode === 'wall')    return startPt ? '點第二點完成牆段（鎖定正交），ESC 取消本段' : '點空白處開始畫牆，ESC 暫停';
    if (mode === 'door')    return dragging ? '拖拉中⋯ 放開確認' : '靠近牆放置門，ESC 暫停';
    if (mode === 'window')  return dragging ? '拖拉中⋯ 放開確認' : '靠近牆放置窗，ESC 暫停';
    return '';
  }

  // ── 性質面板（仿 Revit Properties palette + Type Selector）────────────────────
  const panelInputStyle = { padding: '4px 6px', background: '#111', color: '#ccc', border: '1px solid #333', borderRadius: 4, fontSize: 12, outline: 'none' };
  const panelBtnStyle = { padding: '3px 8px', background: '#1a1a1a', color: '#00d4aa', border: '1px solid #00d4aa66', borderRadius: 6, fontSize: 12, outline: 'none', cursor: 'pointer' };
  const typeSelectStyle = { width: '100%', padding: '6px 8px', background: '#1a1a1a', color: '#00d4aa', border: '1px solid #00d4aa66', borderRadius: 6, cursor: 'pointer', fontSize: 13, outline: 'none', marginBottom: 8 };
  const sectionTitleStyle = { fontSize: 12, color: '#00d4aa', marginBottom: 6 };
  const noteStyle = { color: '#555', fontSize: 11, lineHeight: 1.6, marginTop: 8 };

  // 四種類型表共用同一個面板 UI，差別只在欄位與 handler
  const typePanelCfg = {
    wall: {
      title: '牆類型', types: wallTypes, activeId: activeWallTypeId, setActiveId: setActiveWallTypeId,
      editingId: editingWallTypeId, setEditingId: setEditingWallTypeId,
      editingForm: editingWallTypeForm, setEditingForm: setEditingWallTypeForm,
      panel: wallTypePanel, setPanel: setWallTypePanel, form: wallTypeForm, setForm: setWallTypeForm,
      onAdd: handleAddWallType,
      onEditCommit: (id, f) => handleEditWallType(id, f.name, parseInt(f.thickness)),
      onDelete: handleDeleteWallType,
      fields: [{ key: 'thickness', label: '厚度' }],
      fmt: t => `${t.thickness}mm`,
    },
    col: {
      title: '柱類型', types: colTypes, activeId: activeColTypeId, setActiveId: setActiveColTypeId,
      editingId: editingColTypeId, setEditingId: setEditingColTypeId,
      editingForm: editingColTypeForm, setEditingForm: setEditingColTypeForm,
      panel: colTypePanel, setPanel: setColTypePanel, form: colTypeForm, setForm: setColTypeForm,
      onAdd: handleAddColType,
      onEditCommit: (id, f) => handleEditColType(id, f.name, parseInt(f.w), parseInt(f.h)),
      onDelete: handleDeleteColType,
      fields: [{ key: 'w', label: '寬' }, { key: 'h', label: '深' }],
      fmt: t => `${t.w}×${t.h}`,
    },
    door: {
      title: '門類型', types: doorTypes, activeId: activeDoorTypeId, setActiveId: setActiveDoorTypeId,
      editingId: editingDoorTypeId, setEditingId: setEditingDoorTypeId,
      editingForm: editingDoorTypeForm, setEditingForm: setEditingDoorTypeForm,
      panel: doorTypePanel, setPanel: setDoorTypePanel, form: doorTypeForm, setForm: setDoorTypeForm,
      onAdd: handleAddDoorType,
      onEditCommit: (id, f) => handleEditDoorType(id, f.name, parseInt(f.width)),
      onDelete: handleDeleteDoorType,
      fields: [{ key: 'width', label: '寬度' }],
      fmt: t => `寬 ${t.width}`,
    },
    window: {
      title: '窗類型', types: windowTypes, activeId: activeWindowTypeId, setActiveId: setActiveWindowTypeId,
      editingId: editingWindowTypeId, setEditingId: setEditingWindowTypeId,
      editingForm: editingWindowTypeForm, setEditingForm: setEditingWindowTypeForm,
      panel: windowTypePanel, setPanel: setWindowTypePanel, form: windowTypeForm, setForm: setWindowTypeForm,
      onAdd: handleAddWindowType,
      onEditCommit: (id, f) => handleEditWindowType(id, f.name, parseInt(f.width)),
      onDelete: handleDeleteWindowType,
      fields: [{ key: 'width', label: '寬度' }],
      fmt: t => `寬 ${t.width}`,
    },
  };

  // Type Selector：類型清單（點選＝設為使用中、✎ 編輯、✕ 刪除、+ 新增）
  function renderTypeList(cfg) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#888', flex: 1 }}>{cfg.title}</span>
          <button onClick={() => cfg.setPanel(v => !v)} style={panelBtnStyle}>+</button>
        </div>
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, overflow: 'hidden' }}>
          {cfg.types.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: t.id === cfg.activeId ? '#00d4aa22' : 'transparent', cursor: 'pointer' }}
              onClick={() => { if (cfg.editingId !== t.id) cfg.setActiveId(t.id); }}>
              {cfg.editingId === t.id ? (
                <>
                  <input value={cfg.editingForm.name ?? ''} onChange={e => cfg.setEditingForm(f => ({ ...f, name: e.target.value }))} style={{ ...panelInputStyle, width: 64 }} onClick={e => e.stopPropagation()} />
                  {cfg.fields.map(fd => (
                    <input key={fd.key} value={cfg.editingForm[fd.key] ?? ''} type="number" onChange={e => cfg.setEditingForm(f => ({ ...f, [fd.key]: e.target.value }))} style={{ ...panelInputStyle, width: 40, marginLeft: 4 }} onClick={e => e.stopPropagation()} />
                  ))}
                  <button onClick={e => { e.stopPropagation(); cfg.onEditCommit(t.id, cfg.editingForm); }} style={{ ...panelBtnStyle, marginLeft: 4 }}>✓</button>
                </>
              ) : (
                <>
                  <span style={{ color: t.id === cfg.activeId ? '#00d4aa' : '#aaa', fontSize: 12, flex: 1 }}>{t.name}（{cfg.fmt(t)}）</span>
                  <button onClick={e => { e.stopPropagation(); cfg.setEditingId(t.id); cfg.setEditingForm({ name: t.name, ...Object.fromEntries(cfg.fields.map(fd => [fd.key, String(t[fd.key])])) }); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, padding: '0 3px' }}>✎</button>
                  <button onClick={e => { e.stopPropagation(); cfg.onDelete(t.id); }} disabled={cfg.types.length <= 1} style={{ background: 'none', border: 'none', color: cfg.types.length <= 1 ? '#333' : '#666', cursor: cfg.types.length <= 1 ? 'default' : 'pointer', fontSize: 11, padding: '0 3px' }}>✕</button>
                </>
              )}
            </div>
          ))}
        </div>
        {cfg.panel && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <input placeholder="名稱" value={cfg.form.name} onChange={e => cfg.setForm(f => ({ ...f, name: e.target.value }))} style={{ ...panelInputStyle, width: 70 }} />
            {cfg.fields.map(fd => (
              <input key={fd.key} placeholder={fd.label} type="number" value={cfg.form[fd.key]} onChange={e => cfg.setForm(f => ({ ...f, [fd.key]: e.target.value }))} style={{ ...panelInputStyle, width: 48 }} />
            ))}
            <button onClick={cfg.onAdd} style={panelBtnStyle}>確認</button>
          </div>
        )}
      </div>
    );
  }

  // 面板內容：選取優先（顯示被選物件的性質），否則依目前模式顯示 Type Selector
  function renderProperties() {
    if (selected.length > 1) {
      return <div style={{ color: '#888', fontSize: 12, lineHeight: 1.8 }}>已選取 {selected.length} 個物件<br />Delete 刪除全部，ESC 清除選取</div>;
    }
    if (singleSel?.type === 'col' && columns[singleSel.idx]) {
      const c = columns[singleSel.idx];
      return (
        <div>
          <div style={sectionTitleStyle}>柱</div>
          <select value={c.typeId ?? ''} style={typeSelectStyle}
            onChange={e => {
              const ct = colTypes.find(t => t.id === e.target.value);
              if (!ct) return;
              saveHistory();
              setColumns(prev => { const next = [...prev]; next[singleSel.idx] = { ...next[singleSel.idx], typeId: ct.id, w: ct.w, h: ct.h }; return next; });
            }}>
            {colTypes.map(t => <option key={t.id} value={t.id}>{t.name}（{t.w}×{t.h}）</option>)}
          </select>
          <PropRow k="型式" v={c.type === 'rc' ? 'RC 柱' : 'H 鋼柱'} />
          <PropRow k="尺寸" v={`${c.w ?? COL_W}×${c.h ?? COL_H}${c.rotated ? '（已旋轉）' : ''}`} />
          <div style={noteStyle}>空白鍵旋轉，Delete 刪除</div>
        </div>
      );
    }
    if (singleSel?.type === 'rawWall' && selWallObj) {
      if (selWallObj.isDoor || selWallObj.isWindow) {
        const isD = selWallObj.isDoor;
        const t = (isD ? doorTypes : windowTypes).find(x => x.id === selWallObj.typeId);
        const span = Math.round(Math.hypot(selWallObj.ptB.x - selWallObj.ptA.x, selWallObj.ptB.y - selWallObj.ptA.y));
        return (
          <div>
            <div style={sectionTitleStyle}>{isD ? '門' : '窗'}</div>
            <PropRow k="類型" v={t ? `${t.name}（寬 ${t.width}）` : '—'} />
            <PropRow k="開口寬" v={String(span)} />
            <div style={noteStyle}>已放置的開口暫不支援換類型（幾何需重排）；點畫布上的雙箭頭可反轉方向</div>
          </div>
        );
      }
      const n = getNorm(selWallObj.start, selWallObj.end);
      return (
        <div>
          <div style={sectionTitleStyle}>牆</div>
          <select value={selWallObj.typeId ?? ''} style={typeSelectStyle}
            onChange={e => {
              const wt = wallTypes.find(t => t.id === e.target.value);
              if (!wt) return;
              saveHistory();
              setRawWalls(prev => { const next = [...prev]; next[singleSel.idx] = { ...next[singleSel.idx], typeId: wt.id, thickness: wt.thickness }; return next; });
            }}>
            {wallTypes.map(t => <option key={t.id} value={t.id}>{t.name}（{t.thickness}mm）</option>)}
          </select>
          <PropRow k="長度" v={String(Math.round(n?.len ?? 0))} />
          <PropRow k="厚度" v={String(selWallObj.thickness ?? THICKNESS)} />
          <div style={noteStyle}>點畫布上的標註數字可直接改長度；拖綠色端點可伸縮</div>
        </div>
      );
    }
    if (mode === 'wall') return renderTypeList(typePanelCfg.wall);
    if (mode === 'column') return (
      <div>
        <select value={colType} onChange={e => setColType(e.target.value)} style={typeSelectStyle}>
          <option value="rc">RC 柱</option>
          <option value="h">H 鋼柱</option>
        </select>
        {renderTypeList(typePanelCfg.col)}
      </div>
    );
    if (mode === 'door') return renderTypeList(typePanelCfg.door);
    if (mode === 'window') return renderTypeList(typePanelCfg.window);
    return (
      <div style={{ color: '#666', fontSize: 12, lineHeight: 1.8 }}>
        未選取物件<br />
        牆段 {rawWalls.filter(w => !w.isDoor && !w.isWindow).length}、
        門 {rawWalls.filter(w => w.isDoor).length}、
        窗 {rawWalls.filter(w => w.isWindow).length}、
        柱 {columns.length}
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Ribbon：動詞區（要做什麼），仿 Revit 分群工具列 */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: '#161616', borderBottom: '1px solid #2a2a2a', padding: '6px 8px', zIndex: 10 }}>
        <RibbonGroup label="建模">
          {PLACE_MODES.map(m => (
            <button key={m.key}
              onClick={() => { setMode(m.key); setStartPt(null); setSelected([]); setSuspended(false); }}
              style={{ padding: '6px 14px', background: mode === m.key ? '#00d4aa22' : '#1a1a1a', color: mode === m.key ? '#00d4aa' : '#888', border: `1px solid ${mode === m.key ? '#00d4aa66' : '#333'}`, borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
              {m.label}
            </button>
          ))}
        </RibbonGroup>
        <RibbonGroup label="修改">
          <button
            onClick={() => { setMode('select'); setStartPt(null); setSuspended(false); }}
            style={{ padding: '6px 14px', background: mode === 'select' ? '#00d4aa22' : '#1a1a1a', color: mode === 'select' ? '#00d4aa' : '#888', border: `1px solid ${mode === 'select' ? '#00d4aa66' : '#333'}`, borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            選取 [ESC]
          </button>
          <button onClick={() => deleteSelected(selected)} disabled={selected.length === 0}
            style={{ padding: '6px 14px', background: selected.length > 0 ? '#ff6b9d22' : '#1a1a1a', color: selected.length > 0 ? '#ff6b9d' : '#444', border: `1px solid ${selected.length > 0 ? '#ff6b9d66' : '#2a2a2a'}`, borderRadius: 6, cursor: selected.length > 0 ? 'pointer' : 'default', fontSize: 13 }}>
            刪除{selected.length > 1 ? ` (${selected.length})` : ''} [Del]
          </button>
        </RibbonGroup>
        <RibbonGroup label="檔案">
          <label style={{ padding: '6px 14px', background: '#1a1a1a', color: '#888', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            匯入 DXF
            <input type="file" accept=".dxf" style={{ display: 'none' }} onChange={async e => {
              const file = e.target.files[0];
              if (!file) return;
              const fd = new FormData();
              fd.append('file', file);
              try {
                const res = await fetch(`${API_BASE}/api/upload-dxf`, { method: 'POST', body: fd });
                const data = await res.json();
                if (data.error) { console.error('DXF 匯入錯誤:', data.error); return; }
                const walls = data.walls ?? [];
                const cols = data.columns ?? [];
                // 直接使用 DXF 原始座標（DXF 的 0,0 對齊世界原點十字）
                // layer：記住來源 DXF 圖層，匯出時放回同一圖層（在 FloorAI 新畫的物件沒有 layer，用預設）
                const newWalls = walls.map(w => ({
                  start: { x: w.start[0], y: w.start[1] },
                  end:   { x: w.end[0],   y: w.end[1] },
                  typeId: wallTypes[0]?.id,
                  thickness: w.thickness ?? wallTypes[0]?.thickness ?? THICKNESS,
                  layer: w.layer,
                }));
                const newCols = cols.map(c => ({
                  cx: c.cx,
                  cy: c.cy,
                  type: 'rc',
                  rotated: Math.abs(Math.sin(c.angle)) > 0.5,
                  typeId: colTypes[0]?.id,
                  w: c.w,
                  h: c.h,
                  layer: c.layer,
                }));
                console.log(`DXF 匯入：${newWalls.length} 條牆、${newCols.length} 根柱`);
                saveHistory();
                setRawWalls(prev => [...prev, ...newWalls]);
                if (newCols.length > 0) setColumns(prev => [...prev, ...newCols]);
                // 記下來源圖層外觀（依 name 合併，新匯入覆蓋同名）
                const srcLayers = data.layers ?? [];
                if (srcLayers.length > 0) {
                  setImportedLayers(prev => {
                    const map = new Map(prev.map(L => [L.name, L]));
                    srcLayers.forEach(L => map.set(L.name, L));
                    return [...map.values()];
                  });
                }
              } catch (err) {
                console.error('連線失敗（確認後端是否啟動）:', err);
              }
              e.target.value = '';
            }} />
          </label>
          <button onClick={async () => {
            const payload = buildExportGeometry(rawWalls, columns);
            payload.layers = importedLayers;  // 來源圖層外觀，匯出時放回
            if (payload.lines.length === 0 && payload.arcs.length === 0) { window.alert('畫布是空的，沒有可匯出的內容'); return; }
            try {
              const res = await fetch(`${API_BASE}/api/export-dxf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                window.alert(`匯出失敗：${err.error ?? res.status}`);
                return;
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'floorai.dxf';
              a.click();
              URL.revokeObjectURL(url);
            } catch (err) {
              window.alert('連線失敗（確認後端是否啟動）');
            }
          }}
            style={{ padding: '6px 14px', background: '#1a1a1a', color: '#888', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            匯出 DXF
          </button>
          <button onClick={handleClear}
            style={{ padding: '6px 14px', background: '#1a1a1a', color: '#666', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            清除
          </button>
        </RibbonGroup>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 性質面板：名詞區（用什麼類型做），仿 Revit Properties palette */}
        <div style={{ width: 264, flexShrink: 0, background: '#141414', borderRight: '1px solid #2a2a2a', overflowY: 'auto', padding: 10 }}>
          <div style={{ fontSize: 12, color: '#00d4aa', fontWeight: 600, letterSpacing: 2, marginBottom: 10 }}>性質</div>
          {renderProperties()}
        </div>

        {/* 畫布 */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
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

          {mode === 'select' && singleSel?.type === 'rawWall' && selWallObj && !selWallObj.isDoor && !selWallObj.isWindow && !dragWall && (
            <WallDimAnnotation
              wall={selWallObj}
              onClickValue={e => {
                const n = getNorm(selWallObj.start, selWallObj.end);
                setEditingDim({ wallIdx: singleSel.idx, inputText: String(Math.round(n?.len ?? 0)), x: e.clientX, y: e.clientY });
              }}
            />
          )}
          {selWallObj && (selWallObj.isDoor || selWallObj.isWindow) && <FlipIcon obj={selWallObj} />}
          {dragging && dragPreview && (dragPreview.isDoor ? <DoorSegment door={dragPreview} isPreview /> : <WindowSegment win={dragPreview} isPreview />)}
          {preview && <g opacity={0.4}><line {...preview.line1} stroke="#00d4aa" strokeWidth="1.5" /><line {...preview.line2} stroke="#00d4aa" strokeWidth="1.5" /></g>}
          {colPreview && (colPreview.type === 'rc' ? <RCColumn col={colPreview} isSelected={false} isPreview rawWalls={[]} /> : <HColumn col={colPreview} isSelected={false} isPreview />)}
          {openingPreview && !dragging && (openingPreview.isDoor ? <DoorSegment door={openingPreview} isPreview /> : <WindowSegment win={openingPreview} isPreview />)}
          {snapIndicator && (
            <circle cx={snapIndicator.x} cy={snapIndicator.y} r={6} stroke="#ff4466" strokeWidth="1.5" fill="none" />
          )}
        </g>

        {singleSel?.type === 'rawWall' && (() => {
          const w = rawWalls[singleSel.idx];
          if (!w || w.isDoor || w.isWindow) return null;
          const sp = worldToScreen(w.start.x, w.start.y);
          const ep = worldToScreen(w.end.x,   w.end.y);
          return (
            <g>
              <circle cx={sp.x} cy={sp.y} r={6} fill="#00d4aa" stroke="#fff" strokeWidth="1.5" style={{ cursor: 'crosshair' }} />
              <circle cx={ep.x} cy={ep.y} r={6} fill="#00d4aa" stroke="#fff" strokeWidth="1.5" style={{ cursor: 'crosshair' }} />
            </g>
          );
        })()}
      </svg>
        </div>
      </div>

      {/* 狀態列（底部提示，仿 Revit status bar） */}
      <div style={{ padding: '5px 12px', background: '#161616', borderTop: '1px solid #2a2a2a', color: '#777', fontSize: 12 }}>{getHint()}</div>

      {editingDim && (
        <input
          autoFocus
          value={editingDim.inputText}
          style={{ position: 'fixed', left: editingDim.x - 30, top: editingDim.y - 14,
                   width: 80, fontSize: 14, textAlign: 'center',
                   background: '#1a1a1a', color: '#ffcc00', border: '1px solid #ffcc00',
                   borderRadius: 4, padding: '2px 6px', outline: 'none', zIndex: 20 }}
          onChange={e => setEditingDim(prev => ({ ...prev, inputText: e.target.value }))}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const v = parseFloat(editingDim.inputText);
              if (!isNaN(v) && v > 0) applyNewLength(editingDim.wallIdx, v);
              setEditingDim(null);
            }
            if (e.key === 'Escape') setEditingDim(null);
          }}
          onBlur={() => setEditingDim(null)}
        />
      )}
    </div>
  );
}