import json
import os
import random
import string
from mcp.server.fastmcp import FastMCP

STATE_FILE = os.path.join(os.path.dirname(__file__), "floor_plan.json")

DEFAULT_STATE = {
    "rawWalls": [],
    "columns": [],
    "wallTypes": [{"id": "wt1", "name": "一般牆", "thickness": 15}],
    "colTypes": [{"id": "ct1", "name": "RC 柱", "w": 80, "h": 100}],
}

mcp = FastMCP("FloorAI")


def _read():
    if not os.path.exists(STATE_FILE):
        return dict(DEFAULT_STATE)
    with open(STATE_FILE, encoding="utf-8") as f:
        return json.load(f)


def _write(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=7))


def _snap(v, grid=20):
    return round(v / grid) * grid


@mcp.tool()
def get_floor_plan() -> dict:
    """讀取目前平面圖的所有物件（rawWalls 含牆/門/窗、columns 含柱）和種類表。
    每個物件都有 id 欄位可用於 modify/delete。座標單位 mm，Y 軸朝上。"""
    return _read()


@mcp.tool()
def add_wall(
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    type_id: str = "wt1",
) -> str:
    """新增一道牆段。座標單位 mm，Y 軸朝上。建議對齊 20mm 格線。
    返回新牆的 id。"""
    state = _read()
    wt = next((t for t in state["wallTypes"] if t["id"] == type_id), state["wallTypes"][0])
    wall = {
        "id": _id(),
        "start": {"x": _snap(start_x), "y": _snap(start_y)},
        "end": {"x": _snap(end_x), "y": _snap(end_y)},
        "typeId": wt["id"],
        "thickness": wt["thickness"],
    }
    state["rawWalls"].append(wall)
    _write(state)
    return f"已新增牆段 id={wall['id']}（{wall['start']} → {wall['end']}）"


@mcp.tool()
def add_column(
    cx: float,
    cy: float,
    type_id: str = "ct1",
    col_type: str = "rc",
    rotated: bool = False,
) -> str:
    """新增一根柱子。col_type 為 'rc'（RC 柱）或 'h'（H 鋼柱）。
    座標單位 mm，建議對齊 20mm 格線。返回新柱的 id。"""
    state = _read()
    ct = next((t for t in state["colTypes"] if t["id"] == type_id), state["colTypes"][0])
    col = {
        "id": _id(),
        "cx": _snap(cx),
        "cy": _snap(cy),
        "type": col_type,
        "rotated": rotated,
        "typeId": ct["id"],
        "w": ct["w"],
        "h": ct["h"],
    }
    state["columns"].append(col)
    _write(state)
    return f"已新增柱子 id={col['id']}（cx={col['cx']}, cy={col['cy']}）"


@mcp.tool()
def modify_wall(
    object_id: str,
    start_x: float = None,
    start_y: float = None,
    end_x: float = None,
    end_y: float = None,
    type_id: str = None,
) -> str:
    """修改既有牆段的端點或種類。只傳入需要修改的參數。"""
    state = _read()
    wall = next(
        (w for w in state["rawWalls"] if w.get("id") == object_id and not w.get("isDoor") and not w.get("isWindow")),
        None,
    )
    if not wall:
        return f"找不到牆段 id={object_id}"
    if start_x is not None:
        wall["start"]["x"] = _snap(start_x)
    if start_y is not None:
        wall["start"]["y"] = _snap(start_y)
    if end_x is not None:
        wall["end"]["x"] = _snap(end_x)
    if end_y is not None:
        wall["end"]["y"] = _snap(end_y)
    if type_id is not None:
        wt = next((t for t in state["wallTypes"] if t["id"] == type_id), None)
        if wt:
            wall["typeId"] = wt["id"]
            wall["thickness"] = wt["thickness"]
    _write(state)
    return f"已修改牆段 id={object_id}（{wall['start']} → {wall['end']}）"


@mcp.tool()
def modify_column(
    object_id: str,
    cx: float = None,
    cy: float = None,
    rotated: bool = None,
    type_id: str = None,
) -> str:
    """修改既有柱子的位置、旋轉或種類。只傳入需要修改的參數。"""
    state = _read()
    col = next((c for c in state["columns"] if c.get("id") == object_id), None)
    if not col:
        return f"找不到柱子 id={object_id}"
    if cx is not None:
        col["cx"] = _snap(cx)
    if cy is not None:
        col["cy"] = _snap(cy)
    if rotated is not None:
        col["rotated"] = rotated
    if type_id is not None:
        ct = next((t for t in state["colTypes"] if t["id"] == type_id), None)
        if ct:
            col["typeId"] = ct["id"]
            col["w"] = ct["w"]
            col["h"] = ct["h"]
    _write(state)
    return f"已修改柱子 id={object_id}（cx={col['cx']}, cy={col['cy']}）"


@mcp.tool()
def delete_object(object_id: str) -> str:
    """用 id 刪除任何物件（牆、門、窗、柱）。"""
    state = _read()
    before = len(state["rawWalls"]) + len(state["columns"])
    state["rawWalls"] = [w for w in state["rawWalls"] if w.get("id") != object_id]
    state["columns"] = [c for c in state["columns"] if c.get("id") != object_id]
    after = len(state["rawWalls"]) + len(state["columns"])
    if after < before:
        _write(state)
        return f"已刪除物件 id={object_id}"
    return f"找不到物件 id={object_id}"


@mcp.tool()
def clear_all() -> str:
    """清除平面圖上的所有物件（保留種類表）。"""
    state = _read()
    state["rawWalls"] = []
    state["columns"] = []
    _write(state)
    return "已清除所有物件"


if __name__ == "__main__":
    mcp.run()
