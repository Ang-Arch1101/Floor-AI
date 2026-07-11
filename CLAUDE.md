# FloorAI 專案快照
> 討論時間：2026 年 6 月｜用途：帶入新對話視窗的上下文參考

---

## 目前進度（2026-06）

**剛完成（本次 session）：**
1. **接合幾何全面 per-wall thickness** — 牆-牆、牆-柱、門窗開口的接合不再寫死 `THICKNESS/2`，
   各物件用自己的 `thickness`。涉及 `getWallGaps`（拆 hSelf/hOther）、`computeMiter`（加 hA/hB 參數）、
   `clipStubEnd`、`splitByWallIntersections`、`getColGaps`、`getFixedEnd`、`computeWallDragInfo`。
   不同厚度的牆接 L / T / 十字才對齊；等厚時退化回原結果。
2. **門窗與牆完整化**（roadmap Phase 1 門窗與牆關係）：
   - 開口 + 切出來的左右牆段都繼承宿主牆 `thickness`/`typeId`（先前 `placeOpening` 會把牆段重設回 15）
   - `DoorSegment`/`WindowSegment` 門框線用宿主牆厚；門弧半徑用實際門扇跨距
   - `mergeOpening` 刪開口時還原牆段 thickness/typeId
   - **門窗寬度種類系統**：`doorTypes`/`windowTypes`（`{id,name,width}`），鏡像 wallTypes/colTypes，
     工具列可新增/選/編/刪，存 localStorage。開口記自己的門/窗種類 id（與牆 typeId 不同命名空間）
3. **分支整理** — 修掉 PR #4 對齊 regression、rebase 到新 master（`88d27a0`），分支現為 `claude/dxf-import`
4. **幾何測試法** — `scratchpad/extract_and_test.js` 用 Babel 抽出 App.js 純函式跑斷言（27/27 pass）。
   ⚠️ 尚未收進 repo、沒有 `npm test`

5. **PR #4（DXF 匯入流程）已 merge 進 master**（merge commit `cc92f02`）。放棄了另一條純前端
   解析路線（PR #6，已關閉未合併）；現在的 DXF 匯入是後端 Flask + ezdxf 的版本。
6. **UI 重構（對齊 Revit 邏輯）** — 頂部 Ribbon 分群工具列（建模/修改/檔案）、左側性質面板
   （Type Selector + 選取物件性質）、底部狀態列。四種類型表（牆/柱/門/窗）統一成 `typePanelCfg`
   + `renderTypeList()` 一套 UI。已用 Playwright 截圖驗證三種面板狀態。
7. **Bug 修正**：`deleteSelected` 刪門/窗時，合併回來的牆段先前會丟失 `typeId`/`thickness`
   （牆厚 fallback 回 15），已補上。
8. **DXF 匯出 MVP** — 閉環「匯入→修改→輸出」的輸出端第一步：
   - **`src/geometry.js` 抽離**：所有純幾何函式搬出 App.js（App.js 1893→1319 行），
     渲染管線與匯出共用同一套接合計算
   - **`npm test` 進 repo**：`src/geometry.test.js` 12 個斷言（miter/gap/T 裁切/匯出組裝）
   - `buildExportGeometry()`：收集「畫面上實際渲染的幾何」（miter/T 裁切/十字缺口/柱裁切
     都反映在線段上）→ `{lines, arcs}`
   - 後端 `POST /api/export-dxf`：ezdxf 產 R2010 DXF，`$INSUNITS=5`（公分）、
     WALL/DOOR/WINDOW 分圖層、預留 scale 參數
   - Ribbon 檔案群「匯出 DXF」按鈕 → 下載 `floorai.dxf`
   - **Round-trip 驗證通過**：Playwright 匯出下載 → 回傳 `/api/upload-dxf` → 3 牆（厚 15）
     + 1 柱完整還原；ezdxf 重讀確認圖層/單位正確
   - **單位正式定為 1 world unit = 1 cm**（牆 15、門 80 的語意）
9. **匯出/round-trip 修正（PR #7 回饋）**：
   - 門弧改 `DASHED` 線型（先前匯出成實線）
   - RC 柱併入 `WALL` 圖層（`LAYER_REMAP`，先前在獨立 COL 層）
   - **幻影柱修正**：parser 改看圖層，跳過 `DOOR`/`WINDOW`（`OPENING_LAYERS`）——先前 re-import
     時窗框（牆厚×窗寬的小方框）會被 `cluster_columns` 誤判成柱，一個窗多一根幻影柱
   - 驗證：Flask test client 端到端確認門弧 DASHED、柱在 WALL 層；5 場景 round-trip（無開口/
     多窗/多門/門窗同牆/大小柱混合）柱數全對；瀏覽器全鏈路 E2E（匯出下載→回傳匯入）4 柱無幻影
   - 回歸測試進 repo：`backend/test_parser.py`（幻影柱 + test.dxf 正常匯入）
10. **圖層保留（匯入來源層→匯出同層）**：
    - parser 記每道牆/柱的**來源 DXF 圖層**（`try_pair` 取線段 a 的層、`cluster_columns` 取群內最多數層）
    - 前端匯入的 rawWalls/columns 帶 `layer` 欄；`placeOpening`/`mergeOpening`/刪除合併都保留
    - `buildExportGeometry` 用物件的 `layer`（沒有的—FloorAI 新畫—用預設 WALL/COL/DOOR/WINDOW）
    - 後端匯出**依需要建圖層**：來源層（如 `A-WALL`）原樣輸出、預設白色；FloorAI 預設層配 ACI 色
    - 驗證：`test_source_layer_preserved`（牆記 A-WALL、柱記 A-COL）+ 完整 round-trip（A-WALL/A-COL/
      WALL 混合匯出→再匯入圖層全保留）

> ⚠️ **DXF 匯入尚未大量測試** — 目前只用 repo 裡的 `test.dxf` 這一份測試圖驗證過（4 牆 + 5 柱），
> 還沒拿真實圖面跑過。`pair_walls`/`cluster_columns` 的配對參數（牆厚範圍 8–30、柱群聚距離 50）
> 是針對這份測試圖調的，換一張真實圖面很可能要重新調整，牆柱接合裁切是否正確也還沒驗證。
> 在確認這點之前，不要把 DXF 匯入當成穩定可用的功能。

**下一個（候選，待使用者選）：**
- AutoCAD COM 寫回（pywin32，需使用者 Windows + AutoCAD 實機測試）
- DXF 匯入/匯出用真實圖面驗證 — 真實圖多為 mm 單位（牆厚 100–300），
  匯入的 GAP 參數與匯出的 scale 都需要單位/比例處理
- 資料模型地基：物件穩定 id、專案檔 JSON 儲存/開啟、undo 納入類型表
- 互動優化：性質面板長度直接輸入、改類型寬度套用到已放置開口、框選

**先前完成：** DXF 匯入（後端 ezdxf 牆/柱還原，已 merge）、無限畫布 pan/zoom、牆端點拖拉、
牆/柱種類系統、Ctrl+Z/Y 復原

**目前分支：** `claude/dxf-import-progress-qtdbet`（已同步至 master `cc92f02`）

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
| Phase 1 | 門窗與牆 | ✅ 完成（開口繼承牆厚 + 門窗寬度種類） |
| Phase 2 | 牆與柱 | ✅ 完成 |
| Phase 3 | 牆與牆（L / T / 十字） | ✅ 完成 |

---

## 三、技術架構

| 層級 | 技術 | 狀態 |
|------|------|------|
| 前端 | React（`src/App.js` + `src/geometry.js`） | 原型完成 |
| 幾何模組 | `src/geometry.js`（純函式，含 `npm test`） | 完成 |
| 後端 | Python + Flask（`backend/`） | DXF 匯入/匯出完成 |
| DXF 解析 | ezdxf | 牆/柱還原 + 匯出完成 |
| CAD 整合 | pywin32 COM API | 可跑通，穩定性待強化 |
| AI | Anthropic API (claude-sonnet) | 待整合（PR #5 需 rebase） |

**單位約定：1 world unit = 1 cm**（牆厚 15、門寬 80 皆公分語意）；DXF 匯出 `$INSUNITS=5`。

### 後端架構（`backend/`）
- `app.py`：Flask
  - `POST /api/upload-dxf`：接收 DXF，回傳 `{ walls, columns, raw_count, wall_count, col_count }`
  - `POST /api/export-dxf`：收 `{lines, arcs, scale?}` → ezdxf 產 R2010 DXF → 回傳檔案下載
    - 圖層：`WALL`（牆 + RC 柱同層，`LAYER_REMAP` 把 COL 併進 WALL）、`DOOR`、`WINDOW`
    - 門弧用 `DASHED` 線型（對齊畫面虛線）；`$INSUNITS=5`
- `dxf_parser.py`：
  - `parse_dxf(path)`：主流程，LINE/LWPOLYLINE → segments，配對牆 + 分群柱
    - `DOOR`/`WINDOW` 圖層（`OPENING_LAYERS`）的線**不參與**牆/柱辨識——避免 round-trip 時
      窗框被誤判成柱（幻影柱）。一般 CAD 圖沒這些圖層名，不受影響
  - `pair_walls(segments)`：貪婪配對平行線段 → 牆 `{start:[x,y], end:[x,y], thickness}`，回傳 `(walls, leftover)`
  - `try_pair(a, b, ...)`：兩線段平行 + 間距∈[8,30] + 重疊≥50 → 一道牆（中心線 + 量到的厚度）
  - `cluster_columns(segments)`：union-find 依端點鄰近（<50）分群 → bounding box → 柱 `{cx,cy,w,h,angle}`
  - `detect_rect_from_lwpoly(entity)`：closed 4-頂點矩形 LWPOLYLINE → 柱
  - 參數常數：`GAP_MIN/MAX`（牆厚範圍）、`OVERLAP_MIN`、`CLUSTER_GAP`、`MAX_COL`
- 測試檔：`test.dxf`（根目錄）— 4 牆 + 5 柱（含一根遠處孤立參考柱 x≈5070）

---

## 四、前端架構（`src/App.js` + `src/geometry.js`）

> 純幾何函式（接合計算、匯出組裝）都在 `src/geometry.js`，與 React 無關，
> `npm test` 直接對它斷言；App.js 只剩元件、狀態與互動。下表函式除 UI handler 外多屬 geometry.js，
> 完整行號對照見 `docs/code-index.md`。

### 資料結構
> 匯入的物件多帶一個 `layer`（來源 DXF 圖層），匯出時放回同一圖層；FloorAI 新畫的物件無 `layer`，用預設層。
- `rawWalls`：所有物件的唯一資料來源（牆段 / 門 / 窗）
  - 牆段：`{ start: {x,y}, end: {x,y}, typeId, thickness, layer? }`
  - 門：`{ isDoor: true, ptA, ptB, nx, ny, ux, uy, flipped, width, typeId, thickness }`
    - `typeId`→`doorTypes`（門寬）；`thickness`=宿主牆厚（只給 jamb 渲染用）；`width`=開口跨距
  - 窗：`{ isWindow: true, ptA, ptB, nx, ny, ux, uy, width, typeId, thickness }`（`typeId`→`windowTypes`）
  - 開口兩側切出的牆段繼承宿主牆 `typeId`/`thickness`
- `columns`：`{ cx, cy, type: 'rc'|'h', rotated, typeId, w, h }`
- `wallTypes`：`[{ id, name, thickness }]`（預設一筆 wt1）
- `colTypes`：`[{ id, name, w, h }]`（預設一筆 ct1）
- `doorTypes`：`[{ id, name, width }]`（預設 dt1 單開門 80）
- `windowTypes`：`[{ id, name, width }]`（預設 nt1 一般窗 80）
  - ⚠️ 開口的 `typeId` 指向 door/window 種類，**與牆段的 `typeId`（指向 wallTypes）是不同命名空間**
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

### UI 佈局（仿 Revit 三區）
- **Ribbon（頂部）**：`RibbonGroup` 分群 — 建模（柱/牆/門/窗）、修改（選取/刪除）、檔案（匯入 DXF/清除）。
  放「動詞」：要做什麼。
- **性質面板（左側 264px）**：`renderProperties()` — 選取優先顯示物件性質（類型下拉 + 參數列 `PropRow`），
  否則依模式顯示 Type Selector（`typePanelCfg` × `renderTypeList()`，四種類型表共用一套 UI）。
  放「名詞」：用什麼類型做。
- **狀態列（底部）**：`getHint()` 操作提示。
- 畫布包在 flex 容器裡（不再是全螢幕絕對定位）；座標函式用 `svgRef` 的實際尺寸，不受佈局影響。

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
- **DXF 匯入尚未大量測試** — 只驗證過 `test.dxf`，真實圖面未測；柱配對參數（GAP/CLUSTER）是
  針對這份測試圖調的，其他圖面可能需調；牆柱接合裁切是否正確也待確認。**目前不能當穩定功能用。**
- DXF 解析只處理 LINE / LWPOLYLINE
- 斜牆支援：disabled（畫牆強制正交 `applyOrthoLock`；接合幾何是向量算的、理論上支援斜角但未測）
- **per-wall thickness 已完成**（牆-牆/牆-柱/門窗）。唯二仍用全域 `THICKNESS` 的是「門窗開口的
  放置 click 容差」與「拖放 dead-zone」——屬互動容差、非接合幾何，影響小，暫留
- 改既有門窗種類寬度 → 尚未套用到「已放置」的開口（需 `findOpeningGroup` 重算 ptA/ptB）。
  目前只支援「新放置用選定寬度」
- **匯出檔 re-import 時，門窗不會還原成開口**（parser 跳過 DOOR/WINDOW 圖層，只還原牆+柱）。
  要把開口還原回來屬「寄宿式資料模型」重構的範圍，暫緩。實際工作流是讀真實圖→改→匯出，
  少會 re-import 自己的匯出，影響小
- **牆被開口切成獨立段**：放門窗會把一道牆 splice 成「左段+開口+右段」三個物件（切割式模型），
  牆非單一實體、匯出時開口處牆面線歸在開口圖層。改成寄宿式（牆保持一體）是待決定的大重構
- AutoCAD COM 寫回未做（匯出到 DXF 檔為止）；undo 快照不含四張類型表

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
