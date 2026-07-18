# FloorAI 專案快照
> 更新：2026-07｜用途：帶入新對話視窗的上下文參考

---

## 目前進度（2026-07）

### 已完成里程碑

**A. 畫布與物件基礎（已 merge）**
- 無限畫布 pan/zoom、牆端點拖拉、Ctrl+Z/Y 復原（最多 50 步）
- 牆/柱/門/窗種類系統（`wallTypes`/`colTypes`/`doorTypes`/`windowTypes`，可增/編/刪，localStorage）
- **接合幾何全面 per-wall thickness**：牆-牆/牆-柱/門窗開口的 L/T/十字接合不再寫死 `THICKNESS/2`，
  各物件用自己的 `thickness`（`getWallGaps` 拆 hSelf/hOther、`computeMiter` 加 hA/hB，等厚時退化回原結果）
- **門窗與牆完整化**：開口 + 切出的左右牆段繼承宿主牆 `thickness`/`typeId`；門框線用宿主牆厚、
  門弧半徑用實際門扇跨距；`mergeOpening` 還原
- **UI 重構對齊 Revit**：Ribbon 分群（建模/修改/檔案）+ 左側性質面板（`typePanelCfg` × `renderTypeList()`
  四類型表共用）+ 底部狀態列

**B. DXF 匯入 → 修改 → 匯出閉環**
- **匯入（PR #4，已 merge `cc92f02`）**：後端 Flask + ezdxf，平行線配對還原牆、碎片分群還原柱
  （放棄了純前端解析路線 PR #6）
- **匯出 MVP（PR #7）**：`src/geometry.js` 抽離（純幾何與 React 解耦，`npm test`）；
  `buildExportGeometry()` 收「畫面上實際渲染的幾何」（miter/T 裁切/十字缺口/柱裁切都反映在線段上）
  → 後端 ezdxf 產 R2010 DXF、`$INSUNITS=5`、分圖層；Ribbon「匯出 DXF」下載 `floorai.dxf`
- **round-trip 修正**：門弧改 `DASHED` 線型、RC 柱併入 `WALL` 層、**幻影柱修正**（parser 跳過
  `DOOR`/`WINDOW` 圖層——先前窗框會被 `cluster_columns` 誤判成柱）
- **圖層保留**：匯入的牆/柱記來源圖層，匯出放回同一層；**連顏色/線型/線寬也保留**
  （`read_layer_table` + 前端 `importedLayers` + 匯出 `setup=True` 載標準線型）；FloorAI 新畫的物件用預設層
- **測試**：前端 14（`geometry.test.js` 13 + App smoke）、後端 `test_parser.py` 5；
  5 場景 round-trip + 瀏覽器全鏈路 E2E + 圖層/外觀 round-trip 全通過

> ⚠️ **DXF 匯入尚未大量測試** — 只用 `test.dxf`（4 牆 + 5 柱）與自家 round-trip 驗過，真實圖面未測。
> `pair_walls`/`cluster_columns` 參數（牆厚 8–30、柱群聚 50）是針對測試圖調的，換真實圖很可能要重調，
> 牆柱接合裁切也還沒驗。**確認前不要把 DXF 匯入當穩定功能。**

**C. 框選 + 篩選（PR #8）**
- **窗選 / 框選**：select 模式空白處拖曳起框，方向決定語意——左→右=窗選（完全框住才選，藍實框）、
  右→左=框選（碰到即選，綠虛框），對齊 AutoCAD 肌肉記憶；Ctrl 拖曳可累加選取
- **篩選**：左側性質面板（select 閒置時）三個類別開關（牆／柱／門窗），控制框選抓哪些物件
- 純幾何判定在 `geometry.js`（`boxSelect` + `pointInRect`/`rectsOverlap`/`segIntersectsRect`），
  App.js 只做互動與矩形 overlay 渲染
- **改門窗型別寬度套用到已放置開口**：`reflowOpening` 合回宿主牆再依同一中心重放，塞不下者跳過並提示；
  選取單一開口也能在性質面板換型別即重排
- 測試：前端共 23 通過（`boxSelect` +5、`reflowOpening` +4）

**D. DXF 匯入前選圖層 + 圖層分角色（本分支，含真實 Revit 圖面實測）**
- 背景：使用者的真實圖面是 Revit 匯出的 DWG（先用 ODA File Converter 轉 DXF），圖層數遠比
  `test.dxf` 複雜——標註/文字/剖面線/家具都可能跟牆柱線混在一起，不篩選會被 `pair_walls` 誤配成假牆
- 匯入改兩段式：選檔案 → 後端 `scan_layers()` 只掃描各圖層線段數量（不辨識）→ 前端跳出圖層標記
  面板（依圖層名稱關鍵字猜測預選牆/柱角色，仍可手動調整）→ 確認後帶 `wall_layers`/`col_layers`
  兩個白名單再真正呼叫 `parse_dxf()` 辨識
- **真實圖實測發現「幻影柱」新成因並修正**：只勾牆圖層（不含任何柱圖層）去跑，牆轉角/T 型交接
  配不出來的碎片被 `cluster_columns` 誤判成 23 根假柱——`test.dxf` 因為牆都是簡單獨立線段、
  沒有轉角複雜度，從未暴露這個問題。**修正：圖層分角色**——`parse_dxf(path, wall_layers, col_layers)`
  牆圖層的線只餵 `pair_walls`、柱圖層的線只餵 `cluster_columns`，牆配對剩餘的碎片直接丟棄、
  不會流入柱辨識（`wall_layers`/`col_layers` 皆為 `None` 時沿用舊版共用池行為，向後相容）
- **真實圖其餘實測結果**：`$INSUNITS=5`（公分，跟 FloorAI 慣例一致，不用轉換單位）；牆厚中位數
  17cm，落在既有 `GAP_MIN=8/GAP_MAX=30` 內不用重調；柱圖層標對後乾淨辨識出 26 根柱（65~90cm
  方柱，無雜訊）；6331 條線完全不篩選硬跑約 20 秒（能接受，但沒有進度條會像卡住）
- 後端新增 `POST /api/scan-dxf-layers`；`_collect_geometry()` 抽出共用的實體收集邏輯，
  `parse_dxf()` 依是否傳入 `wall_layers`/`col_layers` 走「共用池」或「分角色」兩條路徑
- 測試：後端新增 4 筆（圖層計數、白名單過濾誤配標註、柱圖層白名單排除家具方框、
  **牆角碎片不再誤判成柱的迴歸測試**——直接對照真實圖發現的問題），共 9 筆通過
- ⚠️ **只吃 DXF，不支援 DWG**（ezdxf 讀不了私有二進位格式），Revit 使用者需先轉檔
  （AutoCAD 另存 DXF，或本機用 ODA File Converter，避免圖面上傳到線上轉檔網站）
- ⚠️ 圖層角色猜測（關鍵字 `wall`/`牆`/`墙`、`col`/`柱`）只是預填方便，不保證準，使用者仍需確認

### 下一個（候選，待使用者選）
- AutoCAD COM 寫回（pywin32，需 Windows + AutoCAD 實機）
- 資料模型地基：物件穩定 id、專案檔 JSON 儲存/開啟、undo 納入類型表
- 技術債：`localhost:5000` 寫死 → package.json proxy + 相對路徑（整合 PR #5 時一起）

**目前分支：** `claude/window-selection-filtering-jnlgaq`（框選 + 篩選 + DXF 匯入前選圖層）

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
  - `POST /api/scan-dxf-layers`：接收 DXF，只掃描（不辨識）→ 回傳 `{ layers: [{name, count, color, linetype}] }`，
    供前端「匯入前選圖層」面板列清單
  - `POST /api/upload-dxf`：接收 DXF + 可選 `include_layers`（JSON 陣列字串，圖層白名單）→
    回傳 `{ walls, columns, raw_count, wall_count, col_count }`；不帶 `include_layers` 沿用舊行為（不篩選）
  - `POST /api/export-dxf`：收 `{lines, arcs, scale?}` → ezdxf 產 R2010 DXF → 回傳檔案下載
    - 圖層：`WALL`（牆 + RC 柱同層，`LAYER_REMAP` 把 COL 併進 WALL）、`DOOR`、`WINDOW`
    - 門弧用 `DASHED` 線型（對齊畫面虛線）；`$INSUNITS=5`
- `dxf_parser.py`：
  - `scan_layers(path)`：列出每個圖層的 LINE/LWPOLYLINE 數量（不辨識），供匯入前選圖層 UI 用
  - `parse_dxf(path, include_layers=None)`：主流程，LINE/LWPOLYLINE → segments，配對牆 + 分群柱
    - `DOOR`/`WINDOW` 圖層（`OPENING_LAYERS`）的線**不參與**牆/柱辨識——避免 round-trip 時
      窗框被誤判成柱（幻影柱）。一般 CAD 圖沒這些圖層名，不受影響
    - `include_layers`：白名單時只有清單內圖層參與辨識（其餘線段整段跳過）；
      **Revit 等軟體匯出常有十幾二十個圖層**（標註/文字/剖面線/家具），不篩選容易把標註線
      誤配成牆——這是匯入前選圖層 UI 存在的原因
  - `pair_walls(segments)`：貪婪配對平行線段 → 牆 `{start:[x,y], end:[x,y], thickness}`，回傳 `(walls, leftover)`
  - `try_pair(a, b, ...)`：兩線段平行 + 間距∈[8,30] + 重疊≥50 → 一道牆（中心線 + 量到的厚度）
  - `cluster_columns(segments)`：union-find 依端點鄰近（<50）分群 → bounding box → 柱 `{cx,cy,w,h,angle}`
  - `detect_rect_from_lwpoly(entity)`：closed 4-頂點矩形 LWPOLYLINE → 柱
  - 參數常數：`GAP_MIN/MAX`（牆厚範圍）、`OVERLAP_MIN`、`CLUSTER_GAP`、`MAX_COL`
- 測試檔：`test.dxf`（根目錄）— 4 牆 + 5 柱（含一根遠處孤立參考柱 x≈5070）
- ⚠️ **只吃 DXF，不支援 DWG**（ezdxf 讀不了私有二進位格式）。Revit/AutoCAD 匯出的 DWG
  需先轉檔（AutoCAD 另存 DXF，或用免費的 ODA File Converter 本機轉檔，避免上傳圖面到線上轉檔網站）

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
- `importedLayers`：`[{ name, color, linetype, lineweight }]` — 匯入 DXF 的來源圖層外觀，
  匯出時隨 payload 送回後端放回同樣設定（localStorage 持久化，依 name 合併）
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

### DXF 匯入（工具列「匯入 DXF」，兩段式：先選圖層再辨識）
- 選檔案 → `handleDxfFileSelected` POST `/api/scan-dxf-layers`（只掃描，不辨識）→
  開 `layerPicker` 圖層勾選面板（畫面正中 modal），預設全選
- 面板按「確認匯入」→ `confirmDxfImport` 帶 `include_layers`（勾選的圖層名）POST `/api/upload-dxf`
  → 取得 `data.walls` / `data.columns`（只有勾選圖層的線段參與牆/柱辨識）
- 直接用 DXF 原始座標（不重新置中）：DXF 的 (0,0) 對齊世界原點十字，重複匯入會重疊
- walls → rawWalls（用後端量到的 thickness）；columns → columns（用後端 bbox 的 w/h）
- 匯入前 `saveHistory()`，可 Ctrl+Z 還原
- 為什麼要兩段式：Revit 等軟體匯出常有十幾二十個圖層（標註/文字/剖面線/家具），
  全部丟進去做「平行線配對成牆」容易把標註線誤配成牆——見 `dxf_parser.py` 的 `scan_layers`/`include_layers`

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
- ✅ 改既有門窗種類寬度 → **已套用到「已放置」的開口**（`reflowOpening` 合回宿主牆再依同一中心重放；
  塞不下者跳過並提示）；選取單一開口也能在性質面板換型別即重排
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
