# FloorAI 程式碼索引
> 更新：2026-07-08｜對應：DXF 匯出 MVP 完成後（geometry.js 抽離 + UI 重構 + PR #4 merge）

> ⚠️ **DXF 匯入尚未大量測試** — 只驗證過 `test.dxf`，真實圖面未測，配對參數/接合裁切可能需要調整。
> 詳見本檔案最後的「已知限制」與 `CLAUDE.md`。

**單位約定**：世界座標 1 unit = 1 cm（牆厚 15、門寬 80 皆為公分語意）；DXF 匯出寫 `$INSUNITS=5`。

---

## 後端（`backend/`）

### `backend/app.py`（111 行）
| 內容 | 行號 | 說明 |
|------|------|------|
| `EXPORT_LAYERS` | L13 | 匯出圖層與 ACI 顏色：WALL/COL/DOOR/WINDOW |
| `POST /api/upload-dxf` | L22 | 接收 `.dxf` 檔，呼叫 `parse_dxf`，回傳 `{walls, columns, ...}` |
| `POST /api/export-dxf` | L52 | 收 `{lines, arcs, scale?}` → ezdxf R2010、`$INSUNITS=5`、分圖層寫 LINE/ARC → 回傳檔案下載 |

### `backend/dxf_parser.py`（197 行）
| 名稱 | 行號 | 說明 |
|------|------|------|
| 參數常數 `GAP_MIN/GAP_MAX/OVERLAP_MIN/CLUSTER_GAP/MAX_COL/PARALLEL_TOL` | L5–10 | 牆厚範圍、重疊下限、柱群聚距離、容差，都是針對 `test.dxf` 調的 |
| `detect_rect_from_lwpoly(entity)` | L13 | closed 4-頂點矩形 LWPOLYLINE → 柱 `{cx,cy,w,h,angle}` |
| `try_pair(a, b, ...)` | L39 | 兩線段平行 + 間距 8–30 + 重疊 ≥50 → 配成一道牆（中心線 + 量到的厚度） |
| `pair_walls(segments)` | L84 | 貪婪配對平行線段成牆，回傳 `(walls, leftover)` |
| `cluster_columns(segments, ...)` | L107 | union-find 依端點鄰近（<50）把零散線段分群 → bounding box 當柱 |
| `parse_dxf(file_path)` | L161 | 主流程：ezdxf 讀 LINE/LWPOLYLINE → segments，配對成牆 + 分群成柱 |

- 測試檔：根目錄 `test.dxf`（4 牆 + 5 柱）
- 依賴：`flask`、`flask-cors`、`ezdxf`（`pip install flask flask-cors ezdxf`，`python app.py` 監聽 :5000）

---

## 幾何模組（`src/geometry.js`，825 行）— 與 React 無關的純函式

App.js 渲染管線與 DXF 匯出共用；`npm test` 直接對這裡斷言（`src/geometry.test.js`，12 個測試）。

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
| `distToWall(pt, wall)` | L40 | 點到牆中心線的最短距離 |
| `ptBetweenWallLines(pt, wall)` | L49 | 點是否在牆體範圍內（per-wall thickness） |
| `distToOpening(pt, obj)` | L58 | 點到門/窗中心的距離 |
| `projectOnWall(pt, wall)` | L64 | 點在牆上的投影參數 t（0–1） |
| `getFixedEnd(wall, rawWalls)` | L71 | 判斷哪端是 T 型固定端 |
| `placeOpening(walls, wallIdx, clickPt, type, flipped, openingType)` | L92 | 插入門/窗（截成3段，繼承宿主牆厚） |
| `findOpeningGroup(walls, idx)` | L122 | 找門/窗的左右相鄰牆段 |
| `mergeOpening(walls, group)` | L128 | 合併三段回一段（還原 typeId/thickness） |
| `getColCorners(col)` / `ptInCol(pt, col)` | L136/L144 | 柱範圍計算與命中測試 |
| `splitWallByColumns` / `splitAllWallsByColumn` | L151/L199 | 牆被柱截斷（資料層） |
| `segIntersectT(...)` | L208 | 線段交叉 → `{tA,tB}` |

### 接合幾何（render 層與匯出共用）
| 函式 | 行號 | 說明 |
|------|------|------|
| `splitByWallIntersections(newWall, rawWalls)` | L223 | 畫新牆時的 T/十字截斷（資料層） |
| `getWallGaps(wall, rawWalls)` | L309 | 十字接合缺口（hSelf/hOther 各用自己厚度） |
| `getColGaps(col, rawWalls)` | L386 | 柱四邊缺口 |
| `clipOffsetLineOutsideCol(...)` | L421 | offset 線裁到柱外 |
| `computeMiter(wallA, wallB, hA?, hB?)` | L445 | L 角 miter 點 |
| `computeAllMiters(rawWalls)` | L464 | 所有 L 角 miter（per-wall 厚度） |
| `computeWallDragInfo(...)` | L518 | 牆拖曳限制與 snap 點 |
| `clipStubEnd(px, py, rawWalls, currentWall)` | L602 | T 型 stub 端點裁到貫穿牆外緣 |

### DXF 匯出組裝（L647–785）
| 函式 | 行號 | 說明 |
|------|------|------|
| `splitEdgeByGaps(x0,y0,x1,y1,gaps)` | L647 | 一條邊被 gaps 切開後的子線段（EdgeWithGaps 的計算部分） |
| `wallExportLines(wall, rawWalls, columns, miter)` | L664 | 對應 WallSegment：miter/T 裁切 → 柱裁切 → 缺口 |
| `doorExportGeometry(door)` | L696 | 對應 DoorSegment：2 門框線 + 門扇線 + 90° 開門弧（DXF ARC 逆時針） |
| `windowExportLines(win)` | L720 | 對應 WindowSegment：6 框線 + 2 玻璃線 |
| `columnExportLines(col, rawWalls)` | L738 | RC 柱四邊含缺口；H 柱外框+翼板+腹板 16 線 |
| `buildExportGeometry(rawWalls, columns)` | L767 | 主入口：整場景 → `{lines:[{x1,y1,x2,y2,layer}], arcs:[...]}` |

---

## 前端（`src/App.js`，1319 行）

### 全域 UI 元件（App 元件之外）
| 元件 | 行號 | 說明 |
|------|------|------|
| `EdgeWithGaps` | L39 | 含缺口的線段（把間隔裂開渲染） |
| `WallDimAnnotation` | L55 | 選取牆時的尺寸標註（含點擊觸發輸入） |
| `WallSegment` | L95 | 渲染單一牆段（miter/clip/gap，per-wall thickness） |
| `DoorSegment` | L132 | 渲染門（jamb 用宿主牆厚、弧半徑=門扇跨距） |
| `WindowSegment` | L143 | 渲染窗（雙線＋玻璃線） |
| `RCColumn` / `HColumn` | L151/L158 | 渲染柱 |
| `FlipIcon` | L164 | 門/窗翻轉圖示 |
| `isInSel(selected, item)` | L173 | 選取判斷 |
| `RibbonGroup` | L176 | Ribbon 分群容器 |
| `PropRow` | L186 | 性質面板參數列 |
| `PLACE_MODES` | L195 | 模式清單（柱/牆/門/窗） |

### App 元件（L202 起）
| 區塊 | 行號 | 說明 |
|------|------|------|
| useState 區 | L203–262 | rawWalls/columns/viewTransform/四種類型表與編輯狀態/history 等（同前版，見 CLAUDE.md 資料結構） |
| `wallMiters` useMemo | L264 | `computeAllMiters` 快取 |
| 鍵盤快捷鍵 useEffect | L269 | ESC/C/W/D/N/Space/Delete/Ctrl+Z/Y |
| localStorage 同步 useEffect | L301 | 六張表 |
| `saveHistory` / `undo` / `redo` | L310/L315/L323 | 復原系統 |
| `applyNewLength` | L331 | 輸入數值改牆長 |
| `handleClear` | L353 | 清除全部 |
| 類型 CRUD ×4 | L360–468 | wall/col/door/window 的 Add/Edit/Delete handler |
| `deleteSelected` | L470 | 刪除選取；刪門窗時合併段保留 typeId/thickness |
| `screenToWorld` / `worldToScreen` | L495/L503 | 座標換算（Y 朝上） |
| `getRawPt` / `getPoint` / `hitTest` | L511/L518/L520 | 滑鼠座標與命中 |
| `handleMouseDown` | L529 | 平移/端點拖拉/牆拖曳 pending/門窗拖曳 |
| `applyWallSnap` | L619 | 畫牆兩階段 snap |
| `handleMouseMove` / `handleMouseUp` | L666/L769 | 拖曳主邏輯 |
| `handleWheel` / `handleFlip` / `handleClick` | L810/L825/L830 | 縮放/翻轉/點擊放置 |
| `getHint` | L923 | 狀態列提示 |
| `typePanelCfg` | L950 | 四種類型表的面板設定 |
| `renderTypeList` / `renderProperties` | L998/L1041 | 性質面板（Type Selector / 物件性質） |
| return JSX | L1121– | 三區佈局 |

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
- 「匯出 DXF」按鈕：`buildExportGeometry(rawWalls, columns)` → POST `/api/export-dxf` → blob 下載 `floorai.dxf`
- 「匯入 DXF」：`<input type=file>` → POST `/api/upload-dxf` → walls/columns 疊加進 state（可 Ctrl+Z）

### 座標換算
```js
screenToWorld(sx, sy) → { x: (sx - offsetX) / scale, y: (svgH - sy - offsetY) / scale }
worldToScreen(wx, wy) → { x: wx*scale + offsetX, y: svgH - (wy*scale + offsetY) }
```
SVG `<g transform>`: `matrix(scale, 0, 0, -scale, offsetX, svgH - offsetY)`
> `<text>` 在 Y-flip `<g>` 內會顛倒，需 `scale(1,-1)` 補償（見 WallDimAnnotation）

---

## 測試

- `npm test`（react-scripts / jest）→ `src/geometry.test.js`：12 個斷言
  （splitEdgeByGaps、等厚/異厚 L 角 miter、十字缺口、T 型裁切、門/窗/柱/H柱匯出組裝）
- E2E round-trip 驗證過：匯出 → 下載 → 回傳 `/api/upload-dxf` → 3 牆（厚 15）+ 1 柱 還原成功

---

## 已知限制

- ⚠️ **DXF 匯入尚未大量測試**：只用 `test.dxf` 驗證過，真實圖面未測；配對參數
  （`backend/dxf_parser.py` L5–10）針對測試圖調的，換圖可能要重調
- DXF 解析只處理 LINE / LWPOLYLINE；真實圖面的 mm 單位（牆厚 100–300）會讓 GAP 參數失效，
  需要單位/比例處理
- AutoCAD COM 寫回未做（匯出目前到 DXF 檔為止）
- per-wall thickness 已完成；仍用全域 `THICKNESS` 的只剩開口放置 click 容差與拖放 dead-zone
- 改類型寬度不套用到已放置的開口；已放置開口不能換類型
- 斜牆不支援（正交鎖定）
- undo 快照不含四張類型表
