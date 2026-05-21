/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import { FiX, FiSend, FiTrash2, FiAlertCircle } from 'react-icons/fi';
import { useAiChat } from '@/hooks/useAiChat';

const MODELS = [
  { id: 'sonnet', label: 'Sonnet — recommended' },
  { id: 'haiku', label: 'Haiku — faster' },
  { id: 'opus', label: 'Opus — strongest' },
];

const iconBtn = {
  width: 28,
  height: 28,
  borderRadius: 'var(--r-xs)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-2)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

function MessageBubble({ role, content, pulsing }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        background: isUser ? 'var(--accent)' : 'var(--surface-2)',
        color: isUser ? '#fff' : 'var(--text)',
        padding: '8px 12px',
        borderRadius: 'var(--r-md)',
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content || (pulsing ? <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Thinking…</span> : '')}
    </div>
  );
}

export default function AiChatPanel({ filePath, fileName, isMobile, onClose }) {
  const { messages, streaming, streamingText, usage, error, send, clear, loadingHistory } = useAiChat(filePath);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText]);

  const submit = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    send(text, { model });
  };

  const quotaText = usage
    ? `${usage.todayRequests} / ${usage.dailyLimit} requests today`
    : '…';
  const quotaPct = usage && usage.dailyLimit > 0
    ? Math.min(100, (usage.todayRequests / usage.dailyLimit) * 100)
    : 0;
  const barColor =
    quotaPct >= 100 ? 'var(--danger)' :
    quotaPct >= 80 ? 'var(--warning)' :
    'var(--accent)';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: isMobile ? '100%' : 400,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Ask Claude</div>
          <div className="tc-truncate" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {fileName}
          </div>
        </div>
        <button
          type="button"
          onClick={clear}
          title="Clear chat"
          disabled={messages.length === 0 || streaming}
          style={{ ...iconBtn, opacity: messages.length === 0 || streaming ? 0.4 : 1 }}
        >
          <FiTrash2 size={14} />
        </button>
        <button type="button" onClick={onClose} title="Close" style={iconBtn}>
          <FiX size={16} />
        </button>
      </div>

      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>{quotaText}</span>
        </div>
        <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
          <div
            style={{
              width: `${quotaPct}%`,
              height: '100%',
              background: barColor,
              transition: 'width 200ms',
            }}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {loadingHistory && (
          <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Loading…</div>
        )}
        {!loadingHistory && messages.length === 0 && !streaming && (
          <div
            style={{
              color: 'var(--text-3)',
              fontSize: 12,
              textAlign: 'center',
              marginTop: 32,
              padding: '0 20px',
            }}
          >
            Ask anything about <strong style={{ color: 'var(--text-2)' }}>{fileName}</strong>.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {streaming && <MessageBubble role="assistant" content={streamingText} pulsing />}
        {error && (
          <div
            style={{
              background: 'color-mix(in oklab, var(--danger) 14%, var(--surface))',
              color: 'var(--danger)',
              padding: 10,
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <FiAlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        style={{
          padding: 12,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--text-3)',
          }}
        >
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={streaming}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-xs)',
              padding: '4px 6px',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about this file…"
            rows={2}
            disabled={streaming}
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            style={{
              background: streaming || !input.trim() ? 'var(--surface-2)' : 'var(--accent)',
              color: streaming || !input.trim() ? 'var(--text-3)' : '#fff',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              padding: '10px 12px',
              cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'inherit',
              height: 38,
            }}
          >
            <FiSend size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
