import math
import ezdxf

MERGE_TOL = 1.0  # 合併共線斷段的容差（單位待真實圖面確認）


def parse_dxf(file_path):
    """讀入 DXF，正規化 LINE / LWPOLYLINE 為統一線段格式，再合併共線斷段。"""
    doc = ezdxf.readfile(file_path)
    msp = doc.modelspace()

    raw_segments = []

    for entity in msp:
        if entity.dxftype() == "LINE":
            s = entity.dxf.start
            e = entity.dxf.end
            layer = entity.dxf.layer
            raw_segments.append({
                "start": [s.x, s.y],
                "end":   [e.x, e.y],
                "layer": layer,
            })

        elif entity.dxftype() == "LWPOLYLINE":
            layer = entity.dxf.layer
            pts = list(entity.get_points())  # (x, y, start_width, end_width, bulge)
            for i in range(len(pts) - 1):
                raw_segments.append({
                    "start": [pts[i][0],     pts[i][1]],
                    "end":   [pts[i + 1][0], pts[i + 1][1]],
                    "layer": layer,
                })
            if entity.closed and len(pts) >= 2:
                raw_segments.append({
                    "start": [pts[-1][0], pts[-1][1]],
                    "end":   [pts[0][0],  pts[0][1]],
                    "layer": layer,
                })

    merged = merge_collinear(raw_segments)

    return {
        "raw_count":    len(raw_segments),
        "merged_count": len(merged),
        "segments":     merged,
    }


# ── 合併共線斷段 ────────────────────────────────────────────────────────────────

def _seg_key(seg):
    """把線段方向正規化成 (layer, angle_bucket) 作為分組 key。"""
    sx, sy = seg["start"]
    ex, ey = seg["end"]
    dx, dy = ex - sx, ey - sy
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    angle = math.atan2(dy, dx)
    # 折疊到 [0, π)
    if angle < 0:
        angle += math.pi
    return seg["layer"]


def _pt_eq(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1]) < MERGE_TOL


def _collinear(s1, s2):
    """判斷兩線段是否共線（方向平行且點在同一直線上），且端點相接。"""
    ax, ay = s1["start"]; bx, by = s1["end"]
    cx, cy = s2["start"]; dx, dy = s2["end"]

    # 方向向量
    dx1, dy1 = bx - ax, by - ay
    dx2, dy2 = dx - cx, dy - cy
    len1 = math.hypot(dx1, dy1)
    len2 = math.hypot(dx2, dy2)
    if len1 < 1e-9 or len2 < 1e-9:
        return False

    # 平行（叉積接近 0）
    cross = dx1 * dy2 - dy1 * dx2
    if abs(cross) / (len1 * len2) > 0.01:  # sin(angle) < 0.01 ≈ 0.57°
        return False

    # 共線（s2 的起點在 s1 所在直線上）
    nx, ny = -dy1 / len1, dx1 / len1  # 法向量
    dist = abs((cx - ax) * nx + (cy - ay) * ny)
    if dist > MERGE_TOL:
        return False

    # 端點相接
    return (_pt_eq(s1["end"], s2["start"]) or
            _pt_eq(s1["end"], s2["end"])   or
            _pt_eq(s1["start"], s2["start"]) or
            _pt_eq(s1["start"], s2["end"]))


def merge_collinear(segments):
    """貪婪合併：同 layer 內，共線且端點相接的線段合為一條。"""
    # 按 layer 分組
    by_layer = {}
    for seg in segments:
        by_layer.setdefault(seg["layer"], []).append(seg)

    result = []
    for layer, segs in by_layer.items():
        # 用 union-find 合併
        n = len(segs)
        parent = list(range(n))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i, j):
            parent[find(i)] = find(j)

        for i in range(n):
            for j in range(i + 1, n):
                if _collinear(segs[i], segs[j]):
                    union(i, j)

        # 每組合併成一條最長線
        groups = {}
        for i in range(n):
            groups.setdefault(find(i), []).append(i)

        for indices in groups.values():
            pts = []
            for idx in indices:
                pts.append(segs[idx]["start"])
                pts.append(segs[idx]["end"])

            # 找投影軸（第一條線的方向）
            ref = segs[indices[0]]
            dx = ref["end"][0] - ref["start"][0]
            dy = ref["end"][1] - ref["start"][1]
            length = math.hypot(dx, dy)
            if length < 1e-9:
                result.append(segs[indices[0]])
                continue
            ux, uy = dx / length, dy / length

            # 投影取最小最大
            projs = [(p[0] * ux + p[1] * uy) for p in pts]
            t_min, t_max = min(projs), max(projs)

            ox, oy = ref["start"]
            result.append({
                "start": [ox + t_min * ux, oy + t_min * uy],
                "end":   [ox + t_max * ux, oy + t_max * uy],
                "layer": layer,
            })

    return result
