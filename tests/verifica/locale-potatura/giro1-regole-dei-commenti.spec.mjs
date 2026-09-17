// Verifica locale della potatura dei commenti, primo giro. Niente Filo aperto:
// si giudica il testo dei sorgenti sotto src/ contro la regola che il lavoro
// stesso ha scritto in CLAUDE.md, e si prova che il codice non è cambiato.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
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

// Blocchi: commenti a sé (non in coda a codice) su righe consecutive.
function blocks(text) {
  const res = [];
  for (const [s, e] of commentRanges(text)) {
    const ls = lineOf(text, s), le = lineOf(text, e - 1);
    const trailing = text.slice(text.lastIndexOf('\n', s - 1) + 1, s).trim().length > 0;
    const last = res.at(-1);
    if (last && !trailing && !last.trailing && last.le + 1 >= ls) { last.le = le; continue; }
    res.push({ ls, le, trailing });
  }
  return res;
}
const codeLines = (text) => {
  let out = '', pos = 0;
  for (const [s, e] of commentRanges(text)) { out += text.slice(pos, s) + text.slice(s, e).replace(/[^\n]/g, ' '); pos = e; }
  return (out + text.slice(pos)).split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean);
};

test('la regola sui commenti sta in CLAUDE.md con i suoi cinque punti', () => {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const sez = md.split(/^## /m).find(s => /^Commenti nel codice/.test(s));
  expect(sez, 'sezione «Commenti nel codice»').toBeTruthy();
  for (const punto of [/PERCH/i, /una o due righe/i, /un posto solo/i, /tre righe/i, /cronologia/i]) expect(sez).toMatch(punto);
});

test('il codice sotto src/ è identico alla base del ramo: solo commenti', () => {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  let base;
  try { base = git(['merge-base', 'origin/main', 'HEAD']).trim(); } catch { test.skip(true, 'origin/main non raggiungibile'); return; }
  const diversi = [];
  for (const f of SRC) {
    let prima; try { prima = git(['show', `${base}:${f}`]); } catch { continue; }
    const a = codeLines(prima), b = codeLines(readFileSync(join(ROOT, f), 'utf8'));
    if (a.length !== b.length || a.some((l, i) => l !== b[i])) diversi.push(f);
  }
  expect(diversi, 'file con righe di codice cambiate').toEqual([]);
});

test('ogni file sotto src/ ha un’intestazione di tre righe al massimo', () => {
  const lunghe = [];
  for (const f of SRC) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    const head = blocks(text).find(b => !b.trailing && b.ls <= 3);
    const righe = head ? head.le - head.ls + 1 : 0;
    if (righe > 3) lunghe.push(`${f} (${righe} righe)`);
  }
  expect(lunghe, 'intestazioni sopra le tre righe').toEqual([]);
});

test('ogni commento dice il suo perché in una o due righe', () => {
  const lunghi = [];
  for (const f of SRC) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    const n = blocks(text).filter(b => !(b.ls <= 3 && !b.trailing) && b.le - b.ls + 1 > 2).length;
    if (n) lunghi.push(`${f}: ${n}`);
  }
  expect(lunghi, 'file con blocchi di commento sopra le due righe (numero per file)').toEqual([]);
});
