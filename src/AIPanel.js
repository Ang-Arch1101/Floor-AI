import React, { useState, useRef, useEffect } from 'react';

const PANEL_WIDTH = 280;

function describeItem(s) {
  if (s.description) return s.description;
  switch (s.type) {
    case 'wall':
      return `新增牆 (${Math.round(s.start?.x ?? 0)},${Math.round(s.start?.y ?? 0)})→(${Math.round(s.end?.x ?? 0)},${Math.round(s.end?.y ?? 0)})`;
    case 'column':
      return `新增${s.colType === 'h' ? 'H鋼' : 'RC'}柱 (${Math.round(s.cx)},${Math.round(s.cy)})`;
    case 'door':
      return `新增門 (${Math.round(s.position?.x ?? 0)},${Math.round(s.position?.y ?? 0)})`;
    case 'window':
      return `新增窗 (${Math.round(s.position?.x ?? 0)},${Math.round(s.position?.y ?? 0)})`;
    case 'modify':
      return `修改${s.objectType === 'column' ? '柱' : '牆'}`;
    case 'delete':
      return `刪除${s.objectType === 'column' ? '柱' : s.objectType === 'door' ? '門' : s.objectType === 'window' ? '窗' : '牆'}`;
    default:
      return s.type;
  }
}

function itemColor(s) {
  if (s.type === 'delete') return '#ff6b6b';
  if (s.type === 'modify') return '#ffaa00';
  return '#aaa';
}

export default function AIPanel({ messages, onSend, pendingChanges, onAccept, onReject, isLoading }) {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState('');
  const [itemSelected, setItemSelected] = useState([]);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setItemSelected((pendingChanges || []).map(() => true));
  }, [pendingChanges]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    onSend(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasPending = pendingChanges && pendingChanges.length > 0;
  const selectedCount = itemSelected.filter(Boolean).length;
  const allChecked = hasPending && itemSelected.every(Boolean);

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, height: '100%',
      display: 'flex', flexDirection: 'row', alignItems: 'stretch',
      zIndex: 20, pointerEvents: 'none',
    }}>
      {/* toggle tab */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          pointerEvents: 'all', alignSelf: 'center',
          width: 20, height: 48,
          background: '#1a1a1a', border: '1px solid #333',
          borderRight: open ? 'none' : '1px solid #333',
          borderRadius: open ? '4px 0 0 4px' : '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#555', fontSize: 12, userSelect: 'none',
        }}
      >
        {open ? '›' : '‹'}
      </div>

      {open && (
        <div style={{
          pointerEvents: 'all', width: PANEL_WIDTH, height: '100%',
          background: '#111', borderLeft: '1px solid #333',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* header */}
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid #222',
            color: '#00d4aa', fontSize: 13, fontWeight: 600, letterSpacing: 0.5,
          }}>
            AI 助手
          </div>

          {/* message list */}
          <div ref={listRef} style={{
            flex: 1, overflowY: 'auto', padding: '8px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ color: '#444', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                輸入指令，讓 AI 建議新增或修改物件
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%', padding: '6px 10px',
                borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                background: msg.role === 'user' ? '#00d4aa22' : '#1a1a1a',
                border: `1px solid ${msg.role === 'user' ? '#00d4aa44' : '#2a2a2a'}`,
                color: msg.role === 'user' ? '#00d4aa' : '#bbb',
                fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            ))}
            {isLoading && (
              <div style={{ alignSelf: 'flex-start', color: '#555', fontSize: 12, padding: '4px 8px' }}>
                思考中…
              </div>
            )}
          </div>

          {/* pending item list */}
          {hasPending && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid #222' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: '#888' }}>
                  AI 建議 {pendingChanges.length} 個操作
                </span>
                <button
                  onClick={() => setItemSelected(itemSelected.map(() => !allChecked))}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }}
                >
                  {allChecked ? '取消全選' : '全選'}
                </button>
              </div>
              <div style={{ maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {pendingChanges.map((s, i) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    cursor: 'pointer', padding: '3px 0',
                  }}>
                    <input
                      type="checkbox"
                      checked={itemSelected[i] ?? false}
                      onChange={e => {
                        const next = [...itemSelected];
                        next[i] = e.target.checked;
                        setItemSelected(next);
                      }}
                      style={{ accentColor: '#00d4aa', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{
                      fontSize: 11, color: itemColor(s),
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {describeItem(s)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* accept / reject buttons */}
          {hasPending && (
            <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
              <button
                onClick={() => onAccept(pendingChanges.filter((_, i) => itemSelected[i]))}
                disabled={selectedCount === 0}
                style={{
                  flex: 1, padding: '6px 0',
                  background: selectedCount === 0 ? '#111' : '#00d4aa22',
                  color: selectedCount === 0 ? '#444' : '#00d4aa',
                  border: `1px solid ${selectedCount === 0 ? '#333' : '#00d4aa66'}`,
                  borderRadius: 6, cursor: selectedCount === 0 ? 'default' : 'pointer', fontSize: 13,
                }}
              >
                接受{selectedCount < pendingChanges.length ? `(${selectedCount})` : ''}
              </button>
              <button
                onClick={onReject}
                style={{
                  flex: 1, padding: '6px 0',
                  background: '#ff6b9d22', color: '#ff6b9d',
                  border: '1px solid #ff6b9d66', borderRadius: 6,
                  cursor: 'pointer', fontSize: 13,
                }}
              >
                拒絕
              </button>
            </div>
          )}

          {/* input */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #222', display: 'flex', gap: 6 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入指令，Enter 送出…"
              rows={2}
              style={{
                flex: 1, background: '#1a1a1a', color: '#ccc',
                border: '1px solid #333', borderRadius: 6,
                padding: '6px 8px', fontSize: 12, resize: 'none',
                outline: 'none', lineHeight: 1.4, fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              style={{
                padding: '0 10px',
                background: isLoading || !input.trim() ? '#1a1a1a' : '#00d4aa22',
                color: isLoading || !input.trim() ? '#444' : '#00d4aa',
                border: `1px solid ${isLoading || !input.trim() ? '#333' : '#00d4aa66'}`,
                borderRadius: 6, cursor: isLoading || !input.trim() ? 'default' : 'pointer',
                fontSize: 13, alignSelf: 'stretch',
              }}
            >
              送出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
