// Verifica locale della potatura dei commenti, quinto giro. I giri 1-4 hanno misurato
// intestazioni, righe lunghe, cronaca, copie e rimandi: qui si provano gli angoli che
// nessuno aveva guardato a macchina (codice lasciato nei commenti, TODO, firme jsdoc,
// feedback citati senza regola, righe copiate da CLAUDE.md o da un pattern) e si misura
// la porta aperta di HTML e CSS con la stessa regola dei .js.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd());
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');

function files(dir, ext, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, ext, acc);
    else if (ext.some(x => e.endsWith(x))) acc.push(p);
  }
  return acc;
}
const rel = p => relative(ROOT, p).replace(/\\/g, '/');
const SRC = files(join(ROOT, 'src'), ['.js']).map(rel).sort();
const HTML_CSS = files(join(ROOT, 'src'), ['.html', '.css']).map(rel).sort();

// Intervalli dei commenti col lexer di TypeScript, come nei giri prima.
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
// Un commento = un intervallo del lexer; righe consecutive di `//` sono un blocco solo.
function comments(text) {
  const raw = commentRanges(text).map(([s, e]) => ({
    ls: lineOf(text, s), le: lineOf(text, e - 1),
    rows: text.slice(s, e).split('\n').map(r => r.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, '').replace(/\s*\*\/\s*$/, '').trim()),
  }));
  const out = [];
  for (const c of raw) {
    const prev = out.at(-1);
    if (prev && c.ls === prev.le + 1 && text.split('\n')[c.ls - 1].trim().startsWith('//')) { prev.le = c.le; prev.rows.push(...c.rows); }
    else out.push(c);
  }
  return out;
}
const letti = new Map();
const testo = (f) => { if (!letti.has(f)) letti.set(f, readFileSync(join(ROOT, f), 'utf8')); return letti.get(f); };

test('nessuna riga di codice lasciata dentro un commento: il codice spento lo tiene git', () => {
  const code = /^(const |let |var |if \(|for \(|while \(|return |await |console\.|require\(|import |export |[\w.$]+\([^()]*\);\s*$|[\w.$\[\]']+\s*=\s*[^=>].*;\s*$)/;
  const rotti = [];
  for (const f of SRC) for (const c of comments(testo(f))) for (const [i, r] of c.rows.entries()) {
    if (code.test(r) && !/^[A-ZÀ-Ü]/.test(r)) rotti.push(`${f}:${c.ls + i}  ${r}`);
  }
  expect(rotti, 'righe di codice nei commenti:\n' + rotti.join('\n')).toEqual([]);
});

test('nessun TODO, FIXME o HACK: un lavoro da fare è un feedback, non un commento', () => {
  const rotti = [];
  for (const f of SRC) for (const c of comments(testo(f))) for (const [i, r] of c.rows.entries()) {
    if (/\b(TODO|FIXME|XXX|HACK|WIP)\b/.test(r)) rotti.push(`${f}:${c.ls + i}  ${r}`);
  }
  expect(rotti, 'lavori da fare nei commenti:\n' + rotti.join('\n')).toEqual([]);
});

test('nessuna firma riscritta in prosa con i tag jsdoc: la firma la dice il codice', () => {
  const rotti = [];
  for (const f of SRC) for (const c of comments(testo(f))) for (const [i, r] of c.rows.entries()) {
    if (/^@(param|returns?|type|typedef|arg)\b/.test(r)) rotti.push(`${f}:${c.ls + i}  ${r}`);
  }
  expect(rotti, 'tag jsdoc nei commenti:\n' + rotti.join('\n')).toEqual([]);
});

test('un commento che cita un feedback regge da solo: non è mai il solo numero', () => {
  const rotti = [];
  for (const f of SRC) for (const c of comments(testo(f))) {
    const t = c.rows.join(' ');
    if (!/#\d+/.test(t)) continue;
    const parole = t.replace(/#\d+(\.\d+)?/g, '').match(/\p{L}{3,}/gu) || [];
    if (parole.length < 4) rotti.push(`${f}:${c.ls}  ${t}`);
  }
  expect(rotti, 'commenti che sono solo un numero di feedback:\n' + rotti.join('\n')).toEqual([]);
});

test('nessuna riga di commento copiata per intero da CLAUDE.md o da un file di pattern: chi ripete rimanda', () => {
  test.fail(true, 'rilievo di livello 0 del giro 5: due righe identiche a un file di pattern, stessa porta delle copie di regola messa da parte nel giro 4');
  const patDir = join(ROOT, 'patterns');
  const docs = [readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')]
    .concat(existsSync(patDir) ? readdirSync(patDir).map(n => readFileSync(join(patDir, n), 'utf8')) : [])
    .join('\n').replace(/\s+/g, ' ');
  const rotti = [];
  for (const f of SRC) for (const c of comments(testo(f))) for (const [i, r] of c.rows.entries()) {
    const norm = r.replace(/\s+/g, ' ');
    if (norm.length >= 60 && docs.includes(norm)) rotti.push(`${f}:${c.ls + i}  ${r}`);
  }
  expect(rotti, 'righe copiate da CLAUDE.md o da un pattern:\n' + rotti.join('\n')).toEqual([]);
});

test('la stessa regola vale per HTML e CSS sotto src: intestazione di tre righe e blocchi entro le due', () => {
  test.fail(true, 'rilievo del giro 1 che chiede una decisione dell’owner, ancora aperta: i commenti di HTML e CSS sotto src non sono stati toccati');
  const rotti = [];
  for (const f of HTML_CSS) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    const blocchi = [...s.matchAll(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g)];
    if (!blocchi.length) continue;
    const primo = blocchi[0];
    const righeIntestazione = primo.index <= 200 ? primo[0].split('\n').length : 0;
    const lunghi = blocchi.filter(m => m[0].split('\n').length > 2).length;
    if (righeIntestazione > 3 || lunghi > 0) rotti.push(`${f}  intestazione ${righeIntestazione} righe, ${lunghi} blocchi sopra le due righe`);
  }
  expect(rotti, 'file HTML/CSS fuori regola:\n' + rotti.join('\n')).toEqual([]);
});
