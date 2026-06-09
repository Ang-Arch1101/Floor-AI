---
name: column-snap-decisions
description: 牆拖曳 snap 靠近柱時的退縮設計（2026-06）
metadata: 
  node_type: memory
  type: project
  originSessionId: ff4f1f37-9d96-420c-b932-124e2e3a6c5f
---

## 問題（2026-06-09 修復）

拖曳牆靠近柱時，snap 目標是柱四角落原始座標。  
投影到牆法向量後，snap 讓牆中心線對齊柱面 → 牆邊線超出柱面 thickness/2。

## 修法

`computeWallDragInfo()` 的 snapPoints 改用退縮後的角落：

```javascript
const h_wall = (wall.thickness ?? THICKNESS) / 2;
const adjustedCorners = [
  { x: col.cx - hw + h_wall, y: col.cy - hh + h_wall },
  { x: col.cx + hw - h_wall, y: col.cy - hh + h_wall },
  { x: col.cx - hw + h_wall, y: col.cy + hh - h_wall },
  { x: col.cx + hw - h_wall, y: col.cy + hh - h_wall },
];
snapPoints.push(...adjustedCorners, { x: col.cx, y: col.cy });
```

**limitMin / limitMax 不動**（物理邊界不變，仍用原始 corners）

## 效果

| 方向 | 舊 snap | 新 snap | 結果 |
|------|---------|---------|------|
| 水平牆 | cy±hh | cy±hh∓h_wall | 牆上/下緣 = 柱上/下緣 |
| 垂直牆 | cx±hw | cx±hw∓h_wall | 牆左/右緣 = 柱左/右緣 |

柱中心點（cx, cy）保留不動。
