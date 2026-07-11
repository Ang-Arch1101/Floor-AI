import io
import os
import tempfile
import ezdxf
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dxf_parser import parse_dxf

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


@app.route("/api/upload-dxf", methods=["POST"])
def upload_dxf():
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".dxf"):
        return jsonify({"error": "not a dxf file"}), 400

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = parse_dxf(tmp_path)
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
    })


@app.route("/api/export-dxf", methods=["POST"])
def export_dxf():
    """收前端組好的線段/弧清單，寫成 DXF 檔回傳下載。

    body: { lines: [{x1,y1,x2,y2,layer}], arcs: [{cx,cy,r,startDeg,endDeg,layer}], scale? }
    座標語意為公分（$INSUNITS=5）；scale 預留換算用，預設 1。
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

    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 5  # centimeters
    for name, color in EXPORT_LAYERS.items():
        doc.layers.add(name, color=color)
    # 門弧用虛線（對齊畫面上的 strokeDasharray）；4cm 實線、3cm 間隔
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[7.0, 4.0, -3.0], description="__ __ __")
    msp = doc.modelspace()

    def layer_of(item):
        name = item.get("layer", "0")
        name = LAYER_REMAP.get(name, name)
        return name if name in EXPORT_LAYERS else "0"

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
