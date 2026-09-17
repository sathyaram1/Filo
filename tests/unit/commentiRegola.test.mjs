// Sentinella: i commenti sotto src/ rispettano la regola di CLAUDE.md § Commenti nel codice
// nelle parti che si misurano a macchina. Diventa rossa alla prima riga che le viola, sulla
// macchina di chi l'ha scritta. Pura logica: niente Electron, millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
const SRC = jsFiles(join(ROOT, 'src')).map((p) => relative(ROOT, p).replace(/\\/g, '/')).sort();

// Il lexer di TypeScript distingue i commenti da template e regex, dove una regex ingenua sbaglia.
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

function comments(text) {
  const lines = text.split('\n');
  return commentRanges(text).map(([s, e]) => {
    const ls = lineOf(text, s), le = lineOf(text, e - 1);
    const trailing = text.slice(text.lastIndexOf('\n', s - 1) + 1, s).trim().length > 0;
    const rows = text.slice(s, e).split('\n').map((r) => r.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, '').replace(/\s*\*\/\s*$/, '').trim());
    let next = '';
    for (let i = le; i < lines.length; i++) { const t = lines[i].trim(); if (t && !/^(\/\/|\/\*|\*)/.test(t)) { next = t; break; } }
    return { ls, le, trailing, rows, next };
  });
}

const perFile = new Map(SRC.map((f) => [f, comments(readFileSync(join(ROOT, f), 'utf8'))]));

test('nessuna data di calendario nei commenti: la cronologia la tiene git', () => {
  const RE = /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\/\d{1,2}\/20\d\d\b/;
  const date = [];
  for (const [f, cs] of perFile) for (const c of cs) c.rows.forEach((r, i) => { if (RE.test(r)) date.push(`${f}:${c.ls + i}`); });
  assert.deepEqual(date, [], 'commenti con una data dentro');
});

test('una riga di commento resta una riga: al massimo 120 caratteri di testo', () => {
  const lunghe = [];
  for (const [f, cs] of perFile) for (const c of cs) c.rows.forEach((r, i) => { if (r.length > 120) lunghe.push(`${f}:${c.ls + i} (${r.length})`); });
  assert.deepEqual(lunghe, [], 'righe di commento oltre i 120 caratteri');
});

test('un commento a sé non supera le due righe, salvo l’intestazione del file', () => {
  const lunghi = [];
  for (const [f, cs] of perFile) {
    let blocco = null;
    for (const c of cs) {
      if (c.trailing) { blocco = null; continue; }
      if (blocco && blocco.le + 1 >= c.ls) blocco.le = c.le; else blocco = { ls: c.ls, le: c.le }, lunghi.push(blocco), (blocco.f = f);
    }
  }
  const fuori = lunghi.filter((b) => b.le - b.ls + 1 > (b.ls <= 3 ? 3 : 2)).map((b) => `${b.f}:${b.ls}-${b.le}`);
  assert.deepEqual(fuori, [], 'blocchi di commento sopra le due righe (tre per l’intestazione)');
});

test('nessuna etichetta che ripete il nome di ciò che sta sotto', () => {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const etichette = [];
  for (const [f, cs] of perFile) for (const c of cs) {
    if (c.trailing || c.rows.length !== 1 || !c.next) continue;
    const m = c.next.match(/^(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/);
    if (m && norm(c.rows[0]) === norm(m[1])) etichette.push(`${f}:${c.ls}`);
  }
  assert.deepEqual(etichette, [], 'etichette uguali al nome sotto');
});
