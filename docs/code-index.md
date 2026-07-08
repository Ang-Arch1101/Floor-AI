# FloorAI 程式碼索引
> 更新：2026-07-08｜對應 commit: cc92f02（master，merge PR #4 之後）

> ⚠️ **DXF 匯入尚未大量測試** — 只驗證過 `test.dxf`，真實圖面未測，配對參數/接合裁切可能需要調整。
> 詳見本檔案最後的「已知限制」與 `CLAUDE.md`。

---

## 後端（`backend/`）— PR #4 新增

### `backend/app.py`（42 行）
| 內容 | 行號 | 說明 |
|------|------|------|
| `POST /api/upload-dxf` | L11 | 接收上傳的 `.dxf` 檔，存暫存檔後呼叫 `parse_dxf`，回傳 `{status, raw_count, wall_count, col_count, walls, columns}` |

### `backend/dxf_parser.py`（197 行）
| 名稱 | 行號 | 說明 |
|------|------|------|
| 參數常數 `GAP_MIN/GAP_MAX/OVERLAP_MIN/CLUSTER_GAP/MAX_COL/PARALLEL_TOL` | L5–10 | 牆厚範圍、重疊下限、柱群聚距離、容差，都是針對 `test.dxf` 調的 |
| `detect_rect_from_lwpoly(entity)` | L13 | closed 4-頂點矩形 LWPOLYLINE → 柱 `{cx,cy,w,h,angle}` |
| `try_pair(a, b, ...)` | L39 | 兩線段平行 + 間距 8–30 + 重疊 ≥50 → 配成一道牆（中心線 + 量到的厚度） |
| `pair_walls(segments)` | L84 | 貪婪配對平行線段成牆，回傳 `(walls, leftover)` |
| `cluster_columns(segments, ...)` | L107 | union-find 依端點鄰近（<50）把零散線段分群 → bounding box 當柱 |
| `parse_dxf(file_path)` | L161 | 主流程：用 ezdxf 讀 LINE/LWPOLYLINE → segments，配對成牆 + 分群成柱 |

- 測試檔：根目錄 `test.dxf`（4 牆 + 5 柱，其中一根是遠處孤立參考柱）
- 依賴：`flask`、`flask-cors`、`ezdxf`（`pip install flask flask-cors ezdxf`，`python app.py` 監聽 :5000）

---

## 前端（`src/App.js`，1829 行）

## 全域常數（L3–L11）

| 名稱 | 值 | 說明 |
|------|-----|------|
| `GRID` | 20 | 吸附格距 |
| `THICKNESS` | 15 | 全域預設牆厚（各牆已改為 per-wall，只作 fallback） |
| `DOOR_WIDTH` | 80 | 門預設寬度（fallback，實際用 `doorTypes`） |
| `WINDOW_WIDTH` | 80 | 窗預設寬度（fallback，實際用 `windowTypes`） |
| `WINDOW_INSET` | 8 | 窗內縮距離 |
| `GLASS_OFFSET` | 1 | 玻璃線偏移 |
| `FLIP_ICON_OFFSET` | 28 | 翻轉圖示偏移 |
| `COL_W` | 80 | 柱預設寬 |
| `COL_H` | 100 | 柱預設高 |
| `ENDPOINT_EPS` | 0.02 | 端點判斷容差（L220） |
| `DIM_OFFSET` | 30 | 尺寸線偏移距離（L654） |
| `ARROW_SIZE` | 6 | 尺寸箭頭大小（L655） |

---

## 全域函式（App 元件之外）

| 函式 | 行號 | 說明 |
|------|------|------|
| `snap(v)` | L13 | 吸附到 GRID 格點 |
| `applyOrthoLock(pt, ref)` | L15 | 正交鎖定 |
| `getNorm(start, end)` | L22 | 取單位法向量 → `{dx,dy,len,nx,ny}` |
| `computeWallLines(start, end, thickness?)` | L29 | 計算兩條 offset 線 → `{line1,line2}` |
| `distToWall(pt, wall)` | L39 | 點到牆中心線的最短距離 |
| `ptBetweenWallLines(pt, wall)` | L48 | 點是否在牆體範圍內（per-wall thickness，hit test 用） |
| `distToOpening(pt, obj)` | L57 | 點到門/窗中心的距離 |
| `projectOnWall(pt, wall)` | L63 | 點在牆上的投影參數 t（0–1） |
| `getFixedEnd(wall, rawWalls)` | L70 | 判斷哪端是 T 型固定端 → `'start'/'end'/'center'`（per-wall EPS） |
| `placeOpening(walls, wallIdx, clickPt, type, flipped, openingType)` | L91 | 在牆上插入門或窗（截斷成3段）；開口與兩側牆段繼承宿主牆 thickness/typeId，開口另存自己的 `width`/`typeId`（door/windowTypes 命名空間） |
| `findOpeningGroup(walls, idx)` | L121 | 找門/窗的左右相鄰牆段 |
| `mergeOpening(walls, group)` | L127 | 合併門/窗的三段回一段（拖曳前用），還原 typeId/thickness |
| `getColCorners(col)` | L135 | 取柱的 hw/hh（考慮 rotated） |
| `ptInCol(pt, col)` | L143 | 點是否在柱體範圍內 |
| `splitWallByColumns(wall, columns)` | L150 | 單牆被多柱截斷 → 段陣列 |
| `splitAllWallsByColumn(rawWalls, col)` | L198 | 所有牆被新柱截斷 |
| `segIntersectT(ax0,ay0,ax1,ay1,bx0,by0,bx1,by1)` | L207 | 線段交叉，回傳 `{tA,tB}` |
| `splitByWallIntersections(newWall, rawWalls)` | L222 | 畫新牆時的 T/十字截斷 → `{newSegments, updatedWalls}`（per-wall thickness） |
| `getWallGaps(wall, rawWalls)` | L308 | 計算十字接合缺口 → `{posGaps, negGaps}`；拆 `hSelf`/`hOther` 分別用自己/對方的厚度 |
| `getColGaps(col, rawWalls)` | L385 | 計算柱側面缺口 → `{top,bottom,left,right}`（用各牆自己的厚度） |
| `clipOffsetLineOutsideCol(x0,y0,x1,y1,col)` | L420 | 裁切 offset 線，不進入柱體 |
| `computeMiter(wallA, wallB, hA?, hB?)` | L444 | 計算 L 角 miter 點 → `{pos,neg}`；`hA`/`hB` 各牆半厚，預設 `THICKNESS/2` |
| `computeAllMiters(rawWalls)` | L463 | 計算所有 L 角 miter → `{[wallIdx]: {start,end}}`，per-wall 厚度傳入 `computeMiter` |
| `computeWallDragInfo(wall, wallIdx, rawWalls, columns)` | L517 | 計算牆拖曳限制與 snap 點；柱 snap 角落用 `wall.thickness` 退縮 |
| `EdgeWithGaps` | L601 | 含缺口的線段元件（把間隔裂開渲染） |
| `clipStubEnd(px,py,rawWalls,currentWall)` | L614 | T 型接合：stub 端點截到 through-wall 外緣（`hSelf`/`hOther` 分開） |
| `WallDimAnnotation` | L657 | 選取牆時的尺寸標註（箭頭＋數字，含點擊觸發輸入）；延伸線起點用 `wall.thickness` |
| `WallSegment` | L697 | 渲染單一牆段（含 miter/clip/gap，用 `wall.thickness`） |
| `DoorSegment` | L734 | 渲染門（線＋弧）；jamb 用 `door.thickness`，弧半徑用實際門扇跨距 `span` |
| `WindowSegment` | L745 | 渲染窗（雙線＋玻璃線），用 `win.thickness` |
| `RCColumn` | L753 | 渲染 RC 柱（四邊含缺口） |
| `HColumn` | L760 | 渲染 H 鋼柱（外框＋翼板＋腹板） |
| `FlipIcon` | L766 | 門/窗翻轉圖示（雙箭頭） |
| `isInSel(selected, item)` | L775 | 判斷 item 是否在選取陣列中 |
| `PLACE_MODES` | L777 | 工具列模式清單（柱/牆/門/窗） |

---

## App 元件 — useState（L785–L844）

| state | 說明 |
|-------|------|
| `rawWalls` | 所有牆/門/窗（localStorage 持久化） |
| `columns` | 所有柱（localStorage 持久化） |
| `startPt` / `cursor` / `mode` / `colType` | 畫牆起點、滑鼠世界座標、模式、柱類型 |
| `dragging` / `dragPreview` | 拖曳門/窗的暫態與預覽 |
| `selected` | `[{type, idx}]` 選取陣列 |
| `previewRotated` / `suspended` | 柱預覽旋轉、ESC 暫停 |
| `dragWall` / `wallDragPending` / `wallDragPendingRef` | 拖曳牆的暫態（pending → active） |
| `snapIndicator` / `editingDim` / `svgRef` | snap 紅圈、尺寸輸入暫態、SVG ref |
| `viewTransform` / `panning` / `endpointDrag` | 無限畫布、中鍵平移、端點拖拉暫態 |
| `wallTypes` / `activeWallTypeId` | 牆種類（localStorage 持久化）與目前選用 id |
| `colTypes` / `activeColTypeId` | 柱種類與目前選用 id |
| `doorTypes` / `activeDoorTypeId`（L819–822） | 門寬種類 `[{id,name,width}]`，localStorage 持久化 |
| `windowTypes` / `activeWindowTypeId`（L823–826） | 窗寬種類，同上 |
| `wallTypePanel` / `wallTypeForm` / `colTypePanel` / `colTypeForm` | 牆/柱種類新增面板與表單 |
| `doorTypePanel` / `doorTypeForm`（L831–832） | 門種類新增面板與表單 |
| `windowTypePanel` / `windowTypeForm`（L833–834） | 窗種類新增面板與表單 |
| `editingWallTypeId/Form` / `editingColTypeId/Form` | 牆/柱種類編輯暫態 |
| `editingDoorTypeId/Form`（L839–840） / `editingWindowTypeId/Form`（L841–842） | 門/窗種類編輯暫態 |
| `history` / `future` | undo/redo 快照堆疊（最多 50 步） |

---

## App 元件 — useMemo / 衍生值（L846–L849）

| 名稱 | 行號 | 說明 |
|------|------|------|
| `wallMiters` | L846 | `computeAllMiters(rawWalls)` 的快取 |
| `singleSel` | L848 | `selected.length===1 ? selected[0] : null` |
| `selWallObj` | L849 | 目前選取的牆物件（或 null） |

---

## App 元件 — useEffect（L851–L890）

| 行號 | 說明 |
|------|------|
| L851 | 鍵盤快捷鍵（ESC/C/W/D/N/Space/Delete/Ctrl+Z/Ctrl+Y） |
| L883 | localStorage 同步（rawWalls/columns/wallTypes/colTypes/**doorTypes/windowTypes**） |

---

## App 元件 — 函式

| 函式 | 行號 | 說明 |
|------|------|------|
| `saveHistory()` | L892 | 捕捉目前快照到 history |
| `undo()` | L897 | Ctrl+Z |
| `redo()` | L905 | Ctrl+Y |
| `applyNewLength(wallIdx, newLen)` | L913 | 輸入數值後更新牆長（固定 T 型端） |
| `handleClear()` | L935 | 清除全部（含確認提示） |
| `handleAddWallType()` | L942 | 新增牆種類 |
| `handleAddColType()` | L952 | 新增柱種類 |
| `handleEditWallType(id, name, thickness)` | L962 | 編輯牆種類（同步更新所有引用） |
| `handleDeleteWallType(id)` | L969 | 刪除牆種類（fallback 改預設） |
| `handleEditColType(id, name, w, h)` | L980 | 編輯柱種類 |
| `handleDeleteColType(id)` | L987 | 刪除柱種類 |
| `handleAddDoorType()` | L998 | 新增門種類 |
| `handleEditDoorType(id, name, width)` | L1010 | 編輯門種類（不套用到已放置開口，僅影響未來放置） |
| `handleDeleteDoorType(id)` | L1015 | 刪除門種類（fallback 改預設） |
| `handleAddWindowType()` | L1026 | 新增窗種類 |
| `handleEditWindowType(id, name, width)` | L1036 | 編輯窗種類 |
| `handleDeleteWindowType(id)` | L1041 | 刪除窗種類 |
| `deleteSelected(sel)` | L1052 | 刪除選取物件 |
| `screenToWorld(sx, sy)` | L1077 | 畫面座標 → 世界座標（Y 朝上） |
| `worldToScreen(wx, wy)` | L1085 | 世界座標 → 畫面座標 |
| `getRawPt(e)` | L1093 | 滑鼠事件 → 未 snap 的世界座標 |
| `getPoint(e)` | L1100 | 滑鼠事件 → snap 後的世界座標 |
| `hitTest(pt)` | L1102 | 點擊命中測試 → `{type,idx}` 或 null |
| `handleMouseDown(e)` | L1111 | 中鍵平移、端點拖拉、牆拖曳 pending、門窗拖曳 |
| `applyWallSnap(pt)` | L1201 | App 內部函式（縮排是 rebase 遺留的格式問題，仍在 `App()` 作用域內）；兩階段 snap，per-wall thickness |
| `handleMouseMove(e)` | L1248 | 平移/端點拖拉/牆拖曳 promote＆移動/門窗拖曳預覽 |
| `handleMouseUp(e)` | L1351 | 結束各種拖曳 |
| `handleWheel(e)` | L1392 | 滾輪縮放（對準滑鼠位置，Y 軸錨點已修正） |
| `handleFlip()` | L1407 | 翻轉門/窗 |
| `handleClick(e)` | L1412 | 選取/放置柱/畫牆第二點/放置門窗 |
| `getHint()` | L1505 | 底部狀態提示文字 |

---

## App 元件 — Render 層衍生值（L1483–L1503）

| 名稱 | 行號 | 說明 |
|------|------|------|
| `activeWT` | L1483 | 目前選用的牆種類物件 |
| `preview` | L1484 | 畫牆第一點後的線段預覽 |
| `activeCT` | L1485 | 目前選用的柱種類物件 |
| `colPreview` | L1486 | 柱放置預覽物件 |
| `openingPreview` | L1488 | 門/窗放置預覽物件（用 `activeDoorTypeId`/`activeWindowTypeId` 決定寬度） |

---

## JSX 結構摘要（L1524–1828）

```
<div>                           // 根容器
  <div>                         // 工具列 (top: 16, left: 16)
    PLACE_MODES 按鈕              // 柱/牆/門/窗模式切換
    牆模式時（L1534）：            // 牆種類 dropdown + 新增
    柱模式時（L1572）：            // RC/H 選擇 + 柱種類 dropdown + 新增
    門/窗模式時（L1614）：         // 門/窗種類 dropdown + 新增（doorTypes/windowTypes，鏡像牆/柱種類 UI）
    選取牆時：                    // 牆種類 select
    選取柱時：                    // 柱種類 select
    selected > 0：               // 刪除按鈕
    清除按鈕
    「匯入 DXF」（L1701–1739）：   // <label>+隱藏 <input type=file>，onChange 直接 fetch
                                  // POST http://localhost:5000/api/upload-dxf，
                                  // 用回傳的 walls/columns 直接疊加到 rawWalls/columns（DXF 原始座標）
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

> **注意**：`<text>` 在 Y-flip `<g>` 內會上下顛倒，需用 `<g transform="translate(cx,cy) scale(1,-1)">` 補償（見 WallDimAnnotation L685）
> pan `offsetY` 方向已修正為反號（`origOffsetY - dy`，見 `handleMouseMove` L1252），拖曳跟手

---

## 已知限制

- ⚠️ **DXF 匯入尚未大量測試**：只用 `test.dxf` 驗證過（4 牆 + 5 柱），真實圖面未測；
  `pair_walls`/`cluster_columns` 的配對參數（`backend/dxf_parser.py` L5–10）是針對這份測試圖調的，
  換圖可能要重調；匯入後牆與角柱的接合裁切是否正確也還沒驗證
- DXF 解析只處理 LINE / LWPOLYLINE
- per-wall thickness 已完成（牆-牆/牆-柱/門窗接合幾何）；仍用全域 `THICKNESS` 的只剩「開口放置
  click 容差」與「拖放 dead-zone」（互動容差，非接合幾何）
- 改既有門窗種類寬度不會套用到「已放置」的開口（需 `findOpeningGroup` 重算 ptA/ptB，目前是 deferred stretch）
- 幾何測試（`scratchpad/extract_and_test.js`，27/27 pass）尚未收進 repo，沒有正式 `npm test`
- 斜牆不支援（`applyOrthoLock` 強制水平/垂直；接合幾何本身是向量算的，理論上支援斜角但未測）
