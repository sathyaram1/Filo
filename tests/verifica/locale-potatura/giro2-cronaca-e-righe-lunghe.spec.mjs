// Verifica locale della potatura dei commenti, secondo giro. Le porte del primo giro
// che si misurano a macchina: la cronaca datata dentro i commenti, i paragrafi scritti
// su una riga sola, le etichette che ripetono il nome di ciò che sta sotto.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd());
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');

function jsFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) jsFiles(p, acc);
    else if (e.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const SRC = jsFiles(join(ROOT, 'src')).map(p => relative(ROOT, p).replace(/\\/g, '/')).sort();

// Intervalli dei commenti col lexer di TypeScript (template e regex compresi).
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
function commentRanges(text) {
  const K = ts.SyntaxKind;
  const sc = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, text);
  const out = [], stack = [];
  let prevKind = null, prevText = '';
  for (;;) {
    let kind = sc.scan();
    if (kind === K.EndOfFileToken) break;
    if (kind === K.SingleLineCommentTrivia || kind === K.MultiLineCommentTrivia) { out.push([sc.getTokenStart(), sc.getTextPos()]); continue; }
    if (kind === K.WhitespaceTrivia || kind === K.NewLineTrivia || kind === K.ShebangTrivia) continue;
    if (kind === K.SlashToken || kind === K.SlashEqualsToken) {
      const noRegex = [K.Identifier, K.NumericLiteral, K.BigIntLiteral, K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateTail, K.CloseParenToken, K.CloseBracketToken, K.ThisKeyword, K.TrueKeyword, K.FalseKeyword, K.NullKeyword, K.PlusPlusToken, K.MinusMinusToken, K.CloseBraceToken].includes(prevKind);
      if (!noRegex || REGEX_AFTER.has(prevText)) kind = sc.reScanSlashToken();
    }
    if (kind === K.TemplateHead) stack.push('tpl');
    else if (kind === K.OpenBraceToken) stack.push('{');
    else if (kind === K.CloseBraceToken) {
      if (stack.at(-1) === '{') stack.pop();
      else if (stack.at(-1) === 'tpl') { kind = sc.reScanTemplateToken(false); if (kind === K.TemplateTail) stack.pop(); }
    }
    prevKind = kind; prevText = sc.getTokenText();
  }
  return out;
}
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

// Ogni commento: riga, testo (senza i delimitatori), se sta in coda a del codice, e la
// prima riga di codice che lo segue.
function comments(text) {
  const lines = text.split('\n');
  return commentRanges(text).map(([s, e]) => {
    const ls = lineOf(text, s), le = lineOf(text, e - 1);
    const trailing = text.slice(text.lastIndexOf('\n', s - 1) + 1, s).trim().length > 0;
    const rows = text.slice(s, e).split('\n').map(r => r.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, '').replace(/\s*\*\/\s*$/, '').trim());
    let next = '';
    for (let i = le; i < lines.length; i++) { const t = lines[i].trim(); if (t && !/^(\/\/|\/\*|\*)/.test(t)) { next = t; break; } }
    return { ls, le, trailing, rows, next };
  });
}

test('nessuna data di calendario dentro i commenti: la cronologia la tiene git', () => {
  const date = [];
  const RE = /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\/\d{1,2}\/20\d\d\b/;
  for (const f of SRC) {
    for (const c of comments(readFileSync(join(ROOT, f), 'utf8'))) {
      c.rows.forEach((r, i) => { if (RE.test(r)) date.push(`${f}:${c.ls + i}  ${r.slice(0, 100)}`); });
    }
  }
  expect(date, 'commenti con una data').toEqual([]);
});

test('una riga di commento resta una riga: al massimo 120 caratteri di testo', () => {
  const lunghe = [];
  for (const f of SRC) {
    for (const c of comments(readFileSync(join(ROOT, f), 'utf8'))) {
      c.rows.forEach((r, i) => { if (r.length > 120) lunghe.push(`${f}:${c.ls + i} (${r.length})`); });
    }
  }
  expect(lunghe, 'righe di commento oltre i 120 caratteri di testo').toEqual([]);
});

test('nessuna etichetta che ripete il nome di ciò che sta sotto', () => {
  const etichette = [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const f of SRC) {
    for (const c of comments(readFileSync(join(ROOT, f), 'utf8'))) {
      if (c.trailing || c.rows.length !== 1 || !c.next) continue;
      const m = c.next.match(/^(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/);
      if (m && norm(c.rows[0]) === norm(m[1])) etichette.push(`${f}:${c.ls}  «${c.rows[0]}» sopra ${m[1]}`);
    }
  }
  expect(etichette, 'etichette uguali al nome sotto').toEqual([]);
});
