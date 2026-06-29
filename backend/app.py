import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from dxf_parser import parse_dxf

app = Flask(__name__)
CORS(app)


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


if __name__ == "__main__":
    app.run(port=5000, debug=True)
