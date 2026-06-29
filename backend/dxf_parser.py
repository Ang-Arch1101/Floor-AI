import math
import ezdxf

# ── 參數 ────────────────────────────────────────────────────────────────────────
GAP_MIN = 8       # 牆兩面之間的最小間距（厚度下限）
GAP_MAX = 30      # 牆兩面之間的最大間距（厚度上限）
OVERLAP_MIN = 50  # 兩平行線重疊長度下限（避免角落短段誤配成牆）
CLUSTER_GAP = 50  # 碎片分群：端點距離在此範圍內視為同一群（柱）
MAX_COL = 200     # 分群後 bounding box 邊長上限（超過視為非柱）
PARALLEL_TOL = 0.02  # sin(夾角) 容差，判斷平行


def detect_rect_from_lwpoly(entity):
    """從 closed LWPOLYLINE 4 頂點檢測矩形，回傳 {cx,cy,w,h,angle} 或 None。"""
    if not entity.closed:
        return None
    pts = [(p[0], p[1]) for p in entity.get_points()]
    if len(pts) != 4:
        return None
    for i in range(4):
        v1 = (pts[(i+1)%4][0]-pts[i][0], pts[(i+1)%4][1]-pts[i][1])
        v2 = (pts[(i+2)%4][0]-pts[(i+1)%4][0], pts[(i+2)%4][1]-pts[(i+1)%4][1])
        l1 = math.hypot(*v1)
        l2 = math.hypot(*v2)
        if l1 < 1e-9 or l2 < 1e-9:
            return None
        if abs(v1[0]*v2[0]+v1[1]*v2[1]) / (l1*l2) > 0.05:  # |cos| < 0.05 ≈ 垂直
            return None
    edges = [math.hypot(pts[(i+1)%4][0]-pts[i][0], pts[(i+1)%4][1]-pts[i][1]) for i in range(4)]
    w = min(edges[0], edges[1])
    h = max(edges[0], edges[1])
    cx = sum(p[0] for p in pts) / 4
    cy = sum(p[1] for p in pts) / 4
    return {"cx": cx, "cy": cy, "w": w, "h": h, "angle": 0.0}


# ── 平行線配對成牆 ──────────────────────────────────────────────────────────────

def try_pair(a, b, gap_min=GAP_MIN, gap_max=GAP_MAX, overlap_min=OVERLAP_MIN):
    """兩線段若平行、間距合理、重疊夠長，配成一道牆。回傳 {start,end,thickness} 或 None。"""
    ax, ay = a["start"]; bx, by = a["end"]
    dx, dy = bx - ax, by - ay
    La = math.hypot(dx, dy)
    if La < 1e-9:
        return None
    ux, uy = dx / La, dy / La           # a 的單位方向向量
    nx, ny = -uy, ux                    # a 的單位法向量

    cx, cy = b["start"]; ex, ey = b["end"]
    ddx, ddy = ex - cx, ey - cy
    Lb = math.hypot(ddx, ddy)
    if Lb < 1e-9:
        return None
    # 平行判斷：b 方向與 a 的叉積 ≈ 0
    if abs((ddx * uy - ddy * ux)) / Lb > PARALLEL_TOL:
        return None

    # b 到 a 直線的法向距離（取 b.start）
    d = (cx - ax) * nx + (cy - ay) * ny
    dist = abs(d)
    if not (gap_min <= dist <= gap_max):
        return None

    # 把 a、b 四個端點投影到 u 軸（以 a.start 為原點）
    ta0 = 0.0
    ta1 = (bx - ax) * ux + (by - ay) * uy
    tb0 = (cx - ax) * ux + (cy - ay) * uy
    tb1 = (ex - ax) * ux + (ey - ay) * uy
    a_lo, a_hi = min(ta0, ta1), max(ta0, ta1)
    b_lo, b_hi = min(tb0, tb1), max(tb0, tb1)
    t0 = max(a_lo, b_lo)
    t1 = min(a_hi, b_hi)
    if (t1 - t0) < overlap_min:
        return None

    # 中心線：a 沿法向移 d/2（朝 b 方向），端點落在重疊區間 [t0,t1]
    ox = ax + nx * (d / 2)
    oy = ay + ny * (d / 2)
    start = [ox + ux * t0, oy + uy * t0]
    end   = [ox + ux * t1, oy + uy * t1]
    return {"start": start, "end": end, "thickness": dist}


def pair_walls(segments):
    """貪婪配對平行線段成牆。回傳 (walls, leftover)。"""
    walls = []
    used = set()
    n = len(segments)
    for i in range(n):
        if i in used:
            continue
        for j in range(i + 1, n):
            if j in used:
                continue
            w = try_pair(segments[i], segments[j])
            if w:
                walls.append(w)
                used.add(i)
                used.add(j)
                break
    leftover = [s for k, s in enumerate(segments) if k not in used]
    return walls, leftover


# ── 碎片分群成柱 ────────────────────────────────────────────────────────────────

def cluster_columns(segments, cluster_gap=CLUSTER_GAP, max_col=MAX_COL):
    """把零散短線段依端點鄰近分群，每群 bounding box 視為一根柱。"""
    n = len(segments)
    if n == 0:
        return []
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    def near(s1, s2):
        for p in (s1["start"], s1["end"]):
            for q in (s2["start"], s2["end"]):
                if math.hypot(p[0]-q[0], p[1]-q[1]) < cluster_gap:
                    return True
        return False

    for i in range(n):
        for j in range(i + 1, n):
            if near(segments[i], segments[j]):
                union(i, j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    columns = []
    for idxs in groups.values():
        xs = []
        ys = []
        for k in idxs:
            xs += [segments[k]["start"][0], segments[k]["end"][0]]
            ys += [segments[k]["start"][1], segments[k]["end"][1]]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        if w <= max_col and h <= max_col and w > 1 and h > 1:
            columns.append({
                "cx": (min(xs)+max(xs))/2,
                "cy": (min(ys)+max(ys))/2,
                "w": w,
                "h": h,
                "angle": 0.0,
            })
    return columns


# ── 主流程 ──────────────────────────────────────────────────────────────────────

def parse_dxf(file_path):
    """讀入 DXF：平行線配對還原牆，碎片分群還原柱。"""
    doc = ezdxf.readfile(file_path)
    msp = doc.modelspace()

    segments = []
    columns = []

    for entity in msp:
        if entity.dxftype() == "LINE":
            s = entity.dxf.start
            e = entity.dxf.end
            segments.append({"start": [s.x, s.y], "end": [e.x, e.y]})

        elif entity.dxftype() == "LWPOLYLINE":
            rect = detect_rect_from_lwpoly(entity)
            if rect:
                columns.append(rect)
                continue
            pts = list(entity.get_points())
            for i in range(len(pts) - 1):
                segments.append({"start": [pts[i][0], pts[i][1]],
                                 "end":   [pts[i+1][0], pts[i+1][1]]})
            if entity.closed and len(pts) >= 2:
                segments.append({"start": [pts[-1][0], pts[-1][1]],
                                 "end":   [pts[0][0], pts[0][1]]})

    walls, leftover = pair_walls(segments)
    columns += cluster_columns(leftover)

    return {
        "raw_count":   len(segments),
        "wall_count":  len(walls),
        "col_count":   len(columns),
        "walls":       walls,
        "columns":     columns,
    }
