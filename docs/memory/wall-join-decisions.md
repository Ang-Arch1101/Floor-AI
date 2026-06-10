---
name: wall-join-decisions
description: T型/十字接合的幾何邏輯、clipStubEnd 與 getWallGaps 的設計取捨（2026-05）
metadata: 
  node_type: memory
  type: project
  originSessionId: efd1acf1-4dfc-417b-b09e-d990bc7d55cd
---

## clipStubEnd 重寫（2026-05）

**問題**：原版回傳 `px ± nO.nx*h`，把兩條 offset 線都 clip 到 through-wall 中心線高度 → 視覺潰縮

**修法**：改用 `faceIntersect(offsetSign)` — 求 stub 各 offset 線與 through-wall 外緣的實際交點

```
faceIntersect(1)  → stub 正側 offset 線 × through-wall 近側外緣
faceIntersect(-1) → stub 負側 offset 線 × through-wall 近側外緣
```

**Why:** stub 為水平、through-wall 為垂直時，兩條 offset 線分別在 hy±h，clip 點必須在對應 y 位置，不能都在 hy。

**How to apply:** clipStubEnd 判斷 isEnd（比較 px/py 與 wall.end），決定 preSign（決定是從哪個方向接近 through-wall）。

---

## getWallGaps T型缺口（2026-05）

**問題**：`tBisEndpoint`（stub 端點在 through-wall 中心線）時原本直接 skip → through-wall 無缺口

**修法**：移除 `if (tBisEndpoint) continue`，改為繼續計算 offset 線交叉

**近側 vs 遠側缺口**：
- stub offset 線自然終止於 through-wall 中心線，只碰得到近側外緣 → 近側有缺口 ✓
- 遠側外緣碰不到（stub 沒延伸過去）→ 遠側無缺口 ✓
- 曾嘗試延伸 stub offset 線讓遠側也有缺口，但使用者確認 T型接合只需近側有缺口，移除延伸

**Why:** 建築慣例：T型接合中，through-wall 只在 stub 接入那一側顯示缺口，另一側維持實線。

---

## constraintFromOther 去除 THICKNESS/2 內縮（2026-05）

**問題**：原本 `lo = min+half, hi = max-half` → 拖曳牆的中心線最多到 through-wall 端點內縮 7.5px → snap 被 clamp，無法對齊端點 → clipStubEnd 不觸發 → T型接合不出現

**修法**：改為 `lo = min, hi = max`，允許中心線對齊端點

**Why:** 中心線對齊端點 → `clipStubEnd` 偵測到端點在 body（normalDist = 0 < 2）→ 截到外緣 → T型接合正確觸發

---

## Snap 紅圈設計原則

- 紅圈永遠顯示在 **snap 目標點**，不是游標或被移動的物件位置
- `applyWallSnap()` 回傳 `{ pt, snapPt }`：`pt` 是游標吸附後座標，`snapPt` 是紅圈位置
- dragWall snap：`bestSnapPt` 從 snapPoints 迴圈取出（目標點本身），傳給 `setSnapIndicator`
