"""dxf_parser 回歸測試（獨立腳本，不需 pytest）：

    python test_parser.py

涵蓋：
1. 幻影柱修正 — WINDOW/DOOR 圖層的線不得被 cluster_columns 誤判成柱
2. 正常匯入不受影響 — test.dxf 仍還原 4 牆 + 5 柱
"""
import os
import tempfile
import ezdxf
from dxf_parser import parse_dxf


def _box(msp, cx, cy, w, h, layer):
    """在 msp 畫一個矩形框（4 條 LINE）。"""
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    for a, b in zip(pts, pts[1:]):
        msp.add_line(a, b, dxfattribs={"layer": layer})


def test_phantom_column_excluded():
    """WINDOW 圖層的窗框（牆厚×窗寬小方框）不該變成柱。"""
    doc = ezdxf.new("R2010")
    for name in ("WALL", "DOOR", "WINDOW"):
        doc.layers.add(name)
    msp = doc.modelspace()
    # 一道牆（兩條平行線，相距 15，長 200）在 WALL 層
    msp.add_line((0, 0), (200, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 15), (200, 15), dxfattribs={"layer": "WALL"})
    # 一根真柱（30×30 方框）在 WALL 層
    _box(msp, 100, 100, 30, 30, "WALL")
    # 一個窗框（15×80 小方框）在 WINDOW 層 —— 若不排除會被誤判成柱
    _box(msp, 300, 50, 15, 80, "WINDOW")

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        res = parse_dxf(path)
    finally:
        os.unlink(path)

    assert res["col_count"] == 1, f"期望 1 柱（窗框不算），實際 {res['col_count']}"
    c = res["columns"][0]
    assert abs(c["cx"] - 100) < 1 and abs(c["cy"] - 100) < 1, f"柱位置錯誤：{c}"
    assert res["wall_count"] == 1, f"期望 1 牆，實際 {res['wall_count']}"
    print("[OK] test_phantom_column_excluded：窗框未被誤判成柱（1 牆 1 柱）")


def test_source_layer_preserved():
    """匯入時牆/柱記住來源 DXF 圖層（供匯出放回同一圖層）。"""
    doc = ezdxf.new("R2010")
    doc.layers.add("A-WALL")
    doc.layers.add("A-COL")
    msp = doc.modelspace()
    # 一道牆（兩條平行線）在 A-WALL 層
    msp.add_line((0, 0), (200, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 15), (200, 15), dxfattribs={"layer": "A-WALL"})
    # 一根柱在 A-COL 層
    _box(msp, 100, 100, 30, 30, "A-COL")

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        res = parse_dxf(path)
    finally:
        os.unlink(path)

    assert res["wall_count"] == 1 and res["col_count"] == 1, res
    assert res["walls"][0]["layer"] == "A-WALL", f"牆圖層={res['walls'][0].get('layer')}"
    assert res["columns"][0]["layer"] == "A-COL", f"柱圖層={res['columns'][0].get('layer')}"
    print("[OK] test_source_layer_preserved：牆記 A-WALL、柱記 A-COL")


def test_normal_import_unaffected():
    """test.dxf（無 DOOR/WINDOW 圖層）仍還原 4 牆 + 5 柱。"""
    test_dxf = os.path.join(os.path.dirname(__file__), "..", "test.dxf")
    if not os.path.exists(test_dxf):
        print("[SKIP] test_normal_import_unaffected：找不到 test.dxf")
        return
    res = parse_dxf(test_dxf)
    assert res["wall_count"] == 4, f"期望 4 牆，實際 {res['wall_count']}"
    assert res["col_count"] == 5, f"期望 5 柱，實際 {res['col_count']}"
    print("[OK] test_normal_import_unaffected：test.dxf 仍為 4 牆 + 5 柱")


if __name__ == "__main__":
    test_phantom_column_excluded()
    test_source_layer_preserved()
    test_normal_import_unaffected()
    print("=== 全部通過 ===")
