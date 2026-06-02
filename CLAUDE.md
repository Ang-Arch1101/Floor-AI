# FloorAI 專案快照
> 討論時間：2026 年 5 月｜用途：帶入新對話視窗的上下文參考

---

## 目前進度（2026-05）

**剛完成：** 牆與牆接合（L角 / T型 / 十字），含拖曳牆到 T型接合的 snap + 缺口渲染
**下一個：** 門窗與牆——截斷牆線、產生開口、移動時補回與重截

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

**功能開發優先順序：**
1. 門窗與牆（截斷、開口、移動補回）← 下一個
2. 牆與柱（邊界接合）← 已完成
3. 牆與牆（轉角、T字、十字接合）← 已完成

遇到跨優先級的需求，提醒使用者當前階段範圍。

---

## 一、專案定位

**定位**：AutoCAD 平面修改加速器（「比 CAD 聰明、比 Revit 輕量」）

- 牆、門、窗、柱是有**語意的物件**（不是單純的線條）
- 操作介面輕如 bubble diagram（拖拉、點選）
- 輸出結果是**乾淨的 CAD 線條**，直寫進已開啟的 AutoCAD 視窗
- 從「修改現有平面」切入，而非「AI 生成」，阻力最小、自用頻率最高

### 真實痛點（AutoCAD 修改平面的繁瑣步驟）
- 移動門：BR 截斷牆線 → S 拉伸 → 反覆選控制點
- 柱牆邊界接合：手動 trim 多餘線條
- 對齊用臨時線忘記刪除
- 斷線需要 cha / join 補回
- Z 高程不同導致線條接不起來

---

## 二、核心物件

### Phase 1（幾何優先，標註暫緩）
| 物件 | 幾何描述 |
|------|----------|
| 牆 | 兩條平行線 + 厚度（`THICKNESS = 15`），是其他物件的載體 |
| 門 | 截斷牆線、產生開口、加門框線／門弧（`DOOR_WIDTH = 80`）|
| 窗 | 截斷牆線、產生開口、加窗框線（`WINDOW_WIDTH = 80`）|
| RC 柱 | 方形，與牆線邊界接合（`COL_W = 80, COL_H = 100`）|
| H 鋼柱 | H 型鋼斷面，包在方形框內 |

### 幾何關係優先順序
| 順序 | 關係 | 狀態 |
|------|------|------|
| Phase 1 | 門窗與牆 | ⏳ 下一個 |
| Phase 2 | 牆與柱 | ✅ 完成 |
| Phase 3 | 牆與牆（L / T / 十字） | ✅ 完成 |

---

## 三、技術架構

| 層級 | 技術 | 狀態 |
|------|------|------|
| 前端 | React（`src/App.js` 單檔） | 原型完成 |
| 後端 | Python + Flask | 原型完成 |
| CAD 整合 | pywin32 COM API | 可跑通，穩定性待強化 |
| AI | Anthropic API (claude-sonnet) | 待整合 |

**最大技術瓶頸**：COM API 穩定性（AutoCAD 版本差異、視窗焦點、物件釋放時機）

---

## 四、前端架構（`src/App.js`）

### 資料結構
- `rawWalls`：所有物件的唯一資料來源（牆段 / 門 / 窗）
  - 牆段：`{ start: {x,y}, end: {x,y} }`
  - 門：`{ isDoor: true, ptA, ptB, nx, ny, ux, uy, flipped }`
  - 窗：`{ isWindow: true, ptA, ptB, nx, ny, ux, uy }`
- `columns`：`{ cx, cy, type: 'rc'|'h', rotated }`
- `selected`：`[{ type: 'rawWall'|'col', idx }]`

### 主要函式
| 函式 | 說明 |
|------|------|
| `snap(v)` | 吸附到 `GRID=20` 格點 |
| `applyOrthoLock(pt, ref)` | 正交鎖定（畫牆時） |
| `getNorm(start, end)` | 取得牆的單位法向量與長度 |
| `computeWallLines(start, end)` | 計算兩條 offset 線座標 |
| `splitByWallIntersections(newWall, rawWalls)` | 畫新牆時處理 T 型交叉截斷 |
| `getWallGaps(wall, rawWalls)` | 計算十字接合的缺口（render time） |
| `computeAllMiters(rawWalls)` | 計算所有 L 角的 miter 端點 |
| `clipStubEnd(px, py, rawWalls, currentWall)` | T 型接合：stub 端點截到 through-wall 外緣 |
| `computeWallDragInfo(wall, idx, rawWalls, columns)` | 計算牆拖曳的移動限制與 snap 點 |
| `placeOpening(walls, wallIdx, clickPt, type, flipped)` | 在牆上放置門或窗 |

### 操作模式（`mode` state）
- `column`：放置柱（C 鍵），空白鍵旋轉，支援 RC / H 鋼柱
- `wall`：畫牆（W 鍵），點第一點 → 點第二點，正交鎖定
- `door`：放門（D 鍵），靠近牆自動吸附
- `window`：放窗（N 鍵），靠近牆自動吸附
- `select`（ESC）：選取、拖曳、Delete 刪除

### Snap 系統
- 畫牆 snap：`applyWallSnap()` 兩階段
  - Phase 1：游標在牆 body 內 → snap 到中心線（紅圈顯示在中心線）
  - Phase 2：游標靠近外緣（`FACE_SNAP_EPS = THICKNESS/2 + 10`）→ snap 到中心線，紅圈顯示在外緣
- 拖牆 snap：snap 到連接牆的端點/中點（紅圈顯示在目標點本身）

### 已知限制（暫緩）
- 斜牆支援：disabled，待斜牆接合邏輯完成後開放
- 建築語意 snap 點（柱心、內緣）：已規劃，未實作

---

## 五、牆接合邏輯（核心）

### 資料層（畫牆時發生）
- **L 角**：`computeAllMiters()` 計算 miter 端點，`useMemo` 快取
- **T 型（新牆為 stub）**：`splitByWallIntersections()` 截斷新牆，使其端點在 through-wall 外緣
- **十字接合**：資料層不截斷，gap 在 render time 計算

### Render 層（每次渲染重算）
- `getWallGaps(wall, rawWalls)`：
  - 十字接合（`!tAisEndpoint && !tBisEndpoint`）：計算兩側 gap
  - T 型（`tBisEndpoint`）：只計算近側（stub 接近那面）的 gap，遠側維持實線
  - 用 `EdgeWithGaps` 渲染缺口線段
- `clipStubEnd(px, py, rawWalls, currentWall)`：
  - 偵測端點是否在 through-wall body（normalDist < 2）
  - 用 `faceIntersect()` 算 stub 兩條 offset 線與 through-wall 外緣的精確交點

### 拖牆到 T 型接合（drag-created T-join）
- `computeWallDragInfo()` 的 `constraintFromOther()`：允許 centerline 對齊 through-wall 端點（無 THICKNESS/2 內縮）
- 對齊後：`clipStubEnd` 偵測到端點在 through-wall body，自動截到外緣
- `getWallGaps` 的 `tBisEndpoint` 路徑：在 through-wall 近側外緣產生 T 型缺口

---

## 六、研究方向（中後期）

### CAD 匯入判別
- 靠幾何特徵區分牆（兩平行長線）與柱（封閉輪廓、長寬比接近 1）
- 已知邊界問題：短牆 vs 柱、T/L/十字收頭、柱貼牆黏連

### 平面立面連動
- 平面修改 → 自動標示對應立面需更新位置
- 使用場景：廠房、捲門、大型開口、晚期業主變更

---

## 七、開發者背景

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
| 展開運算子 `...` | ⏳ |
| 可選鏈 `?.` | ⏳ |
| React `useState` / `useMemo` | ⏳ |
