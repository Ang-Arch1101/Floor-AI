# FloorAI

AutoCAD 平面修改加速器 — 比 CAD 聰明、比 Revit 輕量。

牆、門、窗、柱是有語意的物件，可拖拉點選操作，輸出乾淨的 CAD 線條直接寫入 AutoCAD。

---

## 啟動方式

```bash
npm start
```

開啟 http://localhost:3000

---

## 操作快捷鍵

| 按鍵 | 功能 |
|------|------|
| W | 畫牆模式 |
| C | 放柱模式 |
| D | 放門模式 |
| N | 放窗模式 |
| ESC | 回到選取模式（按兩次確保退出） |
| Space | 旋轉柱（放柱模式中） |
| Delete | 刪除選取物件 |
| Ctrl+Z | 復原（最多 50 步） |
| Ctrl+Y | 重做 |
| 滾輪 | 縮放畫布 |
| 中鍵拖曳 | 平移畫布 |

---

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | React（`src/App.js` 單檔） |
| 後端 | Python + Flask |
| CAD 整合 | pywin32 COM API |

---

## 目前分支

- `master`：穩定版
- `claude/merge-infinite-canvas-wall-anchoring`：開發中（PR #3）

詳細開發紀錄見 [CLAUDE.md](./CLAUDE.md)
