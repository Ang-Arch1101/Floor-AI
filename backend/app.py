import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = """你是一個建築平面設計 AI 助手。使用者會提供目前畫布上的物件（walls, columns）和種類表（wallTypes, colTypes），以及一個操作指令。
請根據指令，回傳需要新增的物件清單。

座標單位：mm，Y 軸朝上（正 Y 向上）。

資料格式說明：
walls 陣列元素：
- 牆段：{ "start": {"x":0,"y":0}, "end": {"x":1000,"y":0}, "typeId": "wt1", "thickness": 15 }
- 門：{ "isDoor": true, "ptA": {"x":...}, "ptB": {"x":...}, "nx": 0, "ny": 1, "ux": 1, "uy": 0, "flipped": false }
- 窗：{ "isWindow": true, "ptA": {"x":...}, "ptB": {"x":...}, "nx": 0, "ny": 1, "ux": 1, "uy": 0 }

columns 陣列元素：{ "cx": 500, "cy": 500, "type": "rc", "rotated": false, "typeId": "ct1", "w": 80, "h": 100 }
wallTypes：[{ "id": "wt1", "name": "一般牆", "thickness": 15 }]
colTypes：[{ "id": "ct1", "name": "RC 柱", "w": 80, "h": 100 }]

請只回傳 JSON，不要任何說明文字，不要 markdown code block，格式如下：
{
  "message": "說明建議內容的一段繁體中文文字",
  "suggestions": [
    { "type": "wall", "start": {"x":0,"y":0}, "end": {"x":1000,"y":0}, "typeId": "wt1" },
    { "type": "column", "cx": 500, "cy": 500, "colType": "rc", "rotated": false, "typeId": "ct1", "w": 80, "h": 100 },
    { "type": "door", "wallIdx": 0, "position": {"x":500,"y":0} },
    { "type": "window", "wallIdx": 1, "position": {"x":200,"y":0} }
  ]
}

typeId 必須使用 wallTypes 或 colTypes 中已存在的 id。若無合適種類，使用第一個。
suggestions 為空陣列時 message 說明原因。"""


@app.route("/api/ai/suggest", methods=["POST"])
def ai_suggest():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing request body"}), 400

    instruction = data.get("instruction", "")
    context = data.get("context", {})
    history = data.get("history", [])

    if not instruction:
        return jsonify({"error": "Missing instruction"}), 400

    user_message = f"""操作指令：{instruction}

目前畫布範圍內的物件：
{json.dumps(context, ensure_ascii=False, indent=2)}"""

    messages = []
    for m in history:
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    raw = response.content[0].text.strip()

    # strip markdown code fences if model adds them
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"message": raw, "suggestions": []}

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
