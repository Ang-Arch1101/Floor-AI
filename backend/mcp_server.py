"""FloorAI MCP server：讓 Claude Code 用自然語言直接增/改/刪畫布上的牆柱門窗。

架構：MCP 工具讀寫 floor_plan.json（經 state_store，含檔案鎖與版本號），
前端每秒輪詢 GET /api/state，version 變新就套用到畫布 —— 所以這裡寫完檔，
畫布約一秒內反映，不需要模型 API key、也不經瀏覽器。

單位約定：所有座標與尺寸都是公分（cm），1 world unit = 1 cm。
牆厚 15 = 15cm、預設門寬 80 = 80cm、格線 GRID = 20 = 20cm。
座標請對齊 20 的倍數（工具內也會自動 snap）。

幾何行為對齊前端 src/geometry.js：
- add_door / add_window 移植 placeOpening —— 找最近的牆，把它切成
  「左段 + 開口 + 右段」，開口與兩側段繼承宿主牆 thickness/typeId/layer。
- delete_object 刪開口時移植 deleteSelected —— 左右段合併回一道牆。
- 牆牆 L/T/十字接合是前端 render 時計算的，這裡只管資料層；
  新牆跨越既有牆不會自動切分（前端手畫才有 splitByWallIntersections）。
"""

import math
import uuid

from mcp.server.fastmcp import FastMCP

import state_store

GRID = 20
OPENING_SNAP_MAX = 100  # 門窗吸附最近牆的最大距離（cm）

mcp = FastMCP("floorai")


def _gen_id():
    """7 字元隨機 id，與前端 genId()（base36 亂數 7 碼）同格式、可互通。"""
    return uuid.uuid4().hex[:7]


def _snap(v):
    return round(float(v) / GRID) * GRID


def _get_norm(start, end):
    """對齊 geometry.js getNorm：回傳方向向量、長度與單位法向量。"""
    dx, dy = end["x"] - start["x"], end["y"] - start["y"]
    length = math.hypot(dx, dy)
    if length == 0:
        return None
    return {"dx": dx, "dy": dy, "len": length, "nx": -dy / length, "ny": dx / length}


def _find_type(state, key, type_id):
    return next((t for t in state[key] if t["id"] == type_id), None)


def _is_plain_wall(obj):
    return not obj.get("isDoor") and not obj.get("isWindow")


def _dist_to_wall(x, y, wall):
    """對齊 geometry.js distToWall：投影在牆段範圍內才算，否則無限遠。"""
    n = _get_norm(wall["start"], wall["end"])
    if n is None:
        return math.inf
    t = ((x - wall["start"]["x"]) * n["dx"] + (y - wall["start"]["y"]) * n["dy"]) / (n["len"] ** 2)
    if t < 0 or t > 1:
        return math.inf
    cx = wall["start"]["x"] + t * n["dx"]
    cy = wall["start"]["y"] + t * n["dy"]
    return math.hypot(x - cx, y - cy)


def _find_by_id(state, obj_id):
    """回傳 ('rawWall'|'col', index, obj)；找不到回傳 None。"""
    for i, w in enumerate(state["rawWalls"]):
        if w.get("id") == obj_id:
            return "rawWall", i, w
    for i, c in enumerate(state["columns"]):
        if c.get("id") == obj_id:
            return "col", i, c
    return None


def _place_opening(state, x, y, kind, flipped, type_id):
    """移植 geometry.js placeOpening：最近的牆切成 左段+開口+右段。"""
    x, y = float(x), float(y)
    type_key = "doorTypes" if kind == "door" else "windowTypes"
    otype = _find_type(state, type_key, type_id)
    if otype is None:
        raise ValueError(f"找不到{'門' if kind == 'door' else '窗'}類型 {type_id}，"
                         f"可用：{[t['id'] for t in state[type_key]]}")

    walls = state["rawWalls"]
    best_idx, best_d = -1, math.inf
    for i, w in enumerate(walls):
        if not _is_plain_wall(w):
            continue
        d = _dist_to_wall(x, y, w)
        if d < best_d:
            best_idx, best_d = i, d
    if best_idx == -1 or best_d > OPENING_SNAP_MAX:
        raise ValueError(f"({x}, {y}) 附近 {OPENING_SNAP_MAX}cm 內沒有牆可放置開口")

    wall = walls[best_idx]
    n = _get_norm(wall["start"], wall["end"])
    width = otype["width"]
    if n["len"] < width:
        raise ValueError(f"牆段長 {n['len']:.0f}cm 放不下寬 {width}cm 的開口")
    half_t = (width / 2) / n["len"]
    t = ((x - wall["start"]["x"]) * n["dx"] + (y - wall["start"]["y"]) * n["dy"]) / (n["len"] ** 2)
    t = max(half_t, min(1 - half_t, t))
    t_a, t_b = t - half_t, t + half_t
    pt_a = {"x": wall["start"]["x"] + t_a * n["dx"], "y": wall["start"]["y"] + t_a * n["dy"]}
    pt_b = {"x": wall["start"]["x"] + t_b * n["dx"], "y": wall["start"]["y"] + t_b * n["dy"]}

    opening = {
        "id": _gen_id(),
        ("isDoor" if kind == "door" else "isWindow"): True,
        "ptA": pt_a, "ptB": pt_b,
        "nx": n["nx"], "ny": n["ny"],
        "ux": n["dx"] / n["len"], "uy": n["dy"] / n["len"],
        "flipped": bool(flipped),
        "width": width, "typeId": otype["id"], "thickness": wall.get("thickness"),
    }
    # 兩側牆段繼承宿主牆的種類/厚度/來源圖層（layer 不能被同步洗掉）
    carrier = {k: wall[k] for k in ("typeId", "thickness", "layer") if k in wall}
    left = {"id": _gen_id(), "start": wall["start"], "end": pt_a, **carrier}
    right = {"id": _gen_id(), "start": pt_b, "end": wall["end"], **carrier}
    walls[best_idx:best_idx + 1] = [left, opening, right]
    return opening


@mcp.tool()
def get_floor_plan() -> dict:
    """讀取目前平面圖完整狀態。

    回傳 rawWalls（牆段/門/窗）、columns、wallTypes、colTypes、doorTypes、
    windowTypes 與 version。座標單位為公分（cm）。修改前先呼叫這個，
    拿到各物件的 id 與各類型表可用的 type_id。
    """
    return state_store.read_state()


@mcp.tool()
def add_wall(start_x: float, start_y: float, end_x: float, end_y: float,
             type_id: str = "wt1") -> dict:
    """新增一道牆。座標單位為公分（cm），請對齊 20 的倍數（會自動 snap）。

    type_id 對應 wallTypes（預設 wt1 一般牆，厚 15cm），牆厚由類型帶入。
    注意：牆與牆的 L/T/十字接合由前端渲染時計算，這裡只寫入資料。
    """
    def mutate(state):
        wt = _find_type(state, "wallTypes", type_id)
        if wt is None:
            raise ValueError(f"找不到牆類型 {type_id}，可用：{[t['id'] for t in state['wallTypes']]}")
        start = {"x": _snap(start_x), "y": _snap(start_y)}
        end = {"x": _snap(end_x), "y": _snap(end_y)}
        if start == end:
            raise ValueError("snap 到格點後起訖點相同，牆長為 0")
        wall = {"id": _gen_id(), "start": start, "end": end,
                "typeId": wt["id"], "thickness": wt["thickness"]}
        state["rawWalls"].append(wall)
        return wall

    state, wall = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"], "wall": wall}


@mcp.tool()
def add_column(cx: float, cy: float, type_id: str = "ct1",
               col_type: str = "rc", rotated: bool = False) -> dict:
    """新增一根柱。cx/cy 為柱中心，單位公分（cm），請對齊 20 的倍數（會自動 snap）。

    type_id 對應 colTypes（預設 ct1，80×100cm）；col_type 為 'rc'（RC 柱）
    或 'h'（H 鋼柱）；rotated=True 時寬深互換（等同前端按空白鍵旋轉）。
    """
    def mutate(state):
        if col_type not in ("rc", "h"):
            raise ValueError("col_type 只能是 'rc' 或 'h'")
        ct = _find_type(state, "colTypes", type_id)
        if ct is None:
            raise ValueError(f"找不到柱類型 {type_id}，可用：{[t['id'] for t in state['colTypes']]}")
        col = {"id": _gen_id(), "cx": _snap(cx), "cy": _snap(cy), "type": col_type,
               "rotated": bool(rotated), "typeId": ct["id"], "w": ct["w"], "h": ct["h"]}
        state["columns"].append(col)
        return col

    state, col = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"], "column": col}


@mcp.tool()
def add_door(x: float, y: float, flipped: bool = False, type_id: str = "dt1") -> dict:
    """在 (x, y) 最近的牆上放一扇門（吸附範圍 100cm）。座標單位公分（cm）。

    門會把宿主牆切成「左段 + 門 + 右段」，門寬由 doorTypes 的 type_id 決定
    （預設 dt1 單開門 80cm），開口繼承宿主牆厚度。flipped 反轉開門方向。
    """
    state, opening = state_store.update_state(
        lambda s: _place_opening(s, x, y, "door", flipped, type_id))
    return {"ok": True, "version": state["version"], "door": opening}


@mcp.tool()
def add_window(x: float, y: float, flipped: bool = False, type_id: str = "nt1") -> dict:
    """在 (x, y) 最近的牆上放一扇窗（吸附範圍 100cm）。座標單位公分（cm）。

    窗會把宿主牆切成「左段 + 窗 + 右段」，窗寬由 windowTypes 的 type_id 決定
    （預設 nt1 一般窗 80cm），開口繼承宿主牆厚度。
    """
    state, opening = state_store.update_state(
        lambda s: _place_opening(s, x, y, "window", flipped, type_id))
    return {"ok": True, "version": state["version"], "window": opening}


@mcp.tool()
def modify_wall(id: str, start_x: float = None, start_y: float = None,
                end_x: float = None, end_y: float = None,
                type_id: str = None) -> dict:
    """修改既有牆段（只限牆，門窗請刪除後重放）。只更新有給的欄位。

    座標單位公分（cm），會自動 snap 到 20 的倍數；type_id 換牆類型時
    厚度一併更新。其餘欄位（如匯入來源的 layer）保持不動。
    """
    def mutate(state):
        found = _find_by_id(state, id)
        if found is None or found[0] != "rawWall":
            raise ValueError(f"找不到 id 為 {id} 的牆段")
        wall = found[2]
        if not _is_plain_wall(wall):
            raise ValueError(f"{id} 是門/窗開口，請用 delete_object 刪除後重新放置")
        if start_x is not None:
            wall["start"]["x"] = _snap(start_x)
        if start_y is not None:
            wall["start"]["y"] = _snap(start_y)
        if end_x is not None:
            wall["end"]["x"] = _snap(end_x)
        if end_y is not None:
            wall["end"]["y"] = _snap(end_y)
        if wall["start"] == wall["end"]:
            raise ValueError("修改後起訖點相同，牆長為 0")
        if type_id is not None:
            wt = _find_type(state, "wallTypes", type_id)
            if wt is None:
                raise ValueError(f"找不到牆類型 {type_id}")
            wall["typeId"] = wt["id"]
            wall["thickness"] = wt["thickness"]
        return wall

    state, wall = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"], "wall": wall}


@mcp.tool()
def modify_column(id: str, cx: float = None, cy: float = None,
                  rotated: bool = None, type_id: str = None) -> dict:
    """修改既有柱。只更新有給的欄位。cx/cy 單位公分（cm），自動 snap 到 20 的倍數。

    type_id 換柱類型時寬深一併更新；rotated 為寬深互換。
    """
    def mutate(state):
        found = _find_by_id(state, id)
        if found is None or found[0] != "col":
            raise ValueError(f"找不到 id 為 {id} 的柱")
        col = found[2]
        if cx is not None:
            col["cx"] = _snap(cx)
        if cy is not None:
            col["cy"] = _snap(cy)
        if rotated is not None:
            col["rotated"] = bool(rotated)
        if type_id is not None:
            ct = _find_type(state, "colTypes", type_id)
            if ct is None:
                raise ValueError(f"找不到柱類型 {type_id}")
            col["typeId"] = ct["id"]
            col["w"] = ct["w"]
            col["h"] = ct["h"]
        return col

    state, col = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"], "column": col}


@mcp.tool()
def delete_object(id: str) -> dict:
    """依 id 刪除牆段、門、窗或柱。

    刪門/窗時，若左右兩側是完整牆段會自動合併回一道牆
    （對齊前端 Delete 的行為）；刪牆段則直接移除。
    """
    def mutate(state):
        found = _find_by_id(state, id)
        if found is None:
            raise ValueError(f"找不到 id 為 {id} 的物件")
        kind, idx, obj = found
        if kind == "col":
            state["columns"].pop(idx)
            return {"deleted": "column"}
        walls = state["rawWalls"]
        if _is_plain_wall(obj):
            walls.pop(idx)
            return {"deleted": "wall"}
        # 門/窗：左右都是完整牆段才合併（移植 App.js deleteSelected）
        left = walls[idx - 1] if idx > 0 else None
        right = walls[idx + 1] if idx + 1 < len(walls) else None
        if left and right and _is_plain_wall(left) and _is_plain_wall(right):
            merged = {"id": _gen_id(), "start": left["start"], "end": right["end"],
                      **{k: left[k] for k in ("typeId", "thickness", "layer") if k in left}}
            walls[idx - 1:idx + 2] = [merged]
            return {"deleted": "door" if obj.get("isDoor") else "window", "mergedWall": merged}
        walls.pop(idx)
        return {"deleted": "door" if obj.get("isDoor") else "window"}

    state, result = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"], **result}


@mcp.tool()
def clear_all() -> dict:
    """清空畫布上所有牆、門、窗、柱（四張類型表保留）。無法從對話復原，請先確認。"""
    def mutate(state):
        state["rawWalls"] = []
        state["columns"] = []

    state, _ = state_store.update_state(mutate)
    return {"ok": True, "version": state["version"]}


if __name__ == "__main__":
    mcp.run()  # stdio transport，由 Claude Code 依 .mcp.json 啟動
