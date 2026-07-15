"""mcp_server 工具讀寫 floor_plan.json 的單元測試（獨立腳本，不需 pytest）：

    python test_mcp_server.py

涵蓋：
1. add_wall / add_column — snap 到 20 格點、由類型帶入厚度/尺寸、version 遞增
2. add_door / add_window — 吸附最近的牆、切成「左段+開口+右段」、繼承宿主牆屬性
3. layer 保留 — 匯入物件的來源圖層不被 MCP 修改洗掉
4. modify / delete — 部分欄位更新、刪開口自動合併回一道牆
5. 樂觀鎖 — replace_state 的 baseVersion 不符要被拒絕
"""
import os
import tempfile
from contextlib import contextmanager

import state_store
from state_store import read_state, replace_state, update_state
from mcp_server import (add_column, add_door, add_wall, add_window, clear_all,
                        delete_object, get_floor_plan, modify_column, modify_wall)


@contextmanager
def temp_state():
    """每個測試用獨立的暫存 floor_plan.json，不碰真的狀態檔。"""
    old = state_store.STATE_PATH
    with tempfile.TemporaryDirectory() as d:
        state_store.STATE_PATH = os.path.join(d, "floor_plan.json")
        try:
            yield
        finally:
            state_store.STATE_PATH = old


def _walls():
    return read_state()["rawWalls"]


def test_add_wall_snaps_and_uses_type():
    with temp_state():
        res = add_wall(1, 2, 199, 2)  # 沒對齊格點也要 snap 到 20 的倍數
        assert res["ok"]
        w = res["wall"]
        assert w["start"] == {"x": 0, "y": 0} and w["end"] == {"x": 200, "y": 0}, w
        assert w["typeId"] == "wt1" and w["thickness"] == 15
        assert isinstance(w["id"], str) and len(w["id"]) == 7
        assert read_state()["version"] == 1
        print("[OK] test_add_wall_snaps_and_uses_type")


def test_add_wall_rejects_unknown_type_and_zero_length():
    with temp_state():
        for call in (lambda: add_wall(0, 0, 100, 0, type_id="nope"),
                     lambda: add_wall(3, 3, 5, 5)):  # snap 後起訖同點
            try:
                call()
                assert False, "應該要 raise"
            except ValueError:
                pass
        assert read_state()["version"] == 0, "失敗的呼叫不該動到版本"
        print("[OK] test_add_wall_rejects_unknown_type_and_zero_length")


def test_add_column_defaults():
    with temp_state():
        res = add_column(110, 90, rotated=True)
        c = res["column"]
        assert c["cx"] == 120 and c["cy"] == 80  # snap
        assert c["type"] == "rc" and c["rotated"] is True
        assert c["w"] == 80 and c["h"] == 100  # ct1 尺寸
        print("[OK] test_add_column_defaults")


def test_add_door_splits_wall():
    with temp_state():
        add_wall(0, 0, 400, 0)
        res = add_door(200, 5, flipped=True)  # 稍偏離中心線也要吸附
        door = res["door"]
        walls = _walls()
        assert len(walls) == 3, f"牆應被切成 3 段，實際 {len(walls)}"
        left, mid, right = walls
        assert mid["isDoor"] and mid["flipped"] is True and mid["width"] == 80
        assert mid["id"] == door["id"] and mid["typeId"] == "dt1"
        # 開口置中：ptA=(160,0)、ptB=(240,0)
        assert abs(mid["ptA"]["x"] - 160) < 1e-6 and abs(mid["ptB"]["x"] - 240) < 1e-6
        # 兩側段繼承宿主牆 typeId/thickness，端點接在開口邊界
        for seg in (left, right):
            assert seg["typeId"] == "wt1" and seg["thickness"] == 15
        assert left["start"] == {"x": 0, "y": 0} and abs(left["end"]["x"] - 160) < 1e-6
        assert abs(right["start"]["x"] - 240) < 1e-6 and right["end"] == {"x": 400, "y": 0}
        print("[OK] test_add_door_splits_wall")


def test_add_window_snaps_to_nearest_wall():
    with temp_state():
        add_wall(0, 0, 400, 0)
        add_wall(0, 200, 400, 200)
        res = add_window(100, 180)  # 離 y=200 那道牆較近
        win = res["window"]
        assert win["isWindow"] and abs(win["ptA"]["y"] - 200) < 1e-6
        assert win["typeId"] == "nt1" and win["width"] == 80
        assert len(_walls()) == 4  # 1 完整牆 + (左段+窗+右段)
        print("[OK] test_add_window_snaps_to_nearest_wall")


def test_add_opening_requires_nearby_wall():
    with temp_state():
        add_wall(0, 0, 400, 0)
        try:
            add_door(200, 500)  # 距離最近的牆 500cm > 吸附範圍 100cm
            assert False, "應該要 raise"
        except ValueError:
            pass
        assert len(_walls()) == 1
        print("[OK] test_add_opening_requires_nearby_wall")


def test_imported_layer_survives_opening_and_modify():
    with temp_state():
        # 模擬 DXF 匯入的牆：帶來源圖層 layer
        def inject(state):
            state["rawWalls"].append({
                "id": "impwall1", "start": {"x": 0, "y": 0}, "end": {"x": 400, "y": 0},
                "typeId": "wt1", "thickness": 15, "layer": "A-WALL",
            })
        update_state(inject)
        add_door(200, 0)
        left, mid, right = _walls()
        assert left["layer"] == "A-WALL" and right["layer"] == "A-WALL", "切段要繼承 layer"
        # 刪門合併回一道牆，layer 仍在
        delete_object(mid["id"])
        merged = _walls()[0]
        assert merged["layer"] == "A-WALL" and merged["end"] == {"x": 400, "y": 0}
        # modify_wall 部分更新也不能洗掉 layer
        modify_wall(merged["id"], end_x=600)
        assert _walls()[0]["layer"] == "A-WALL" and _walls()[0]["end"]["x"] == 600
        print("[OK] test_imported_layer_survives_opening_and_modify")


def test_modify_wall_partial_update():
    with temp_state():
        wall_id = add_wall(0, 0, 200, 0)["wall"]["id"]
        res = modify_wall(wall_id, end_x=395, end_y=5)  # 只改 end，且要 snap
        assert res["wall"]["end"] == {"x": 400, "y": 0}
        assert res["wall"]["start"] == {"x": 0, "y": 0}
        try:
            modify_wall("no-such-id", end_x=100)
            assert False, "應該要 raise"
        except ValueError:
            pass
        print("[OK] test_modify_wall_partial_update")


def test_modify_wall_rejects_openings():
    with temp_state():
        add_wall(0, 0, 400, 0)
        door_id = add_door(200, 0)["door"]["id"]
        try:
            modify_wall(door_id, end_x=100)
            assert False, "應該要 raise"
        except ValueError:
            pass
        print("[OK] test_modify_wall_rejects_openings")


def test_modify_column():
    with temp_state():
        col_id = add_column(0, 0)["column"]["id"]
        res = modify_column(col_id, cx=205, rotated=True)
        c = res["column"]
        assert c["cx"] == 200 and c["cy"] == 0 and c["rotated"] is True
        print("[OK] test_modify_column")


def test_delete_wall_and_column():
    with temp_state():
        wall_id = add_wall(0, 0, 200, 0)["wall"]["id"]
        col_id = add_column(300, 300)["column"]["id"]
        assert delete_object(wall_id)["deleted"] == "wall"
        assert delete_object(col_id)["deleted"] == "column"
        state = read_state()
        assert state["rawWalls"] == [] and state["columns"] == []
        print("[OK] test_delete_wall_and_column")


def test_clear_all_keeps_types():
    with temp_state():
        add_wall(0, 0, 200, 0)
        add_column(300, 300)
        clear_all()
        state = read_state()
        assert state["rawWalls"] == [] and state["columns"] == []
        assert state["wallTypes"][0]["id"] == "wt1", "類型表要保留"
        assert state["doorTypes"] and state["windowTypes"]
        print("[OK] test_clear_all_keeps_types")


def test_replace_state_optimistic_lock():
    with temp_state():
        add_wall(0, 0, 200, 0)  # version -> 1
        # baseVersion 過期（0 != 1）→ 拒絕，並回傳目前 state 供呼叫端收斂
        new_state, current = replace_state({"rawWalls": []}, base_version=0)
        assert new_state is None and current["version"] == 1
        assert len(current["rawWalls"]) == 1, "被拒絕的寫入不該動到資料"
        # baseVersion 正確 → 覆寫成功，version 遞增
        new_state, _ = replace_state({"rawWalls": []}, base_version=1)
        assert new_state["version"] == 2 and new_state["rawWalls"] == []
        print("[OK] test_replace_state_optimistic_lock")


def test_get_floor_plan_has_all_collections():
    with temp_state():
        plan = get_floor_plan()
        for key in ("rawWalls", "columns", "wallTypes", "colTypes", "doorTypes", "windowTypes"):
            assert key in plan, f"缺 {key}"
        assert plan["version"] == 0
        print("[OK] test_get_floor_plan_has_all_collections")


if __name__ == "__main__":
    test_add_wall_snaps_and_uses_type()
    test_add_wall_rejects_unknown_type_and_zero_length()
    test_add_column_defaults()
    test_add_door_splits_wall()
    test_add_window_snaps_to_nearest_wall()
    test_add_opening_requires_nearby_wall()
    test_imported_layer_survives_opening_and_modify()
    test_modify_wall_partial_update()
    test_modify_wall_rejects_openings()
    test_modify_column()
    test_delete_wall_and_column()
    test_clear_all_keeps_types()
    test_replace_state_optimistic_lock()
    test_get_floor_plan_has_all_collections()
    print("=== 全部通過 ===")
