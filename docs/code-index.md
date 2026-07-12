# FloorAI 程式碼索引
> 更新：2026-07-12｜對應：DXF 匯入/匯出 + 圖層保留完成（PR #7）

> ⚠️ **DXF 匯入尚未大量測試** — 只驗證過 `test.dxf` 與自家 round-trip，真實圖面未測；
> 配對參數/單位/接合裁切可能需要調整。詳見本檔案最後的「已知限制」與 `CLAUDE.md`。

**單位約定**：世界座標 1 unit = 1 cm（牆厚 15、門寬 80 皆為公分語意）；DXF 匯出寫 `$INSUNITS=5`。

---

## 後端（`backend/`）

### `backend/app.py`（138 行）
| 內容 | 行號 | 說明 |
|------|------|------|
| `EXPORT_LAYERS` | L13 | 匯出預設圖層與 ACI 顏色：WALL/DOOR/WINDOW |
| `LAYER_REMAP` | L19 | `{COL: WALL}` — FloorAI 新畫的 RC 柱併入 WALL 圖層 |
| `POST /api/upload-dxf` | L23 | 接收 `.dxf`，呼叫 `parse_dxf`，回傳 `{walls, columns, layers, ...}` |
| `POST /api/export-dxf` | L54 | 收 `{lines, arcs, scale?, layers?}` → ezdxf R2010（`setup=True` 載標準線型）、`$INSUNITS=5` → 回傳檔案下載 |
| `ensure_layer`（export 內） | L84 | 依需要建圖層：來源層套回 `layers` 傳來的顏色/線型/線寬（非標準線型退回 CONTINUOUS）；FloorAI 預設層配 ACI 色 |
| `DASHED` 線型 + 門弧套用 | L78 / L120 | 門弧匯出成虛線，對齊畫面 `strokeDasharray` |

### `backend/dxf_parser.py`（238 行）
| 名稱 | 行號 | 說明 |
|------|------|------|
| 參數常數 `GAP_MIN/GAP_MAX/OVERLAP_MIN/CLUSTER_GAP/MAX_COL/PARALLEL_TOL` | L5–10 | 牆厚範圍、重疊下限、柱群聚距離、容差，都是針對 `test.dxf` 調的 |
| `detect_rect_from_lwpoly(entity)` | L13 | closed 4-頂點矩形 LWPOLYLINE → 柱（帶來源 layer） |
| `try_pair(a, b, ...)` | L39 | 兩線段平行 + 間距 8–30 + 重疊 ≥50 → 一道牆（中心線 + 厚度 + 取 a 的 layer） |
| `pair_walls(segments)` | L84 | 貪婪配對平行線段成牆，回傳 `(walls, leftover)` |
| `cluster_columns(segments, ...)` | L108 | union-find 依端點鄰近（<50）分群 → bounding box 當柱；layer 取群內最多數 |
| `OPENING_LAYERS` | L170 | `{DOOR, WINDOW}` — 這些圖層的線跳過牆/柱辨識（防幻影柱） |
| `parse_dxf(file_path)` | L173 | 主流程：讀 LINE/LWPOLYLINE（每 segment 記 layer、跳過開口圖層）→ 配對牆 + 分群柱 |
| `read_layer_table(doc)` | L220 | 讀來源圖層表 `[{name,color,linetype,lineweight}]`（跳過 0/Defpoints，負色正規化）|

- 測試檔：根目錄 `test.dxf`（4 牆 + 5 柱）
- 回歸測試：`backend/test_parser.py`（獨立 assert 腳本，`python test_parser.py`，5 個測試）——
  幻影柱排除、來源圖層保留、圖層外觀讀取、關閉圖層負色正規化、test.dxf 正常匯入
- 依賴：`backend/requirements.txt`（`pip install -r requirements.txt`，`python app.py` 監聽 :5000）

---

## 幾何模組（`src/geometry.js`，828 行）— 與 React 無關的純函式

App.js 渲染管線與 DXF 匯出共用；`npm test` 直接對這裡斷言（`src/geometry.test.js`，13 個測試）。

### 常數（L4–12、L221）
`GRID=20`、`THICKNESS=15`、`DOOR_WIDTH=80`、`WINDOW_WIDTH=80`、`WINDOW_INSET=8`、
`GLASS_OFFSET=1`、`FLIP_ICON_OFFSET=28`、`COL_W=80`、`COL_H=100`、`ENDPOINT_EPS=0.02`

### 基礎與物件操作
| 函式 | 行號 | 說明 |
|------|------|------|
| `snap(v)` | L14 | 吸附到 GRID 格點 |
| `applyOrthoLock(pt, ref)` | L16 | 正交鎖定 |
| `getNorm(start, end)` | L23 | 取單位法向量 → `{dx,dy,len,nx,ny}` |
| `computeWallLines(start, end, thickness?)` | L30 | 計算兩條 offset 線 → `{line1,line2}` |
| `distToWall` / `ptBetweenWallLines` / `distToOpening` / `projectOnWall` | L40/L49/L58/L64 | 距離與命中測試工具 |
| `getFixedEnd(wall, rawWalls)` | L71 | 判斷哪端是 T 型固定端 |
| `placeOpening(walls, wallIdx, clickPt, type, flipped, openingType)` | L92 | 插入門/窗（截成3段，繼承宿主牆厚/typeId/layer） |
| `findOpeningGroup` / `mergeOpening` | L122/L128 | 找開口左右牆段 / 合併三段回一段（還原 typeId/thickness/layer） |
| `getColCorners` / `ptInCol` | L136/L144 | 柱範圍計算與命中測試 |
| `splitWallByColumns` / `splitAllWallsByColumn` | L151/L199 | 牆被柱截斷（資料層） |
| `segIntersectT(...)` | L208 | 線段交叉 → `{tA,tB}` |

### 接合幾何（render 層與匯出共用）
| 函式 | 行號 | 說明 |
|------|------|------|
| `splitByWallIntersections(newWall, rawWalls)` | L223 | 畫新牆時的 T/十字截斷（資料層） |
| `getWallGaps(wall, rawWalls)` | L309 | 十字接合缺口（hSelf/hOther 各用自己厚度） |
| `getColGaps(col, rawWalls)` | L386 | 柱四邊缺口 |
| `clipOffsetLineOutsideCol(...)` | L421 | offset 線裁到柱外 |
| `computeMiter(wallA, wallB, hA?, hB?)` / `computeAllMiters(rawWalls)` | L445/L464 | L 角 miter（per-wall 厚度） |
| `computeWallDragInfo(...)` | L518 | 牆拖曳限制與 snap 點 |
| `clipStubEnd(px, py, rawWalls, currentWall)` | L602 | T 型 stub 端點裁到貫穿牆外緣 |

### DXF 匯出組裝（L647–786）
| 函式 | 行號 | 說明 |
|------|------|------|
| `splitEdgeByGaps(x0,y0,x1,y1,gaps)` | L647 | 一條邊被 gaps 切開後的子線段（EdgeWithGaps 的計算部分） |
| `wallExportLines(wall, rawWalls, columns, miter)` | L664 | 對應 WallSegment：miter/T 裁切 → 柱裁切 → 缺口 |
| `doorExportGeometry(door)` | L696 | 對應 DoorSegment：2 門框線 + 門扇線 + 90° 開門弧（DXF ARC 逆時針） |
| `windowExportLines(win)` | L720 | 對應 WindowSegment：6 框線 + 2 玻璃線 |
| `columnExportLines(col, rawWalls)` | L738 | RC 柱四邊含缺口；H 柱外框+翼板+腹板 16 線 |
| `buildExportGeometry(rawWalls, columns)` | L769 | 主入口：整場景 → `{lines:[{x1,y1,x2,y2,layer}], arcs}`；每物件用自己的 `layer`（無則預設 WALL/COL/DOOR/WINDOW） |

---

## 前端（`src/App.js`，1337 行）

### 全域 UI 元件（App 元件之外）
| 元件 | 行號 | 說明 |
|------|------|------|
| `EdgeWithGaps` | L39 | 含缺口的線段（把間隔裂開渲染） |
| `WallDimAnnotation` | L55 | 選取牆時的尺寸標註（含點擊觸發輸入） |
| `WallSegment` | L95 | 渲染單一牆段（miter/clip/gap，per-wall thickness） |
| `DoorSegment` / `WindowSegment` | L132/L143 | 渲染門（jamb 用宿主牆厚、弧半徑=門扇跨距）/ 窗（雙線＋玻璃線） |
| `RCColumn` / `HColumn` | L151/L158 | 渲染柱 |
| `FlipIcon` / `isInSel` | L164/L173 | 門窗翻轉圖示 / 選取判斷 |
| `RibbonGroup` / `PropRow` | L176/L186 | Ribbon 分群容器 / 性質面板參數列 |
| `PLACE_MODES` | L195 | 模式清單（柱/牆/門/窗） |

### App 元件（L202 起）
| 區塊 | 行號 | 說明 |
|------|------|------|
| useState 區 | L203–271 | rawWalls/columns/viewTransform/四張類型表/`importedLayers`(L230)/history 等（見 CLAUDE.md 資料結構） |
| `wallMiters` useMemo | L268 | `computeAllMiters` 快取 |
| 鍵盤快捷鍵 useEffect | L273 | ESC/C/W/D/N/Space/Delete/Ctrl+Z/Y |
| localStorage 同步 useEffect | L305 | rawWalls/columns/四張類型表/`importedLayers` |
| `saveHistory` / `undo` / `redo` | L315/L320/L328 | 復原系統 |
| `applyNewLength` / `handleClear` | L336/L358 | 輸入數值改牆長 / 清除全部 |
| 類型 CRUD ×4 | L365–473 | wall/col/door/window 的 Add/Edit/Delete handler |
| `deleteSelected` | L475 | 刪除選取；刪門窗時合併段保留 typeId/thickness/layer |
| `screenToWorld` / `worldToScreen` | L500/L508 | 座標換算（Y 朝上） |
| `getRawPt` / `getPoint` / `hitTest` | L516/L523/L525 | 滑鼠座標與命中 |
| `handleMouseDown` / `applyWallSnap` | L534/L624 | 平移/端點拖拉/牆拖曳 pending/門窗拖曳；畫牆兩階段 snap |
| `handleMouseMove` / `handleMouseUp` | L671/L774 | 拖曳主邏輯 |
| `handleWheel` / `handleFlip` / `handleClick` | L815/L830/L835 | 縮放/翻轉/點擊放置 |
| `getHint` | L928 | 狀態列提示 |
| `typePanelCfg` / `renderTypeList` / `renderProperties` | L955/L1003/L1046 | 性質面板（四類型表共用設定 / Type Selector / 物件性質） |
| return JSX | L1126– | 三區佈局 |

### JSX 結構（仿 Revit 三區）
```
<div flex column>
  Ribbon：建模（柱/牆/門/窗）｜修改（選取/刪除）｜檔案（匯入 DXF / 匯出 DXF / 清除）
  <div flex row>
    性質面板（264px）：renderProperties()
    畫布容器：<svg> 原點十字 + <g matrix Y-flip> 場景 </g> + 端點控制點
  </div>
  狀態列：getHint()
  editingDim 輸入框（fixed）
</div>
```
- 「匯出 DXF」：`buildExportGeometry(rawWalls, columns)` + `importedLayers` → POST `/api/export-dxf` → blob 下載 `floorai.dxf`
- 「匯入 DXF」：`<input type=file>` → POST `/api/upload-dxf` → walls/columns/layers 疊加進 state（可 Ctrl+Z）

### 座標換算
```js
screenToWorld(sx, sy) → { x: (sx - offsetX) / scale, y: (svgH - sy - offsetY) / scale }
worldToScreen(wx, wy) → { x: wx*scale + offsetX, y: svgH - (wy*scale + offsetY) }
```
SVG `<g transform>`: `matrix(scale, 0, 0, -scale, offsetX, svgH - offsetY)`
> `<text>` 在 Y-flip `<g>` 內會顛倒，需 `scale(1,-1)` 補償（見 WallDimAnnotation）

---

## 測試
- `npm test`（jest）→ `src/geometry.test.js`（13）+ `src/App.test.js`（1 UI smoke）＝ **14**
  （splitEdgeByGaps、等厚/異厚 miter、十字缺口、T 裁切、門/窗/柱/H柱匯出、layer 保留）
- `python backend/test_parser.py` → **5**（幻影柱、來源圖層、外觀讀取、負色正規化、test.dxf）
- E2E：Playwright 全鏈路（匯出下載→回傳匯入）+ 5 場景 round-trip + 圖層/外觀 round-trip

---

## 已知限制
- ⚠️ **DXF 匯入尚未大量測試**：只驗過 `test.dxf` 與自家 round-trip；配對參數（`dxf_parser.py` L5–10）
  針對測試圖調的，換真實圖可能要重調
- **真實圖多為 mm 單位**（牆厚 100–300）會讓 GAP 參數（cm、8–30）失效，需單位/比例處理
- **門窗 re-import 不還原成開口**（parser 跳過 DOOR/WINDOW，只還原牆+柱）；屬寄宿式重構範圍
- **牆被開口切成獨立段**（切割式模型）：放門窗把牆 splice 成三段，牆非單一實體
- `localhost:5000` 寫死在匯入/匯出 fetch（本機自用可行；部署或整合 PR #5 時改 proxy + 相對路徑）
- AutoCAD COM 寫回未做（匯出到 DXF 檔為止）
- per-wall thickness 已完成；仍用全域 `THICKNESS` 的只剩開口放置 click 容差與拖放 dead-zone
- 改類型寬度不套用到已放置的開口；斜牆不支援（正交鎖定）；undo 快照不含四張類型表
