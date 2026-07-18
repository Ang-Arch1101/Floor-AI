import io
import json
import os
import tempfile
import ezdxf
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dxf_parser import parse_dxf, scan_layers

app = Flask(__name__)
CORS(app)

# 匯出圖層與 AutoCAD 顏色索引（ACI）
EXPORT_LAYERS = {
    "WALL":   3,   # 綠（牆 + RC 柱同圖層）
    "DOOR":   4,   # 青
    "WINDOW": 5,   # 藍
}
# RC 柱與牆歸同一圖層（結構元件慣例）：把 buildExportGeometry 標的 COL 併進 WALL
LAYER_REMAP = {"COL": "WALL"}


@app.route("/api/scan-dxf-layers", methods=["POST"])
def scan_dxf_layers_route():
    """匯入前掃描圖層清單（供前端勾選要參與牆/柱辨識的圖層）。不做辨識，純讀取。"""
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".dxf"):
        return jsonify({"error": "not a dxf file"}), 400

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        layers = scan_layers(tmp_path)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)

    return jsonify({"status": "ok", "layers": layers})


@app.route("/api/upload-dxf", methods=["POST"])
def upload_dxf():
    """include_layers（可選 form 欄位，JSON 陣列字串）：只讓白名單圖層參與牆/柱辨識，
    通常是使用者在 /api/scan-dxf-layers 的圖層清單勾選後回傳。不帶則沿用舊行為（不篩選）。"""
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".dxf"):
        return jsonify({"error": "not a dxf file"}), 400

    include_layers = None
    raw = request.form.get("include_layers")
    if raw:
        try:
            include_layers = json.loads(raw)
        except ValueError:
            return jsonify({"error": "invalid include_layers"}), 400

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = parse_dxf(tmp_path, include_layers=include_layers)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)

    return jsonify({
        "status":      "ok",
        "raw_count":   result["raw_count"],
        "wall_count":  result["wall_count"],
        "col_count":   result["col_count"],
        "walls":       result["walls"],
        "columns":     result["columns"],
        "layers":      result["layers"],
    })


@app.route("/api/export-dxf", methods=["POST"])
def export_dxf():
    """收前端組好的線段/弧清單，寫成 DXF 檔回傳下載。

    body: { lines: [...], arcs: [...], scale?, layers?: [{name,color,linetype,lineweight}] }
    座標語意為公分（$INSUNITS=5）；scale 預留換算用，預設 1。
    layers：匯入來源圖層的外觀設定，匯出時放回同樣的顏色/線型/線寬。
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "invalid json"}), 400
    lines = data.get("lines", [])
    arcs = data.get("arcs", [])
    if not lines and not arcs:
        return jsonify({"error": "nothing to export"}), 400
    try:
        scale = float(data.get("scale", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid scale"}), 400
    # 來源圖層外觀查表：name → {color, linetype, lineweight}
    src_layers = {L["name"]: L for L in data.get("layers", []) if L.get("name")}

    # setup=True 載入標準線型（CONTINUOUS/DASHED/HIDDEN…），來源圖層引用的標準線型才能還原
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 5  # centimeters
    if "DASHED" not in doc.linetypes:  # 保險：門弧用
        doc.linetypes.add("DASHED", pattern=[7.0, 4.0, -3.0], description="__ __ __")
    for name, color in EXPORT_LAYERS.items():
        doc.layers.add(name, color=color)
    msp = doc.modelspace()

    def ensure_layer(name):
        if name in doc.layers:
            return
        src = src_layers.get(name)
        if src:
            # 來源圖層：放回原顏色/線型/線寬（線型不存在就退回 CONTINUOUS）
            lt = src.get("linetype", "CONTINUOUS")
            if lt not in doc.linetypes:
                lt = "CONTINUOUS"
            lyr = doc.layers.add(name, color=src.get("color", 7), linetype=lt)
            lw = src.get("lineweight", -3)
            if lw is not None:
                lyr.dxf.lineweight = lw
        else:
            doc.layers.add(name, color=EXPORT_LAYERS.get(name, 7))  # 未知來源 → 白(7)

    def layer_of(item):
        # 匯入物件帶著來源圖層 → 原樣輸出（含外觀）；FloorAI 新畫的用預設層（COL 併進 WALL）。
        name = item.get("layer") or "0"
        name = LAYER_REMAP.get(name, name)
        ensure_layer(name)
        return name

    try:
        for l in lines:
            msp.add_line(
                (l["x1"] * scale, l["y1"] * scale),
                (l["x2"] * scale, l["y2"] * scale),
                dxfattribs={"layer": layer_of(l)},
            )
        for a in arcs:
            msp.add_arc(
                center=(a["cx"] * scale, a["cy"] * scale),
                radius=a["r"] * scale,
                start_angle=a["startDeg"],
                end_angle=a["endDeg"],
                dxfattribs={"layer": layer_of(a), "linetype": "DASHED"},
            )
    except (KeyError, TypeError) as e:
        return jsonify({"error": f"malformed geometry: {e}"}), 400

    buf = io.StringIO()
    doc.write(buf)
    payload = io.BytesIO(buf.getvalue().encode("utf-8"))
    payload.seek(0)
    return send_file(
        payload,
        as_attachment=True,
        download_name="floorai.dxf",
        mimetype="application/dxf",
    )


if __name__ == "__main__":
    app.run(port=5000, debug=True)
