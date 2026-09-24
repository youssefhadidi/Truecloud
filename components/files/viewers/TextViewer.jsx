/** @format */

'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiSearch, FiChevronUp, FiChevronDown, FiCopy, FiCheck, FiAlignLeft } from 'react-icons/fi';
import { useDebounce } from '@/hooks/useDebounce';
import { useTranslation } from '@/components/LanguageProvider';
import { formatFileSize } from '@/lib/clientFileUtils';
import { TOKEN_CLASS, createHighlighter, languageOf } from './textSyntax';
import './text-viewer.css';

const LINE_HEIGHT = 20;
const GUTTER_PX = 52;
// Above this the one-pass tokenizer costs more than the colours are worth, so
// the file is shown as plain text (still virtualized, still searchable).
const HIGHLIGHT_MAX_CHARS = 2_000_000;
// A minified bundle is one enormous line: tokenizing it would put hundreds of
// thousands of spans in a single row, so it renders as plain text instead.
const HIGHLIGHT_MAX_LINE = 5_000;
// Wrapping means variable row heights, which the fixed-height list can't
// window — so wrapped files render every line and stay capped.
const WRAP_MAX_LINES = 20_000;
// Windowing bounds the DOM, not the memory: the bytes are copied into an
// ArrayBuffer, decoded to a UTF-16 string and split per line — several times
// the file's size resident before the first row paints. Past this, ask first.
const HEAVY_TEXT_BYTES = 50 * 1024 * 1024;

/** A NUL early in the file means we were handed binary, whatever the extension says. */
const NUL_CHAR = String.fromCharCode(0);
const looksBinary = (text) => text.slice(0, 4096).includes(NUL_CHAR);

/**
 * Decodes downloaded bytes to text. UTF-8 is tried strictly first so a legacy
 * 8-bit file (old logs, Windows-generated exports, a CSV saved by a French
 * Excel) falls back to cp1252 instead of rendering a field of U+FFFD; a
 * BOM-marked UTF-16 file is handled ahead of both.
 */
function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Read-only viewer for text and source files: line numbers, find-in-file, wrap
 * toggle, copy, and hand-rolled syntax highlighting (./textSyntax.js). Lines
 * are windowed so a multi-MB log stays at a few dozen DOM nodes.
 */
export default function TextViewer({ file, getFileUrl }) {
  const [confirmed, setConfirmed] = useState(false);
  const heavy = !confirmed && Number(file.size) > HEAVY_TEXT_BYTES;
  if (heavy) return <HeavyGate size={file.size} onConfirm={() => setConfirmed(true)} />;
  return <TextViewerBody key={file.id ?? file.name} file={file} url={getFileUrl(file, 'download')} />;
}

function TextViewerBody({ file, url }) {
  const { t } = useTranslation();
  const lang = useMemo(() => languageOf(file?.name || ''), [file?.name]);

  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);
  const [byteSize, setByteSize] = useState(null);
  // Prose wraps by default; code and logs keep their columns and scroll.
  const [wrapPref, setWrapPref] = useState(lang.mode === 'plain' || lang.mode === 'markdown');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState(false);

  const listRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        setByteSize(buffer.byteLength);
        setText(decodeText(buffer));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, [url]);

  const lines = useMemo(() => (text == null ? [] : text.split(/\r?\n/)), [text]);
  const binary = text != null && looksBinary(text);
  // Wrapping drops the windowing, so it stays off for files too long to render
  // in full — whatever the preference says.
  const canWrap = lines.length <= WRAP_MAX_LINES;
  const wrap = wrapPref && canWrap;

  const longestLine = useMemo(() => lines.reduce((max, line) => (line.length > max ? line.length : max), 0), [lines]);

  // Tokenizes lazily, so opening a large file costs one chunk rather than a
  // pass over the whole thing (see createHighlighter).
  const highlighter = useMemo(() => {
    if (text == null || binary || lang.mode === 'plain') return null;
    if (text.length > HIGHLIGHT_MAX_CHARS || longestLine > HIGHLIGHT_MAX_LINE) return null;
    return createHighlighter(lines, lang);
  }, [lines, lang, text, binary, longestLine]);

  // Every row reserves the widest line's width, so the horizontal scroll range
  // doesn't jump as rows scroll in and out of the window.
  const minWidth = `calc(${GUTTER_PX}px + ${Math.min(longestLine, 20_000)}ch + 2rem)`;

  // Scanning every line is O(file) — cheap once, but not once per keystroke on
  // a multi-MB log. The field itself stays on `query`, so typing never lags.
  const needle = useDebounce(query.trim().toLowerCase(), 200);
  const matches = useMemo(() => {
    if (!needle) return [];
    const found = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle)) found.push(index);
    });
    return found;
  }, [lines, needle]);

  const activeLine = matches.length ? matches[Math.min(cursor, matches.length - 1)] : null;

  useEffect(() => {
    if (activeLine == null) return;
    if (wrap) wrapRef.current?.querySelector(`[data-line="${activeLine}"]`)?.scrollIntoView({ block: 'center' });
    else listRef.current?.scrollToIndex(Math.max(0, activeLine - 4));
  }, [activeLine, wrap]);

  const step = (delta) => {
    if (!matches.length) return;
    setCursor((prev) => (prev + delta + matches.length) % matches.length);
  };

  const copy = () => {
    navigator.clipboard
      ?.writeText(text ?? '')
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (failed) return <StateCard text={t('viewer.textLoadFailed')} error />;
  if (text == null) return <StateCard text={t('viewer.loadingText')} spinner />;
  if (binary) return <StateCard text={t('viewer.textNotReadable')} error />;

  const rowStyle = wrap ? undefined : { minWidth };

  const renderLine = (line, index) => (
    <div
      data-line={index}
      style={rowStyle}
      className={['tv-row', wrap ? 'tv-row--wrap' : '', index === activeLine ? 'tv-row--active' : ''].join(' ')}
    >
      <span className="tv-gutter">{index + 1}</span>
      <code className={wrap ? 'tv-code tv-code--wrap' : 'tv-code'}>{renderPieces(highlighter?.lineAt(index) ?? [[line, null]], needle)}</code>
    </div>
  );

  return (
    // Stop the stage's custom context menu and click handlers: here the native
    // menu (copy / select all) is the useful one.
    <div className="tv-root" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="tv-toolbar">
        <span className="tv-lang">{lang.label}</span>
        <span className="tv-meta">
          {t('viewer.textLines', { count: lines.length.toLocaleString() })} · {formatFileSize(byteSize ?? file.size)}
        </span>

        <div style={{ flex: 1 }} />

        <div className="tv-search">
          <FiSearch size={13} className="tv-search__icon" />
          <input
            className="tv-search__input"
            value={query}
            placeholder={t('viewer.textSearch')}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape' && query) {
                // Clear the field rather than closing the whole viewer.
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setQuery('');
              }
            }}
          />
        </div>
        {needle && (
          <span className="tv-count">
            {matches.length ? `${Math.min(cursor, matches.length - 1) + 1}/${matches.length}` : t('viewer.textNoResults')}
          </span>
        )}
        <button type="button" className="mv-icon-btn tv-btn" title={t('viewer.textPrevMatch')} disabled={!matches.length} onClick={() => step(-1)}>
          <FiChevronUp size={15} />
        </button>
        <button type="button" className="mv-icon-btn tv-btn" title={t('viewer.textNextMatch')} disabled={!matches.length} onClick={() => step(1)}>
          <FiChevronDown size={15} />
        </button>

        <button
          type="button"
          className="mv-icon-btn tv-btn"
          disabled={!canWrap}
          title={canWrap ? t('viewer.textWrap') : t('viewer.textTooLargeToWrap')}
          onClick={() => setWrapPref((prev) => !prev)}
          style={wrap ? { color: 'var(--accent)' } : undefined}
        >
          <FiAlignLeft size={15} />
        </button>
        <button type="button" className="mv-icon-btn tv-btn" title={copied ? t('viewer.textCopied') : t('viewer.textCopy')} onClick={copy}>
          {copied ? <FiCheck size={15} /> : <FiCopy size={15} />}
        </button>
      </div>

      {wrap ? (
        <div ref={wrapRef} className="tv-scroll">
          {lines.map((line, index) => (
            <div key={index}>{renderLine(line, index)}</div>
          ))}
        </div>
      ) : (
        <VirtualList ref={listRef} items={lines} itemHeight={LINE_HEIGHT} renderItem={renderLine} className="tv-scroll" overscan={12} />
      )}
    </div>
  );
}

/** Renders one line's tokens, tinting the search matches inside them. */
function renderPieces(pieces, needle) {
  return pieces.map(([value, kind], index) => {
    const className = kind ? TOKEN_CLASS[kind] : undefined;
    if (!needle) {
      return (
        <span key={index} className={className}>
          {value}
        </span>
      );
    }

    const parts = [];
    const lower = value.toLowerCase();
    let from = 0;
    let at = lower.indexOf(needle);
    while (at >= 0) {
      if (at > from) parts.push(value.slice(from, at));
      parts.push(
        <mark key={at} className="tv-mark">
          {value.slice(at, at + needle.length)}
        </mark>,
      );
      from = at + needle.length;
      at = lower.indexOf(needle, from);
    }
    parts.push(value.slice(from));

    return (
      <span key={index} className={className}>
        {parts}
      </span>
    );
  });
}

/**
 * Fixed-height windowing list: renders only the rows in (and just around) the
 * viewport, absolutely positioned inside a full-size spacer.
 */
const VirtualList = forwardRef(function VirtualList({ items, itemHeight, renderItem, overscan = 8, className }, ref) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index) => {
        if (scrollRef.current) scrollRef.current.scrollTop = index * itemHeight;
      },
    }),
    [itemHeight],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setViewport(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewport) / itemHeight) + overscan);

  const rows = [];
  for (let index = first; index < last; index++) {
    rows.push(
      <div key={index} style={{ position: 'absolute', top: index * itemHeight, left: 0, height: itemHeight }}>
        {renderItem(items[index], index)}
      </div>,
    );
  }

  return (
    <div ref={scrollRef} className={className} style={{ position: 'relative' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * itemHeight, position: 'relative', width: '100%' }}>{rows}</div>
    </div>
  );
});

function StateCard({ text, spinner, error }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card" style={error ? { color: 'var(--danger)' } : undefined}>
        {spinner && <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />}
        <span className="mv-loader-card__text" style={error ? { color: 'var(--danger)' } : undefined}>
          {text}
        </span>
      </div>
    </div>
  );
}

function HeavyGate({ size, onConfirm }) {
  const { t } = useTranslation();
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mv-loader-card" style={{ flexDirection: 'column', gap: 12, padding: '28px 36px', textAlign: 'center', maxWidth: 420 }}>
        <span className="mv-loader-card__text" style={{ fontWeight: 600, color: 'var(--text)' }}>
          {t('viewer.textLargeTitle')}
        </span>
        <span className="mv-loader-card__text" style={{ fontSize: 12 }}>
          {t('viewer.textLargeBody', { size: formatFileSize(size) })}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--r-sm)',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('viewer.textOpenAnyway')}
        </button>
      </div>
    </div>
  );
}
