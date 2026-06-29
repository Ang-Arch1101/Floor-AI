# FloorAI 專案快照
> 討論時間：2026 年 6 月｜用途：帶入新對話視窗的上下文參考

---

## 目前進度（2026-06）

**剛完成（本次 session，DXF 匯入）：**
1. DXF 解析（backend `dxf_parser.py`）— **平行線配對還原牆 + 碎片分群還原柱**
   - 牆：DXF 用「雙線」（兩個面，間距≈厚度）表示，`pair_walls` 配對平行線 → 一道牆（中心線 + thickness）
   - 柱：角柱用 L 折線描邊，`cluster_columns` 依端點鄰近分群 → bounding box；closed 矩形 LWPOLYLINE 直接認柱
   - 已對 `test.dxf` 驗證：4 道牆（t=15）+ 5 根柱（40×60）
2. `app.py` 修正 — 回傳 `walls` + `columns`（先前漏回傳 columns）
3. 前端匯入 — 直接用 DXF 原始座標（DXF 的 0,0 對齊世界原點十字，不重新置中）
4. pan offsetY 方向修正（拖曳跟手）

**下一個：** 牆接合邏輯改 per-wall thickness（見「已知限制」）；確認牆柱接合裁切

**先前完成：** 無限畫布 pan/zoom、牆端點拖拉、牆/柱種類系統、Ctrl+Z/Y 復原

**目前分支：** `claude/dxf-import-local`

---

## 行為規則（每次對話遵守）

這個專案同時兼顧功能開發與程式學習。
推進功能時，回答任務依序涵蓋：
1. **概念**：這個東西在做什麼、為什麼這樣設計
2. **最小實作**：只做夠用的部分
3. **理解驗證**：讓使用者能用自己的話解釋剛才做了什麼

每次開啟新對話，主動說明目前功能進度與下一個目標，不等使用者詢問。

**程式碼修改原則：**
- 修改前先讀相關檔案的呼叫方與共用工具，不確定為何這樣設計時先問再動。
- 遇到兩種衝突的寫法，選一個並說明原因，不混用。
- 有跳過或未完成的事要明說，不能用「完成」帶過。

---

## 一、專案定位

**定位**：AutoCAD 平面修改加速器（「比 CAD 聰明、比 Revit 輕量」）

- 牆、門、窗、柱是有**語意的物件**（不是單純的線條）
- 操作介面輕如 bubble diagram（拖拉、點選）
- 輸出結果是**乾淨的 CAD 線條**，直寫進已開啟的 AutoCAD 視窗
- 從「修改現有平面」切入，而非「AI 生成」，阻力最小、自用頻率最高

---

## 二、核心物件

### Phase 1（幾何優先，標註暫緩）
| 物件 | 幾何描述 |
|------|----------|
| 牆 | 兩條平行線 + 厚度（`THICKNESS = 15` 預設，可用種類覆寫）|
| 門 | 截斷牆線、產生開口、加門框線／門弧（`DOOR_WIDTH = 80`）|
| 窗 | 截斷牆線、產生開口、加窗框線（`WINDOW_WIDTH = 80`）|
| RC 柱 | 方形，與牆線邊界接合（尺寸從 colTypes 查詢）|
| H 鋼柱 | H 型鋼斷面，包在方形框內 |

### 幾何關係優先順序
| 順序 | 關係 | 狀態 |
|------|------|------|
| Phase 1 | 門窗與牆 | ⏳ 規劃中 |
| Phase 2 | 牆與柱 | ✅ 完成 |
| Phase 3 | 牆與牆（L / T / 十字） | ✅ 完成 |

---

## 三、技術架構

| 層級 | 技術 | 狀態 |
|------|------|------|
| 前端 | React（`src/App.js` 單檔） | 原型完成 |
| 後端 | Python + Flask（`backend/`） | DXF 匯入完成 |
| DXF 解析 | ezdxf | 牆/柱還原完成 |
| CAD 整合 | pywin32 COM API | 可跑通，穩定性待強化 |
| AI | Anthropic API (claude-sonnet) | 待整合 |

### 後端架構（`backend/`）
- `app.py`：Flask，`POST /api/upload-dxf` 接收 DXF，回傳 `{ walls, columns, raw_count, wall_count, col_count }`
- `dxf_parser.py`：
  - `parse_dxf(path)`：主流程，LINE/LWPOLYLINE → segments，配對牆 + 分群柱
  - `pair_walls(segments)`：貪婪配對平行線段 → 牆 `{start:[x,y], end:[x,y], thickness}`，回傳 `(walls, leftover)`
  - `try_pair(a, b, ...)`：兩線段平行 + 間距∈[8,30] + 重疊≥50 → 一道牆（中心線 + 量到的厚度）
  - `cluster_columns(segments)`：union-find 依端點鄰近（<50）分群 → bounding box → 柱 `{cx,cy,w,h,angle}`
  - `detect_rect_from_lwpoly(entity)`：closed 4-頂點矩形 LWPOLYLINE → 柱
  - 參數常數：`GAP_MIN/MAX`（牆厚範圍）、`OVERLAP_MIN`、`CLUSTER_GAP`、`MAX_COL`
- 測試檔：`test.dxf`（根目錄）— 4 牆 + 5 柱（含一根遠處孤立參考柱 x≈5070）

---

## 四、前端架構（`src/App.js`）

### 資料結構
- `rawWalls`：所有物件的唯一資料來源（牆段 / 門 / 窗）
  - 牆段：`{ start: {x,y}, end: {x,y}, typeId, thickness }`
  - 門：`{ isDoor: true, ptA, ptB, nx, ny, ux, uy, flipped }`
  - 窗：`{ isWindow: true, ptA, ptB, nx, ny, ux, uy }`
- `columns`：`{ cx, cy, type: 'rc'|'h', rotated, typeId, w, h }`
- `wallTypes`：`[{ id, name, thickness }]`（預設一筆 wt1）
- `colTypes`：`[{ id, name, w, h }]`（預設一筆 ct1）
- `selected`：`[{ type: 'rawWall'|'col', idx }]`
- `viewTransform`：`{ scale, offsetX, offsetY }`（無限畫布）
- `history` / `future`：undo/redo 快照堆疊

### 主要函式
| 函式 | 說明 |
|------|------|
| `snap(v)` | 吸附到 `GRID=20` 格點 |
| `applyOrthoLock(pt, ref)` | 正交鎖定（畫牆時） |
| `getNorm(start, end)` | 取得牆的單位法向量與長度 |
| `computeWallLines(start, end, thickness?)` | 計算兩條 offset 線座標，thickness 可選 |
| `screenToWorld(sx, sy)` | 畫面座標 → 世界座標（Y 朝上） |
| `worldToScreen(wx, wy)` | 世界座標 → 畫面座標 |
| `splitByWallIntersections(newWall, rawWalls)` | 畫新牆時處理 T 型交叉截斷 |
| `getWallGaps(wall, rawWalls)` | 計算十字接合的缺口（render time） |
| `computeAllMiters(rawWalls)` | 計算所有 L 角的 miter 端點 |
| `clipStubEnd(px, py, rawWalls, currentWall)` | T 型接合：stub 端點截到 through-wall 外緣 |
| `computeWallDragInfo(wall, idx, rawWalls, columns)` | 計算牆拖曳的移動限制與 snap 點 |
| `placeOpening(walls, wallIdx, clickPt, type, flipped)` | 在牆上放置門或窗 |
| `saveHistory()` | 捕捉目前 rawWalls+columns 快照到 history stack |
| `undo()` / `redo()` | Ctrl+Z / Ctrl+Y 復原 |

### 操作模式（`mode` state）
- `column`：放置柱（C 鍵），空白鍵旋轉，支援 RC / H 鋼柱
- `wall`：畫牆（W 鍵），點第一點 → 點第二點，正交鎖定
- `door`：放門（D 鍵），靠近牆自動吸附
- `window`：放窗（N 鍵），靠近牆自動吸附
- `select`（ESC）：選取、拖曳、Delete 刪除；選取牆段顯示端點控制點

### DXF 匯入（工具列「匯入 DXF」）
- `<input type=file>` onChange → POST 到 backend → 取得 `data.walls` / `data.columns`
- 直接用 DXF 原始座標（不重新置中）：DXF 的 (0,0) 對齊世界原點十字，重複匯入會重疊
- walls → rawWalls（用後端量到的 thickness）；columns → columns（用後端 bbox 的 w/h）
- 匯入前 `saveHistory()`，可 Ctrl+Z 還原

### 無限畫布（viewTransform）
- 世界座標系：Y 朝上，`screenToWorld` / `worldToScreen` 換算
- SVG 場景內容包在 `<g transform="matrix(...)">` 裡
- 中鍵拖曳平移（`panning` state）
- 滾輪縮放，對準滑鼠位置（`handleWheel`）
- 原點十字標記在 `<g transform>` 之外，隨 pan/zoom 更新

### 座標換算
```javascript
screenToWorld(sx, sy) → { x: (sx - offsetX) / scale, y: (svgH - sy - offsetY) / scale }
worldToScreen(wx, wy) → { x: wx*scale + offsetX, y: svgH - (wy*scale + offsetY) }
```
**注意：** pan offsetY 已修正為反號（`origOffsetY - dy`），拖曳跟手

### 牆端點拖拉
- 選取單一牆段 → 兩端出現綠色控制點（r=6，固定像素大小）
- 控制點渲染在 `<g transform>` 之外，用 `worldToScreen` 定位
- hit test 在 handleMouseDown，threshold 10px（畫面座標）
- `endpointDrag` state：`{ wallIdx, endpoint: 'start'|'end' }`

### Snap 系統
- 畫牆 snap：`applyWallSnap()` 兩階段，per-wall thickness
- 拖牆 snap：snap 到連接牆的端點/中點

### 種類系統
- `wallTypes` / `colTypes`：可在工具列新增 / 編輯 / 刪除
- 編輯後即時更新所有引用該 typeId 的物件
- 刪除若有引用物件，顯示確認提示；最後一筆禁止刪除
- `activeWallTypeId` / `activeColTypeId`：新畫物件使用的種類

### Undo/Redo
- `saveHistory()` 在各操作完成前呼叫（畫牆、放柱、拖曳開始、刪除、種類修改）
- mousemove 中的連續更新不呼叫（避免過多快照）
- 最多保留 50 步

### 已知限制（暫緩）
- 斜牆支援：disabled
- **牆接合邏輯用固定厚度**：`computeAllMiters`, `clipStubEnd`, `getWallGaps`, `computeWallDragInfo` 仍用全域 `THICKNESS`（尚未 per-wall）← 使用者點名「對齊邏輯是舊的」，下次處理
- DXF 牆柱接合裁切待確認（匯入後牆與角柱的接合處是否正確）
- DXF 解析只處理 LINE / LWPOLYLINE；柱配對參數（GAP/CLUSTER）對 test.dxf 調過，其他圖面可能需調

---

## 五、牆接合邏輯（核心）

### 資料層（畫牆時發生）
- **L 角**：`computeAllMiters()` 計算 miter 端點，`useMemo` 快取
- **T 型（新牆為 stub）**：`splitByWallIntersections()` 截斷新牆，使其端點在 through-wall 外緣
- **十字接合**：資料層不截斷，gap 在 render time 計算

### Render 層（每次渲染重算）
- `getWallGaps(wall, rawWalls)` → `EdgeWithGaps` 渲染缺口
- `clipStubEnd(px, py, rawWalls, currentWall)` → stub 端點截到 through-wall 外緣

---

## 六、開發者背景

- 建築師，主要工作是接手舊版平面稍作修改
- 程式背景：曾用 AI 協作開發 Google Maps API 餐廳抽籤工具
- 學習目標：產品開發與程式並重，寧可慢也要兼顧
- 學習框架：概念 → 最小實作 → 理解驗證（能用自己的話解釋）

### JavaScript 學習進度
| 項目 | 狀態 |
|------|------|
| `!hit`、`1e-6`、`&&` / `\|\|` | ✅ |
| 解構賦值 `const { a } = obj` | ✅ |
| 箭頭函式 `(v) => v * 2` | ✅ |
| 陣列方法：`forEach` / `map` / `filter` / `some` / `findIndex` | ✅ |
| 展開運算子 `...` | ✅ |
| 可選鏈 `?.` | ✅ |
| React `useState` / `useMemo` / `useRef` / `useEffect` | ✅ |
