import React, { useState, useRef, useEffect } from 'react';

const PANEL_WIDTH = 280;

export default function AIPanel({ messages, onSend, pendingChanges, onAccept, onReject, isLoading }) {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

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

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      zIndex: 20,
      pointerEvents: 'none',
    }}>
      {/* toggle tab */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          pointerEvents: 'all',
          alignSelf: 'center',
          width: 20,
          height: 48,
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRight: open ? 'none' : '1px solid #333',
          borderRadius: open ? '4px 0 0 4px' : '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#555',
          fontSize: 12,
          userSelect: 'none',
        }}
      >
        {open ? '›' : '‹'}
      </div>

      {/* panel body */}
      {open && (
        <div style={{
          pointerEvents: 'all',
          width: PANEL_WIDTH,
          height: '100%',
          background: '#111',
          borderLeft: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* header */}
          <div style={{
            padding: '10px 12px',
            borderBottom: '1px solid #222',
            color: '#00d4aa',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}>
            AI 助手
          </div>

          {/* message list */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: '#444', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                輸入指令，讓 AI 建議新增物件
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%',
                padding: '6px 10px',
                borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                background: msg.role === 'user' ? '#00d4aa22' : '#1a1a1a',
                border: `1px solid ${msg.role === 'user' ? '#00d4aa44' : '#2a2a2a'}`,
                color: msg.role === 'user' ? '#00d4aa' : '#bbb',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            ))}
            {isLoading && (
              <div style={{
                alignSelf: 'flex-start',
                color: '#555',
                fontSize: 12,
                padding: '4px 8px',
              }}>
                思考中…
              </div>
            )}
          </div>

          {/* accept / reject */}
          {hasPending && (
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #222',
              display: 'flex',
              gap: 8,
            }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6, width: '100%' }}>
                AI 建議 {pendingChanges.length} 個物件
              </div>
            </div>
          )}
          {hasPending && (
            <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
              <button
                onClick={onAccept}
                style={{
                  flex: 1, padding: '6px 0',
                  background: '#00d4aa22', color: '#00d4aa',
                  border: '1px solid #00d4aa66', borderRadius: 6,
                  cursor: 'pointer', fontSize: 13,
                }}
              >
                接受
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

          {/* input area */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid #222',
            display: 'flex',
            gap: 6,
          }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入指令，Enter 送出…"
              rows={2}
              style={{
                flex: 1,
                background: '#1a1a1a',
                color: '#ccc',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 12,
                resize: 'none',
                outline: 'none',
                lineHeight: 1.4,
                fontFamily: 'inherit',
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
                borderRadius: 6,
                cursor: isLoading || !input.trim() ? 'default' : 'pointer',
                fontSize: 13,
                alignSelf: 'stretch',
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
