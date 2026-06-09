# App.js 程式碼索引
> 更新：2026-06-09｜對應 commit: e8843b4 及之後的修改

---

## 全域常數（L1–L11）

| 名稱 | 值 | 說明 |
|------|-----|------|
| `GRID` | 20 | 吸附格距 |
| `THICKNESS` | 15 | 全域預設牆厚（各牆已改為 per-wall） |
| `DOOR_WIDTH` | 80 | 門預設寬度 |
| `WINDOW_WIDTH` | 80 | 窗預設寬度 |
| `WINDOW_INSET` | 8 | 窗內縮距離 |
| `GLASS_OFFSET` | 1 | 玻璃線偏移 |
| `FLIP_ICON_OFFSET` | 28 | 翻轉圖示偏移 |
| `COL_W` | 80 | 柱預設寬 |
| `COL_H` | 100 | 柱預設高 |
| `ENDPOINT_EPS` | 0.02 | 端點判斷容差（L211） |
| `DIM_OFFSET` | 30 | 尺寸線偏移距離（L641） |
| `ARROW_SIZE` | 6 | 尺寸箭頭大小（L642） |

---

## 全域函式（App 元件之外）

| 函式 | 行號 | 說明 |
|------|------|------|
| `snap(v)` | L13 | 吸附到 GRID 格點 |
| `applyOrthoLock(pt, ref)` | L15 | 正交鎖定 |
| `getNorm(start, end)` | L22 | 取單位法向量 → `{dx,dy,len,nx,ny}` |
| `computeWallLines(start, end, thickness?)` | L29 | 計算兩條 offset 線 → `{line1,line2}` |
| `distToWall(pt, wall)` | L39 | 點到牆中心線的最短距離 |
| `ptBetweenWallLines(pt, wall)` | L48 | 點是否在牆體範圍內（hit test 用） |
| `distToOpening(pt, obj)` | L57 | 點到門/窗中心的距離 |
| `projectOnWall(pt, wall)` | L63 | 點在牆上的投影參數 t（0–1） |
| `getFixedEnd(wall, rawWalls)` | L70 | 判斷哪端是 T 型固定端 → `'start'/'end'/'center'` |
| `placeOpening(walls, wallIdx, clickPt, type, flipped)` | L91 | 在牆上插入門或窗（截斷成3段） |
| `findOpeningGroup(walls, idx)` | L113 | 找門/窗的左右相鄰牆段 |
| `mergeOpening(walls, group)` | L119 | 合併門/窗的三段回一段（拖曳前用） |
| `getColCorners(col)` | L126 | 取柱的 hw/hh（考慮 rotated） |
| `ptInCol(pt, col)` | L134 | 點是否在柱體範圍內 |
| `splitWallByColumns(wall, columns)` | L141 | 單牆被多柱截斷 → 段陣列 |
| `splitAllWallsByColumn(rawWalls, col)` | L189 | 所有牆被新柱截斷 |
| `segIntersectT(ax0,ay0,ax1,ay1,bx0,by0,bx1,by1)` | L198 | 線段交叉，回傳 `{tA,tB}` |
| `splitByWallIntersections(newWall, rawWalls)` | L213 | 畫新牆時的 T/十字截斷 → `{newSegments, updatedWalls}` |
| `getWallGaps(wall, rawWalls)` | L298 | 計算十字接合缺口 → `{posGaps, negGaps}` |
| `getColGaps(col, rawWalls)` | L374 | 計算柱側面缺口 → `{top,bottom,left,right}` |
| `clipOffsetLineOutsideCol(x0,y0,x1,y1,col)` | L409 | 裁切 offset 線，不進入柱體 |
| `computeMiter(wallA, wallB)` | L433 | 計算 L 角 miter 點 → `{pos,neg}` |
| `computeAllMiters(rawWalls)` | L453 | 計算所有 L 角 miter → `{[wallIdx]: {start,end}}` |
| `computeWallDragInfo(wall, wallIdx, rawWalls, columns)` | L505 | 計算牆拖曳限制與 snap 點 |
| `clipStubEnd(px,py,rawWalls,currentWall)` | L602 | T 型接合：stub 端點截到 through-wall 外緣 |
| `applyWallSnap(pt)` | L1115 | 畫牆時吸附到鄰牆（兩階段：中心線→外緣） |

---

## 全域 UI 元件（App 元件之外）

| 元件 | 行號 | 說明 |
|------|------|------|
| `EdgeWithGaps` | L589 | 含缺口的線段（把間隔裂開渲染） |
| `WallDimAnnotation` | L644 | 選取牆時的尺寸標註（箭頭＋數字，含點擊觸發輸入） |
| `WallSegment` | L684 | 渲染單一牆段（含 miter/clip/gap） |
| `DoorSegment` | L721 | 渲染門（線＋弧） |
| `WindowSegment` | L731 | 渲染窗（雙線＋玻璃線） |
| `RCColumn` | L739 | 渲染 RC 柱（四邊含缺口） |
| `HColumn` | L746 | 渲染 H 鋼柱（外框＋翼板＋腹板） |
| `FlipIcon` | L752 | 門/窗翻轉圖示（雙箭頭） |
| `isInSel(selected, item)` | L761 | 判斷 item 是否在選取陣列中 |

---

## App 元件 — useState（L770–L814）

| state | 說明 |
|-------|------|
| `rawWalls` | 所有牆/門/窗（localStorage 持久化） |
| `columns` | 所有柱（localStorage 持久化） |
| `startPt` | 畫牆第一點 |
| `cursor` | 目前滑鼠世界座標 |
| `mode` | `'column'/'wall'/'door'/'window'/'select'` |
| `colType` | `'rc'/'h'` 柱類型 |
| `dragging` | 拖曳門/窗的暫態 |
| `dragPreview` | 拖曳中門/窗的預覽物件 |
| `selected` | `[{type, idx}]` 選取陣列 |
| `previewRotated` | 柱預覽是否旋轉 |
| `suspended` | 是否暫停（ESC 但維持模式） |
| `dragWall` | 拖曳牆的暫態（active） |
| `wallDragPending` | 拖曳牆的暫態（pending，mousedown→mousemove 才 promote） |
| `wallDragPendingRef` | 同上，useRef 版（避免 closure） |
| `snapIndicator` | 顯示紅圈 snap 點 |
| `editingDim` | 尺寸輸入暫態 `{wallIdx, inputText, x, y}` |
| `svgRef` | SVG DOM ref |
| `viewTransform` | `{scale, offsetX, offsetY}` 無限畫布 |
| `panning` | 中鍵拖曳平移暫態 |
| `endpointDrag` | 端點拖拉暫態 `{wallIdx, endpoint}` |
| `wallTypes` | 牆種類陣列（localStorage 持久化） |
| `activeWallTypeId` | 目前選用的牆種類 id |
| `colTypes` | 柱種類陣列（localStorage 持久化） |
| `activeColTypeId` | 目前選用的柱種類 id |
| `wallTypePanel` | 牆種類新增面板是否開啟 |
| `wallTypeForm` | 牆種類新增表單 `{name, thickness}` |
| `colTypePanel` | 柱種類新增面板是否開啟 |
| `colTypeForm` | 柱種類新增表單 `{name, w, h}` |
| `editingWallTypeId` | 正在編輯中的牆種類 id |
| `editingWallTypeForm` | 牆種類編輯表單 |
| `editingColTypeId` | 正在編輯中的柱種類 id |
| `editingColTypeForm` | 柱種類編輯表單 |
| `history` | undo 快照堆疊（最多 50 步） |
| `future` | redo 快照堆疊 |

---

## App 元件 — useMemo / 衍生值（L816–L819）

| 名稱 | 行號 | 說明 |
|------|------|------|
| `wallMiters` | L816 | `computeAllMiters(rawWalls)` 的快取 |
| `singleSel` | L818 | `selected.length===1 ? selected[0] : null` |
| `selWallObj` | L819 | 目前選取的牆物件（或 null） |

---

## App 元件 — useEffect（L821–L858）

| 行號 | 說明 |
|------|------|
| L821 | 鍵盤快捷鍵（ESC/C/W/D/N/Space/Delete/Ctrl+Z/Ctrl+Y） |
| L853 | localStorage 同步（rawWalls/columns/wallTypes/colTypes） |

---

## App 元件 — 函式

| 函式 | 行號 | 說明 |
|------|------|------|
| `saveHistory()` | L860 | 捕捉目前快照到 history |
| `undo()` | L865 | Ctrl+Z |
| `redo()` | L873 | Ctrl+Y |
| `applyNewLength(wallIdx, newLen)` | L881 | 輸入數值後更新牆長（固定 T 型端） |
| `handleClear()` | L903 | 清除全部（含確認提示） |
| `handleAddWallType()` | L910 | 新增牆種類 |
| `handleAddColType()` | L920 | 新增柱種類 |
| `handleEditWallType(id, name, thickness)` | L930 | 編輯牆種類（同步更新所有引用） |
| `handleDeleteWallType(id)` | L937 | 刪除牆種類（fallback 改預設） |
| `handleEditColType(id, name, w, h)` | L948 | 編輯柱種類 |
| `handleDeleteColType(id)` | L955 | 刪除柱種類 |
| `deleteSelected(sel)` | L966 | 刪除選取物件 |
| `screenToWorld(sx, sy)` | L991 | 畫面座標 → 世界座標（Y 朝上） |
| `worldToScreen(wx, wy)` | L999 | 世界座標 → 畫面座標 |
| `getRawPt(e)` | L1007 | 滑鼠事件 → 未 snap 的世界座標 |
| `getPoint(e)` | L1014 | 滑鼠事件 → snap 後的世界座標 |
| `hitTest(pt)` | L1016 | 點擊命中測試 → `{type,idx}` 或 null |
| `handleMouseDown(e)` | L1025 | 中鍵平移、端點拖拉、牆拖曳 pending、門窗拖曳 |
| `applyWallSnap(pt)` | L1115 | 見全域函式表（定義在 App 內） |
| `handleMouseMove(e)` | L1162 | 平移/端點拖拉/牆拖曳 promote＆移動/門窗拖曳預覽 |
| `handleMouseUp(e)` | L1264 | 結束各種拖曳 |
| `handleWheel(e)` | L1304 | 滾輪縮放（對準滑鼠位置） |
| `handleFlip()` | L1319 | 翻轉門/窗 |
| `handleClick(e)` | L1324 | 選取/放置柱/畫牆第二點/放置門窗 |
| `getHint()` | L1415 | 底部狀態提示文字 |

---

## App 元件 — Render 層衍生值（L1394–L1413）

| 名稱 | 行號 | 說明 |
|------|------|------|
| `activeWT` | L1394 | 目前選用的牆種類物件 |
| `preview` | L1395 | 畫牆第一點後的線段預覽 |
| `activeCT` | L1396 | 目前選用的柱種類物件 |
| `colPreview` | L1397 | 柱放置預覽物件 |
| `openingPreview` | L1399 | 門/窗放置預覽物件 |

---

## JSX 結構摘要（L1434–1647）

```
<div>                           // 根容器
  <div>                         // 工具列 (top: 16, left: 16)
    PLACE_MODES 按鈕              // 柱/牆/門/窗模式切換
    牆模式時：                    // 牆種類 dropdown + 新增
    柱模式時：                    // RC/H 選擇 + 柱種類 dropdown + 新增
    選取牆時：                    // 牆種類 select
    選取柱時：                    // 柱種類 select
    selected > 0：               // 刪除按鈕
    清除按鈕
  </div>
  <div>                         // 底部狀態列 (bottom: 16)
    getHint()
  </div>
  <svg ref={svgRef}>
    原點十字（在 <g transform> 之外）
    <g transform="matrix(s,0,0,-s,offX,svgH-offY)">   // Y-flip 世界座標
      columns.map → RCColumn / HColumn
      rawWalls.map → WallSegment / DoorSegment / WindowSegment
      WallDimAnnotation（選取牆時）
      FlipIcon（選取門/窗時）
      拖曳中預覽（門/窗）
      牆預覽（畫牆進行中）
      柱預覽
      門/窗放置預覽
      snapIndicator 紅圈
    </g>
    端點控制點（在 <g transform> 之外，用 worldToScreen 定位）
  </svg>
  editingDim 輸入框（HTML，fixed 定位）
</div>
```

---

## 座標換算

```js
screenToWorld(sx, sy) → { x: (sx - offsetX) / scale, y: (svgH - sy - offsetY) / scale }
worldToScreen(wx, wy) → { x: wx*scale + offsetX, y: svgH - (wy*scale + offsetY) }
```

SVG `<g transform>`: `matrix(scale, 0, 0, -scale, offsetX, svgH - offsetY)`

> **注意**：`<text>` 在 Y-flip `<g>` 內會上下顛倒，需用 `<g transform="translate(cx,cy) scale(1,-1)">` 補償（見 WallDimAnnotation L672–L680）

---

## 已知限制

- `getWallGaps`, `clipStubEnd`, `computeAllMiters`, `computeWallDragInfo` 仍用全域 `THICKNESS`（未 per-wall）
- 斜牆不支援（正交鎖定強制水平/垂直）
