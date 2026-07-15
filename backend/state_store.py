"""floor_plan.json 的唯一讀寫入口。

Flask（app.py）與 MCP server（mcp_server.py）是兩個獨立行程，都要讀寫同一份
floor_plan.json。這裡用三層防護避免「互蓋」與「讀到寫到一半的檔」：

- 跨行程檔案鎖（.lock sidecar）：讀改寫期間互斥，兩個行程不會同時進入。
- version 版本號：每次成功寫入 +1。前端 POST 帶 baseVersion，不符就拒絕（409），
  衝突由前端明確收斂，不會發生「沒人知道誰蓋掉誰」。
- 原子寫入：先寫 temp 檔再 os.replace，任何時刻讀到的都是完整 JSON。

單位約定：座標與尺寸皆為公分（cm），1 world unit = 1 cm。
"""

import copy
import json
import os
import tempfile
from contextlib import contextmanager

# 測試可覆寫此路徑（monkeypatch state_store.STATE_PATH）
STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "floor_plan.json")

# 四張類型表的預設值與前端 App.js 的 useState 預設一致
DEFAULT_STATE = {
    "version": 0,
    "rawWalls": [],
    "columns": [],
    "wallTypes": [{"id": "wt1", "name": "一般牆", "thickness": 15}],
    "colTypes": [{"id": "ct1", "name": "RC 柱", "w": 80, "h": 100}],
    "doorTypes": [{"id": "dt1", "name": "單開門", "width": 80}],
    "windowTypes": [{"id": "nt1", "name": "一般窗", "width": 80}],
}

COLLECTIONS = ["rawWalls", "columns", "wallTypes", "colTypes", "doorTypes", "windowTypes"]

if os.name == "nt":
    import msvcrt

    def _lock_fd(f):
        msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)

    def _unlock_fd(f):
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock_fd(f):
        fcntl.flock(f, fcntl.LOCK_EX)

    def _unlock_fd(f):
        fcntl.flock(f, fcntl.LOCK_UN)


@contextmanager
def _file_lock():
    with open(STATE_PATH + ".lock", "a+") as f:
        if f.tell() == 0:  # msvcrt 需要檔內至少一個 byte 才能鎖
            f.write("0")
            f.flush()
        f.seek(0)
        _lock_fd(f)
        try:
            yield
        finally:
            _unlock_fd(f)


def _load():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return copy.deepcopy(DEFAULT_STATE)


def _save(state):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(STATE_PATH), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, STATE_PATH)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_state():
    with _file_lock():
        return _load()


def update_state(mutate):
    """讀改寫（MCP 工具用）：mutate(state) 就地修改並可回傳結果值。

    成功後 version +1 寫回；回傳 (新 state, mutate 的回傳值)。
    mutate 內 raise 則不寫檔（版本不動）。
    """
    with _file_lock():
        state = _load()
        result = mutate(state)
        state["version"] = int(state.get("version", 0)) + 1
        _save(state)
        return state, result


def replace_state(fields, base_version):
    """整包覆寫（前端 POST /api/state 用）。

    base_version 與目前 version 相同才允許寫入（樂觀鎖）；
    不符回傳 (None, 目前 state) 讓呼叫端回 409。
    """
    with _file_lock():
        state = _load()
        if int(base_version) != int(state.get("version", 0)):
            return None, state
        for key in COLLECTIONS:
            if key in fields:
                state[key] = fields[key]
        state["version"] = int(state.get("version", 0)) + 1
        _save(state)
        return state, None
