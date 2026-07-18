"""dxf_parser 回歸測試（獨立腳本，不需 pytest）：

    python test_parser.py

涵蓋：
1. 幻影柱修正 — WINDOW/DOOR 圖層的線不得被 cluster_columns 誤判成柱
2. 正常匯入不受影響 — test.dxf 仍還原 4 牆 + 5 柱
"""
import os
import tempfile
import ezdxf
from dxf_parser import parse_dxf, scan_layers


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


def test_layer_appearance_captured():
    """匯入時讀出圖層的顏色/線型/線寬（供匯出放回同樣外觀）。"""
    doc = ezdxf.new("R2010", setup=True)
    doc.layers.add("A-WALL", color=2, linetype="CONTINUOUS")
    win = doc.layers.add("A-WIN", color=5, linetype="DASHED")
    win.dxf.lineweight = 25
    msp = doc.modelspace()
    msp.add_line((0, 0), (200, 0), dxfattribs={"layer": "A-WALL"})

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        res = parse_dxf(path)
    finally:
        os.unlink(path)

    by_name = {L["name"]: L for L in res["layers"]}
    assert by_name["A-WALL"]["color"] == 2, by_name["A-WALL"]
    assert by_name["A-WIN"]["color"] == 5, by_name["A-WIN"]
    assert by_name["A-WIN"]["linetype"] == "DASHED", by_name["A-WIN"]
    assert by_name["A-WIN"]["lineweight"] == 25, by_name["A-WIN"]
    print("[OK] test_layer_appearance_captured：讀出 A-WALL 黃、A-WIN 藍/DASHED/0.25")


def test_off_layer_color_normalized():
    """關閉的圖層 color 存負值 → 讀出時取絕對值（不會讓匯出建圖層時炸掉）。"""
    doc = ezdxf.new("R2010")
    lyr = doc.layers.add("A-OFF", color=3)
    lyr.off()  # 關閉圖層 → color 變 -3
    doc.modelspace().add_line((0, 0), (100, 0), dxfattribs={"layer": "A-OFF"})
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        res = parse_dxf(path)
    finally:
        os.unlink(path)
    off = next(L for L in res["layers"] if L["name"] == "A-OFF")
    assert off["color"] == 3, f"關閉圖層顏色應正規化為 3，實際 {off['color']}"
    print("[OK] test_off_layer_color_normalized：關閉圖層負色正規化為 +3")


def test_scan_layers_counts_geometry_per_layer():
    """scan_layers 列出每個圖層的 LINE/LWPOLYLINE 數量，不做牆/柱辨識。"""
    doc = ezdxf.new("R2010")
    for name in ("A-WALL", "A-DIMS", "A-TEXT"):
        doc.layers.add(name)
    msp = doc.modelspace()
    msp.add_line((0, 0), (200, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 15), (200, 15), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 0), (0, 15), dxfattribs={"layer": "A-DIMS"})
    # TEXT 實體不是 LINE/LWPOLYLINE，掃描不應計入
    msp.add_text("hello", dxfattribs={"layer": "A-TEXT"})

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        layers = scan_layers(path)
    finally:
        os.unlink(path)

    by_name = {L["name"]: L["count"] for L in layers}
    assert by_name.get("A-WALL") == 2, by_name
    assert by_name.get("A-DIMS") == 1, by_name
    assert "A-TEXT" not in by_name, "TEXT 實體不應被計入圖層掃描"
    print("[OK] test_scan_layers_counts_geometry_per_layer：圖層幾何數量正確、TEXT 被排除")


def test_include_layers_filters_recognition():
    """include_layers 白名單只讓指定圖層參與牆/柱辨識，其餘圖層的線被忽略。"""
    doc = ezdxf.new("R2010")
    for name in ("A-WALL", "A-DIMS"):
        doc.layers.add(name)
    msp = doc.modelspace()
    # 真牆在 A-WALL
    msp.add_line((0, 0), (200, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 15), (200, 15), dxfattribs={"layer": "A-WALL"})
    # 標註圖層剛好也有一對平行線，若不篩選會被誤配成第二道牆
    msp.add_line((0, 50), (200, 50), dxfattribs={"layer": "A-DIMS"})
    msp.add_line((0, 65), (200, 65), dxfattribs={"layer": "A-DIMS"})

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        path = tmp.name
    doc.saveas(path)
    try:
        unfiltered = parse_dxf(path)
        filtered = parse_dxf(path, include_layers=["A-WALL"])
    finally:
        os.unlink(path)

    assert unfiltered["wall_count"] == 2, "不篩選時應誤配出 2 道牆（含標註）"
    assert filtered["wall_count"] == 1, filtered
    assert filtered["walls"][0]["layer"] == "A-WALL", filtered["walls"][0]
    print("[OK] test_include_layers_filters_recognition：白名單排除 A-DIMS，只剩 1 道真牆")


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
    test_layer_appearance_captured()
    test_off_layer_color_normalized()
    test_scan_layers_counts_geometry_per_layer()
    test_include_layers_filters_recognition()
    test_normal_import_unaffected()
    print("=== 全部通過 ===")
