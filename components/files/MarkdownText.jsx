/** @format */

'use client';

// Tiny markdown renderer for AI chat. Handles only the syntax Claude actually
// emits: fenced code blocks, headings (1-3), unordered/ordered lists, bold,
// inline code, and links. Italic is intentionally skipped because single-*
// rules conflict with **bold** parsing in a streaming context.
//
// Streaming-safe: incomplete markers (e.g. half-typed ``**bo``) fall through
// as plain text instead of swallowing the prefix.

import { memo } from 'react';

const codeBg = 'rgba(127, 127, 127, 0.18)';

function InlineMd({ text }) {
  if (!text) return null;
  const parts = [];
  let i = 0;
  let buf = '';

  const flush = () => { if (buf) { parts.push(buf); buf = ''; } };

  while (i < text.length) {
    const ch = text[i];

    // Inline code: `xxx`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        parts.push(
          <code
            key={parts.length}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '0.92em',
              padding: '1px 5px',
              borderRadius: 4,
              background: codeBg,
            }}
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // Bold: **xxx**
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        parts.push(
          <strong key={parts.length}>{text.slice(i + 2, end)}</strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // Link: [text](url)
    if (ch === '[') {
      const closeB = text.indexOf(']', i + 1);
      if (closeB > i && text[closeB + 1] === '(') {
        const closeP = text.indexOf(')', closeB + 2);
        if (closeP > closeB) {
          const label = text.slice(i + 1, closeB);
          const url = text.slice(closeB + 2, closeP);
          if (/^(https?:|mailto:|\/)/.test(url)) {
            flush();
            parts.push(
              <a
                key={parts.length}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {label}
              </a>,
            );
            i = closeP + 1;
            continue;
          }
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return parts;
}

function isHeading(line) {
  return /^(#{1,3})\s+\S/.test(line);
}
function isBulletItem(line) {
  return /^[-*]\s+\S/.test(line);
}
function isOrderedItem(line) {
  return /^\d+\.\s+\S/.test(line);
}

function MarkdownTextInner({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ type: 'code', lang, content: code.join('\n') });
      continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, content: h[2] });
      i++;
      continue;
    }

    // Unordered list
    if (isBulletItem(line)) {
      const items = [];
      while (i < lines.length && isBulletItem(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (isOrderedItem(line)) {
      const items = [];
      while (i < lines.length && isOrderedItem(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Blank line — paragraph separator
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect until blank line or special line
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !isHeading(lines[i]) &&
      !isBulletItem(lines[i]) &&
      !isOrderedItem(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', content: para.join('\n') });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocks.map((b, idx) => {
        const key = idx;
        switch (b.type) {
          case 'heading': {
            const fontSize = b.level === 1 ? '1.15em' : b.level === 2 ? '1.05em' : '1em';
            return (
              <div key={key} style={{ fontSize, fontWeight: 700, marginTop: idx === 0 ? 0 : 4 }}>
                <InlineMd text={b.content} />
              </div>
            );
          }
          case 'code':
            return (
              <pre
                key={key}
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: codeBg,
                  overflowX: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.88em',
                  lineHeight: 1.45,
                  whiteSpace: 'pre',
                }}
              >
                <code>{b.content}</code>
              </pre>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.type === 'ol' ? 'ol' : 'ul';
            return (
              <Tag
                key={key}
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {b.items.map((it, j) => (
                  <li key={j}><InlineMd text={it} /></li>
                ))}
              </Tag>
            );
          }
          case 'p':
          default:
            return (
              <div key={key} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <InlineMd text={b.content} />
              </div>
            );
        }
      })}
    </div>
  );
}

const MarkdownText = memo(MarkdownTextInner);
export default MarkdownText;
