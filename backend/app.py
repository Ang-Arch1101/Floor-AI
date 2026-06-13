import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

_api_key = os.environ.get("ANTHROPIC_API_KEY")
if not _api_key:
    raise RuntimeError("ANTHROPIC_API_KEY is not set. Create backend/.env with your key.")

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

client = Anthropic(api_key=_api_key)

SYSTEM_PROMPT = """你是一個建築平面設計 AI 助手。使用者會提供目前畫布上的物件（walls, columns）和種類表（wallTypes, colTypes），以及一個操作指令。
請根據指令，呼叫 suggest_objects 工具回傳需要新增的物件清單。

座標單位：mm，Y 軸朝上（正 Y 向上）。格線間距 20mm，請盡量讓座標是 20 的倍數。

walls 陣列元素：
- 牆段：{ "start": {"x":0,"y":0}, "end": {"x":1000,"y":0}, "typeId": "wt1", "thickness": 15 }
- 門：{ "isDoor": true, "ptA": {...}, "ptB": {...}, ... }
- 窗：{ "isWindow": true, "ptA": {...}, "ptB": {...}, ... }
columns 元素：{ "cx": 500, "cy": 500, "type": "rc", "rotated": false, "typeId": "ct1", "w": 80, "h": 100 }
wallTypes：[{ "id": "wt1", "name": "一般牆", "thickness": 15 }]
colTypes：[{ "id": "ct1", "name": "RC 柱", "w": 80, "h": 100 }]

typeId 必須使用 wallTypes 或 colTypes 中已存在的 id；若無合適種類使用第一個。
suggestions 為空陣列時 message 說明原因。"""

SUGGEST_TOOL = {
    "name": "suggest_objects",
    "description": "回傳 AI 建議新增到建築平面圖的物件清單",
    "input_schema": {
        "type": "object",
        "required": ["message", "suggestions"],
        "properties": {
            "message": {
                "type": "string",
                "description": "用繁體中文說明建議內容"
            },
            "suggestions": {
                "type": "array",
                "items": {
                    "oneOf": [
                        {
                            "type": "object",
                            "required": ["type", "start", "end", "typeId"],
                            "properties": {
                                "type": {"type": "string", "enum": ["wall"]},
                                "start": {
                                    "type": "object",
                                    "required": ["x", "y"],
                                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}}
                                },
                                "end": {
                                    "type": "object",
                                    "required": ["x", "y"],
                                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}}
                                },
                                "typeId": {"type": "string"}
                            }
                        },
                        {
                            "type": "object",
                            "required": ["type", "cx", "cy", "typeId"],
                            "properties": {
                                "type": {"type": "string", "enum": ["column"]},
                                "cx": {"type": "number"},
                                "cy": {"type": "number"},
                                "colType": {"type": "string", "enum": ["rc", "h"]},
                                "rotated": {"type": "boolean"},
                                "typeId": {"type": "string"},
                                "w": {"type": "number"},
                                "h": {"type": "number"}
                            }
                        },
                        {
                            "type": "object",
                            "required": ["type", "position"],
                            "properties": {
                                "type": {"type": "string", "enum": ["door", "window"]},
                                "position": {
                                    "type": "object",
                                    "required": ["x", "y"],
                                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}}
                                },
                                "flipped": {"type": "boolean"}
                            }
                        }
                    ]
                }
            }
        }
    }
}


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
        tools=[SUGGEST_TOOL],
        tool_choice={"type": "tool", "name": "suggest_objects"},
        messages=messages,
    )

    tool_block = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_block is None:
        return jsonify({"message": "AI 未回傳結構化結果", "suggestions": []}), 200

    result = tool_block.input
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
