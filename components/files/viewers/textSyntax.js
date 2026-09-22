/** @format */

/**
 * Dependency-free syntax highlighting for TextViewer.
 *
 * Hand-rolled rather than pulling in highlight.js/prism: the viewer only ever
 * *displays* code (no editing, no semantic analysis), and a generic tokenizer
 * covers the shapes nearly every text file uses — comments, strings, numbers,
 * keywords, tags.
 *
 * Highlighting is line-based with a carry state, so a line only needs the
 * state its predecessor ended in (open block comment, unterminated template
 * string, open tag, fenced code block).
 */

// Token kind -> class in text-viewer.css. Colours are defined there per theme
// ([data-theme="light"] / dark), so both themes flip on their own.
export const TOKEN_CLASS = {
  comment: 'tv-tok-comment',
  string: 'tv-tok-string',
  number: 'tv-tok-number',
  keyword: 'tv-tok-keyword',
  literal: 'tv-tok-literal',
  fn: 'tv-tok-fn',
  tag: 'tv-tok-tag',
  attr: 'tv-tok-attr',
  punct: 'tv-tok-punct',
  meta: 'tv-tok-meta',
  heading: 'tv-tok-heading',
  quote: 'tv-tok-quote',
  strong: 'tv-tok-strong',
  em: 'tv-tok-em',
  link: 'tv-tok-link',
  error: 'tv-tok-error',
  warn: 'tv-tok-warn',
  info: 'tv-tok-info',
};

const KW = {
  js: 'as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface keyof let namespace new of package private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield',
  // One union for the C family (c/c++/c#/java/go/rust/swift/kotlin/dart/scala):
  // a viewer only needs "this word is structural", not a per-dialect grammar.
  c: 'abstract alignas asm auto bool break case catch chan char class const constexpr continue crate default defer delete do double dyn else enum explicit export extends extern final finally float fn for friend func go goto if impl implements import in inline int interface internal let long map match mut mutable namespace new noexcept object operator override package private protected pub public range readonly ref register return select short signed sizeof static struct super switch synchronized template this throw throws trait transient try typedef typename union unsafe unsigned using val var virtual void volatile where while yield',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return self try while with yield match case',
  ruby: 'alias and begin break case class def defined do else elsif end ensure for if in module next not or redo require rescue retry return self super then undef unless until when while yield',
  shell: 'break case continue declare do done elif else esac eval exec exit export fi for function if in local read readonly return select set shift source then time trap unset until while',
  sql: 'add all alter and as asc begin between by case cascade column commit constraint create cross default delete desc distinct drop else end exists foreign from full group having if in index inner insert into is join key left like limit not null offset on or order outer primary references right rollback select set table then union unique update values view when where with',
  css: 'and charset extend font-face import important include keyframes media mixin not only print screen supports use',
  ini: 'true false on off yes no',
};

const LITERALS = 'true false null nil none undefined nan inf infinity nullptr';

const codeLang = (label, keywords, opts = {}) => ({
  label,
  mode: 'code',
  line: ['//'],
  block: ['/*', '*/'],
  quotes: '"\'',
  keywords,
  ...opts,
});

const hashLang = (label, keywords = '', opts = {}) => codeLang(label, keywords, { line: ['#'], block: null, ...opts });

const LANGS = {
  js: codeLang('JavaScript', KW.js, { quotes: '"\'`', multiline: '`' }),
  ts: codeLang('TypeScript', KW.js, { quotes: '"\'`', multiline: '`' }),
  json: codeLang('JSON', '', { quotes: '"' }),
  c: codeLang('C / C++', KW.c),
  java: codeLang('Java', KW.c),
  csharp: codeLang('C#', KW.c),
  go: codeLang('Go', KW.c, { quotes: '"\'`', multiline: '`' }),
  rust: codeLang('Rust', KW.c),
  php: codeLang('PHP', KW.c, { line: ['//', '#'] }),
  swift: codeLang('Swift', KW.c),
  kotlin: codeLang('Kotlin', KW.c),
  dart: codeLang('Dart', KW.c),
  scala: codeLang('Scala', KW.c),
  groovy: codeLang('Groovy', KW.c),
  css: codeLang('CSS', KW.css),
  py: hashLang('Python', KW.py, { triple: true }),
  ruby: hashLang('Ruby', KW.ruby),
  perl: hashLang('Perl', KW.ruby),
  shell: hashLang('Shell', KW.shell),
  powershell: hashLang('PowerShell', KW.shell, { block: ['<#', '#>'] }),
  yaml: hashLang('YAML', KW.ini),
  toml: hashLang('TOML', KW.ini),
  ini: hashLang('INI', KW.ini, { line: ['#', ';'] }),
  dockerfile: hashLang('Dockerfile', 'add arg as cmd copy entrypoint env expose from healthcheck label onbuild run shell user volume workdir'),
  makefile: hashLang('Makefile', 'define else endef endif export ifdef ifeq ifndef ifneq include'),
  graphql: hashLang('GraphQL', 'directive enum extend fragment implements input interface mutation on query scalar schema subscription type union'),
  hcl: hashLang('HCL', 'count data depends_on for_each locals module output provider resource terraform variable'),
  r: hashLang('R', 'break else for function if in next repeat return while'),
  lua: codeLang('Lua', 'and break do else elseif end for function goto if in local not or repeat return then until while', {
    line: ['--'],
    block: ['--[[', ']]'],
  }),
  sql: codeLang('SQL', KW.sql, { line: ['--'] }),
  markup: { label: 'HTML', mode: 'markup', block: ['<!--', '-->'] },
  markdown: { label: 'Markdown', mode: 'markdown' },
  log: { label: 'Log', mode: 'log' },
  plain: { label: 'Text', mode: 'plain' },
};

// Extension -> language. Every extension here must also sit in clientFileUtils'
// TEXT_EXTENSIONS, otherwise the file never reaches the text viewer.
const BY_EXT = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', vue: 'markup', svelte: 'markup', astro: 'markup',
  json: 'json', jsonc: 'json', json5: 'json', map: 'json', lock: 'json', webmanifest: 'json',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c', hxx: 'c', ino: 'c',
  java: 'java', cs: 'csharp', go: 'go', rs: 'rust', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  dart: 'dart', scala: 'scala', groovy: 'groovy', gradle: 'groovy',
  css: 'css', scss: 'css', sass: 'css', less: 'css', styl: 'css',
  py: 'py', pyw: 'py', rb: 'ruby', erb: 'ruby', pl: 'perl', pm: 'perl',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell', bat: 'shell', cmd: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', config: 'ini',
  properties: 'ini', env: 'ini', desktop: 'ini', service: 'ini',
  dockerfile: 'dockerfile', mk: 'makefile', make: 'makefile', cmake: 'makefile',
  graphql: 'graphql', gql: 'graphql', proto: 'graphql', tf: 'hcl', tfvars: 'hcl', hcl: 'hcl',
  r: 'r', lua: 'lua', sql: 'sql', psql: 'sql',
  html: 'markup', htm: 'markup', xhtml: 'markup', xml: 'markup', xsl: 'markup', xsd: 'markup',
  plist: 'markup', rss: 'markup', atom: 'markup', kml: 'markup',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  log: 'log',
};

// Extensionless / dotfile names that still have a known grammar.
const BY_NAME = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile',
  'cmakelists.txt': 'makefile', gemfile: 'ruby', rakefile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby',
  jenkinsfile: 'groovy', procfile: 'ini',
  '.gitignore': 'ini', '.gitattributes': 'ini', '.dockerignore': 'ini', '.npmignore': 'ini',
  '.editorconfig': 'ini', '.npmrc': 'ini', '.nvmrc': 'ini', '.env': 'ini',
  '.bashrc': 'shell', '.bash_profile': 'shell', '.zshrc': 'shell', '.profile': 'shell',
  '.babelrc': 'json', '.prettierrc': 'json', '.eslintrc': 'json',
  readme: 'markdown', changelog: 'markdown', license: 'plain', authors: 'plain', notice: 'plain', copying: 'plain',
};

/** The language a file name maps to. Never null — falls back to plain text. */
export function languageOf(name = '') {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const extension = dot > 0 ? lower.slice(dot + 1) : '';
  const id = BY_NAME[lower] || BY_EXT[extension] || 'plain';
  return { id, ...LANGS[id] };
}

const IDENT_START = /[A-Za-z_$@]/;
const IDENT = /[A-Za-z0-9_$-]/;
const DIGIT = /[0-9]/;
const NUMBER_BODY = /[0-9a-fA-FxXbBoO._]/;
const PUNCT = '{}[]()<>=+-*/%!&|^~?:;,.';

const keywordCache = new Map();
function keywordsOf(lang) {
  if (!keywordCache.has(lang.id)) keywordCache.set(lang.id, new Set((lang.keywords || '').split(/\s+/).filter(Boolean)));
  return keywordCache.get(lang.id);
}
const literalSet = new Set(LITERALS.split(' '));

/** Appends a piece, merging into the previous one when the kind matches. */
function push(pieces, text, kind) {
  if (!text) return;
  const last = pieces[pieces.length - 1];
  if (last && last[1] === kind) last[0] += text;
  else pieces.push([text, kind]);
}

/**
 * Scans a quoted string starting at `i`. Returns the index just past the
 * closing quote, or -1 when the line ends inside the string.
 */
function scanString(line, i, quote) {
  for (let j = i + quote.length; j < line.length; j++) {
    if (line[j] === '\\') j++;
    else if (line.startsWith(quote, j)) return j + quote.length;
  }
  return -1;
}

function tokenizeCode(line, lang, state) {
  const pieces = [];
  const keywords = keywordsOf(lang);
  let carried = state;
  let i = 0;

  if (carried.block && lang.block) {
    const end = line.indexOf(lang.block[1]);
    if (end < 0) return { pieces: [[line, 'comment']], state: carried };
    i = end + lang.block[1].length;
    push(pieces, line.slice(0, i), 'comment');
    carried = { ...carried, block: false };
  } else if (carried.str) {
    // The opening quote is on an earlier line, so scan as if it ended just
    // before the start of this one.
    const end = scanString(line, -carried.str.length, carried.str);
    if (end < 0) return { pieces: [[line, 'string']], state: carried };
    push(pieces, line.slice(0, end), 'string');
    i = end;
    carried = { ...carried, str: null };
  }

  // Everything below indexes into `line` rather than slicing a `rest` per
  // character: a minified file is one very long line, and re-slicing it on
  // every step is quadratic.
  while (i < line.length) {
    if (lang.block && line.startsWith(lang.block[0], i)) {
      const end = line.indexOf(lang.block[1], i + lang.block[0].length);
      if (end < 0) {
        push(pieces, line.slice(i), 'comment');
        return { pieces, state: { ...carried, block: true } };
      }
      push(pieces, line.slice(i, end + lang.block[1].length), 'comment');
      i = end + lang.block[1].length;
      continue;
    }

    if ((lang.line || []).some((prefix) => line.startsWith(prefix, i))) {
      push(pieces, line.slice(i), 'comment');
      break;
    }

    const char = line[i];

    if ((lang.quotes || '').includes(char)) {
      const triple = lang.triple && line.startsWith(char.repeat(3), i) ? char.repeat(3) : null;
      const quote = triple || char;
      const end = scanString(line, i, quote);
      if (end < 0) {
        push(pieces, line.slice(i), 'string');
        const spansLines = triple != null || (lang.multiline || '').includes(char);
        return { pieces, state: { ...carried, str: spansLines ? quote : null } };
      }
      push(pieces, line.slice(i, end), 'string');
      i = end;
      continue;
    }

    if (DIGIT.test(char) || (char === '.' && DIGIT.test(line[i + 1] || ''))) {
      let j = i;
      while (j < line.length && NUMBER_BODY.test(line[j])) j++;
      push(pieces, line.slice(i, j), 'number');
      i = j;
      continue;
    }

    if (IDENT_START.test(char)) {
      // Starts at i + 1: `@` opens a word (CSS at-rules, decorators) without
      // being an IDENT character itself, and a zero-width word would spin here.
      let j = i + 1;
      while (j < line.length && IDENT.test(line[j])) j++;
      const word = line.slice(i, j);
      const lower = word.toLowerCase();
      let after = j;
      while (after < line.length && line[after] === ' ') after++;
      // `@media`, `$if`: the sigil belongs to the word, but the keyword lists
      // spell them bare.
      const bare = lower.replace(/^[@$]/, '');
      if (keywords.has(word) || keywords.has(lower) || keywords.has(bare)) push(pieces, word, 'keyword');
      else if (literalSet.has(lower)) push(pieces, word, 'literal');
      else if (line[after] === '(') push(pieces, word, 'fn');
      else push(pieces, word, null);
      i = j;
      continue;
    }

    push(pieces, char, PUNCT.includes(char) ? 'punct' : null);
    i++;
  }

  return { pieces, state: carried };
}

function tokenizeMarkup(line, lang, state) {
  const pieces = [];
  let carried = state;
  let inTag = carried.tag;
  let i = 0;

  if (carried.block) {
    const end = line.indexOf('-->');
    if (end < 0) return { pieces: [[line, 'comment']], state: carried };
    push(pieces, line.slice(0, end + 3), 'comment');
    i = end + 3;
    carried = { ...carried, block: false };
  }

  while (i < line.length) {
    if (!inTag) {
      const open = line.indexOf('<', i);
      if (open < 0) {
        push(pieces, line.slice(i), null);
        break;
      }
      push(pieces, line.slice(i, open), null);
      if (line.startsWith('<!--', open)) {
        const end = line.indexOf('-->', open);
        if (end < 0) {
          push(pieces, line.slice(open), 'comment');
          return { pieces, state: { ...carried, block: true, tag: false } };
        }
        push(pieces, line.slice(open, end + 3), 'comment');
        i = end + 3;
        continue;
      }
      let j = open + 1;
      while (j < line.length && /[/!?]/.test(line[j])) j++;
      while (j < line.length && /[A-Za-z0-9:_.-]/.test(line[j])) j++;
      push(pieces, line.slice(open, j), 'tag');
      i = j;
      inTag = true;
      continue;
    }

    const char = line[i];
    if (char === '>' || line.startsWith('/>', i)) {
      const width = char === '>' ? 1 : 2;
      push(pieces, line.slice(i, i + width), 'tag');
      i += width;
      inTag = false;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = scanString(line, i, char);
      push(pieces, line.slice(i, end < 0 ? line.length : end), 'string');
      i = end < 0 ? line.length : end;
      continue;
    }
    if (/[A-Za-z_:]/.test(char)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9:_.-]/.test(line[j])) j++;
      push(pieces, line.slice(i, j), 'attr');
      i = j;
      continue;
    }
    push(pieces, char, char === '=' ? 'punct' : null);
    i++;
  }

  return { pieces, state: { ...carried, tag: inTag } };
}

// Inline markdown spans: `code`, **strong**, *em*, [text](href).
const MD_INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]*\]\([^)]*\))/g;

function markdownInline(text, pieces) {
  let last = 0;
  for (const match of text.matchAll(MD_INLINE)) {
    push(pieces, text.slice(last, match.index), null);
    push(pieces, match[0], match[1] ? 'string' : match[2] ? 'strong' : match[3] ? 'em' : 'link');
    last = match.index + match[0].length;
  }
  push(pieces, text.slice(last), null);
}

function tokenizeMarkdown(line, lang, state) {
  const isFence = /^\s*(```|~~~)/.test(line);
  if (state.fence) return { pieces: [[line, isFence ? 'meta' : 'string']], state: { ...state, fence: !isFence } };
  if (isFence) return { pieces: [[line, 'meta']], state: { ...state, fence: true } };
  if (/^\s*#{1,6}\s/.test(line)) return { pieces: [[line, 'heading']], state };
  if (/^\s*>/.test(line)) return { pieces: [[line, 'quote']], state };
  if (/^\s*(-{3,}|={3,})\s*$/.test(line)) return { pieces: [[line, 'meta']], state };

  const pieces = [];
  const bullet = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)/);
  let rest = line;
  if (bullet) {
    push(pieces, bullet[1], null);
    push(pieces, bullet[2], 'keyword');
    push(pieces, bullet[3], null);
    rest = line.slice(bullet[0].length);
  }
  markdownInline(rest, pieces);
  return { pieces, state };
}

const LOG_LEVEL = /\b(EMERG|ALERT|CRIT(?:ICAL)?|ERR(?:OR)?|FAIL(?:ED|URE)?|FATAL|WARN(?:ING)?|NOTICE|INFO|DEBUG|TRACE|SUCCESS)\b/gi;
// Leading "[whatever]", ISO timestamp, or syslog "Aug 26 11:46:01".
const LOG_HEAD = /^\s*(\[[^\]]*\]|\d{4}-\d{2}-\d{2}[T ][\d:.,+-]*|\w{3}\s+\d{1,2}\s[\d:]+)/;

function tokenizeLog(line, lang, state) {
  const pieces = [];
  const head = line.match(LOG_HEAD);
  const rest = head ? line.slice(head[0].length) : line;
  if (head) push(pieces, head[0], 'meta');

  let last = 0;
  for (const match of rest.matchAll(LOG_LEVEL)) {
    push(pieces, rest.slice(last, match.index), null);
    const level = match[0].toUpperCase();
    const kind = /^(EMERG|ALERT|CRIT|ERR|FAIL|FATAL)/.test(level) ? 'error' : /^(WARN|NOTICE)/.test(level) ? 'warn' : 'info';
    push(pieces, match[0], kind);
    last = match.index + match[0].length;
  }
  push(pieces, rest.slice(last), null);
  return { pieces, state };
}

const TOKENIZERS = { code: tokenizeCode, markup: tokenizeMarkup, markdown: tokenizeMarkdown, log: tokenizeLog };

/** Initial carry state for a file. */
export const initialState = () => ({ block: false, str: null, tag: false, fence: false });

/**
 * Tokenizes one line, carrying the multi-line state forward.
 * @returns {{pieces: Array<[string, string|null]>, state: object}}
 */
export function tokenizeLine(line, lang, state) {
  const tokenize = TOKENIZERS[lang.mode];
  if (!tokenize) return { pieces: [[line, null]], state };
  return tokenize(line, lang, state);
}

/** Lines tokenized per batch. Small enough to be imperceptible on open. */
const CHUNK = 256;

/**
 * Tokenizes on demand, a chunk at a time, caching as it goes.
 *
 * Doing the whole file up front is the obvious implementation and the wrong
 * one: a multi-MB log costs a full tokenizing pass — plus one pieces array per
 * line, retained — before the first line can paint, even though the viewer
 * windows its rows and will only ever show a few dozen of them.
 *
 * The catch is that the tokenizer carries state across lines (an open block
 * comment, an unterminated template string, a markdown fence), so line N's
 * colours depend on every line before it. Hence chunks: the carry state is
 * saved at each chunk boundary, so reaching a given line only costs the lines
 * between it and the furthest boundary already computed — one chunk on open,
 * and nothing at all to re-scroll over ground already covered.
 *
 * @returns {{lineAt: (index:number) => Array<[string, string|null]>|undefined}}
 */
export function createHighlighter(lines, lang) {
  const cache = new Array(lines.length);
  // states[c] is the carry state *entering* chunk c; states[0] is the file's.
  const states = [initialState()];
  const chunkCount = Math.ceil(lines.length / CHUNK);
  let ready = 0;

  function ensure(chunk) {
    while (ready <= chunk && ready < chunkCount) {
      const start = ready * CHUNK;
      const end = Math.min(start + CHUNK, lines.length);
      let state = states[ready];
      for (let i = start; i < end; i++) {
        const result = tokenizeLine(lines[i], lang, state);
        cache[i] = result.pieces;
        state = result.state;
      }
      ready += 1;
      states[ready] = state;
    }
  }

  return {
    lineAt(index) {
      if (index < 0 || index >= lines.length) return undefined;
      ensure(Math.floor(index / CHUNK));
      return cache[index];
    },
  };
}
