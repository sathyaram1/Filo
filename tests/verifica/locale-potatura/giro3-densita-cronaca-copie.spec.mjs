// Verifica locale della potatura dei commenti, terzo giro. Misure a macchina delle porte
// aperte nei giri prima: quanto pesa ancora il commento su src, le locuzioni di cronaca,
// la stessa riga di commento ricopiata in due file, e i file generati dal loro generatore.
// POTATURA_ROOT punta a un altro albero (l'export della base del ramo) per vedere il rosso.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';

const CWD = resolve(process.cwd());
const ROOT = resolve(process.env.POTATURA_ROOT || CWD);
const require = createRequire(join(CWD, 'package.json'));
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

// Intervalli dei commenti col lexer di TypeScript, come nel giro 2 (template e regex compresi).
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
  return commentRanges(text).map(([s, e]) => ({
    ls: lineOf(text, s), chars: e - s,
    rows: text.slice(s, e).split('\n').map(r => r.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, '').replace(/\s*\*\/\s*$/, '').trim()),
  }));
}
const letti = new Map();
const testo = (f) => { if (!letti.has(f)) letti.set(f, readFileSync(join(ROOT, f), 'utf8')); return letti.get(f); };

test('il commento pesa al massimo un quinto di src: era un terzo nella base del ramo', () => {
  let tot = 0, comm = 0;
  for (const f of SRC) { const t = testo(f); tot += t.length; for (const c of comments(t)) comm += c.chars; }
  const quota = Math.round(100 * comm / tot);
  expect(quota, `caratteri di commento su src: ${quota}%`).toBeLessThanOrEqual(20);
});

test('niente locuzioni di cronaca nei commenti: com’era prima lo tiene git', () => {
  const RE = /\b(prima era|era così|spostat[oa] (da|qui da)|in passato|un tempo|inizialmente|originariamente|era il difetto|abbiamo provato|le due risposte provate|fino a ieri|prima del fix|prima di questo fix|dopo il fix|legacy:)\b/i;
  const trovate = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) c.rows.forEach((r, i) => { if (RE.test(r)) trovate.push(`${f}:${c.ls + i}  ${r.slice(0, 110)}`); });
  }
  expect(trovate, 'commenti che raccontano com’era prima').toEqual([]);
});

test('la stessa riga di commento non sta in due file: chi la ripete rimanda, non copia', () => {
  const dove = new Map();
  for (const f of SRC) {
    if (/\/transparency(Ui)?\.js$/.test(f)) continue; // generati: l’intestazione è del generatore
    for (const c of comments(testo(f))) for (const r of c.rows) {
      const k = r.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (k.length < 45) continue;
      const set = dove.get(k) || new Set(); set.add(f); dove.set(k, set);
    }
  }
  const copie = [...dove.entries()].filter(([, s]) => s.size > 1).map(([k, s]) => `${[...s].join(' + ')}  «${k.slice(0, 90)}»`);
  expect(copie, 'righe di commento identiche in due file').toEqual([]);
});

test('i file generati dalla trasparenza concordano col loro generatore', () => {
  // Due moduli di src e la pagina del sito nascono da uno script: potarli a mano senza
  // toccare lo script li farebbe riscrivere diversi al prossimo `npm run` che li rigenera.
  let esito = 0;
  try { execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-transparency.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' }); }
  catch (e) { esito = e.status ?? 1; }
  expect(esito, 'build-transparency --check').toBe(0);
});
