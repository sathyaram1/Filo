// Sentinella: i commenti dentro src/ rispettano la regola di CLAUDE.md § Commenti nel codice
// nelle parti che si misurano a macchina. Copre HTML e CSS, compresi gli script e gli stili
// incorporati nelle pagine; per i .js basta aggiungere l'estensione a ESTENSIONI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// La prova di questa sentinella (tests/unit/sentinellaCommenti.test.mjs) le fa
// guardare un albero finto: senza, le quattro misure non si possono provare.
const GUARDA = process.env.FILO_COMMENTI_ROOT ? resolve(process.env.FILO_COMMENTI_ROOT) : join(ROOT, 'src');
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');

const ESTENSIONI = ['.html', '.css'];

function sorgenti(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sorgenti(p, acc);
    else if (ESTENSIONI.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}
const SRC = sorgenti(GUARDA).map((p) => relative(ROOT, p).replace(/\\/g, '/')).sort();

// I commenti /* */ contano solo fuori dalle stringhe: dentro un content: '/*' non c'è nulla.
function cssComments(text, offset = 0) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q || text[i] === '\n') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const s = i;
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(i + 2, text.length);
      out.push([s + offset, i + offset]);
      continue;
    }
    i++;
  }
  return out;
}

// Il lexer di TypeScript distingue i commenti da template e regex, dove una regex ingenua sbaglia.
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
function jsComments(text, offset = 0) {
  const K = ts.SyntaxKind;
  const sc = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, text);
  const out = [], stack = [];
  let prevKind = null, prevText = '';
  for (;;) {
    let kind = sc.scan();
    if (kind === K.EndOfFileToken) break;
    if (kind === K.SingleLineCommentTrivia || kind === K.MultiLineCommentTrivia) {
      out.push([sc.getTokenStart() + offset, sc.getTextPos() + offset]);
      continue;
    }
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

// script e style sono elementi a testo grezzo: dentro non c'è markup, e i loro
// commenti vanno letti con la sintassi del linguaggio che ospitano.
function scriptDiJs(attrs) {
  if (/\bsrc\s*=/.test(attrs)) return false;
  const m = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return true;
  const t = (m[2] ?? m[3] ?? m[4] ?? '').trim().toLowerCase();
  return t === '' || t === 'module' || /javascript|ecmascript/.test(t);
}

function htmlComments(text) {
  const out = [], salta = [];
  const raw = /<(script|style)\b([^>]*)>/gi;
  let m;
  while ((m = raw.exec(text))) {
    const tag = m[1].toLowerCase();
    const inizio = m.index + m[0].length;
    const chiusura = text.toLowerCase().indexOf(`</${tag}`, inizio);
    const fine = chiusura === -1 ? text.length : chiusura;
    salta.push([inizio, fine]);
    const body = text.slice(inizio, fine);
    if (tag === 'style') out.push(...cssComments(body, inizio));
    else if (scriptDiJs(m[2])) out.push(...jsComments(body, inizio));
    raw.lastIndex = fine;
  }
  let i = 0;
  while (i < text.length) {
    const s = text.indexOf('<!--', i);
    if (s === -1) break;
    if (salta.some(([a, b]) => s >= a && s < b)) { i = s + 4; continue; }
    const e = text.indexOf('-->', s + 4);
    const fine = e === -1 ? text.length : e + 3;
    out.push([s, fine]);
    i = fine;
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function ranges(file, text) {
  if (file.endsWith('.css')) return cssComments(text);
  if (file.endsWith('.html')) return htmlComments(text);
  return jsComments(text);
}

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;
const NUDA = /^\s*(<!--|-->|\/\/|\/\*+|\*+\/?)\s?/;

function comments(file, text) {
  const lines = text.split('\n');
  return ranges(file, text).map(([s, e]) => {
    const ls = lineOf(text, s), le = lineOf(text, e - 1);
    const trailing = text.slice(text.lastIndexOf('\n', s - 1) + 1, s).trim().length > 0;
    const rows = text.slice(s, e).split('\n')
      .map((r) => r.replace(NUDA, '').replace(/\s*(\*\/|-->)\s*$/, '').trim());
    let next = '';
    for (let i = le; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && !/^(<!--|\/\/|\/\*|\*|-->)/.test(t)) { next = t; break; }
    }
    return { ls, le, trailing, rows, next };
  });
}

const perFile = new Map(SRC.map((f) => {
  const text = readFileSync(join(ROOT, f), 'utf8');
  return [f, { commenti: comments(f, text), righe: text.split('\n') }];
}));

const vuota = (r) => r.trim() === '';

test('nessuna data di calendario nei commenti: la cronologia la tiene git', () => {
  const RE = /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\/\d{1,2}\/20\d\d\b/;
  const date = [];
  for (const [f, { commenti }] of perFile) for (const c of commenti) c.rows.forEach((r, i) => { if (RE.test(r)) date.push(`${f}:${c.ls + i}`); });
  assert.deepEqual(date, [], 'commenti con una data dentro');
});

test('una riga di commento resta una riga: al massimo 120 caratteri di testo', () => {
  const lunghe = [];
  for (const [f, { commenti }] of perFile) for (const c of commenti) c.rows.forEach((r, i) => { if (r.length > 120) lunghe.push(`${f}:${c.ls + i} (${r.length})`); });
  assert.deepEqual(lunghe, [], 'righe di commento oltre i 120 caratteri');
});

// Quel che si misura è il muro che il lettore attraversa prima del codice: righe vuote e commenti separati in mezzo
// non lo spezzano, l'intestazione è quella vera (il primo commento del file) e uno attaccato in coda conta da solo.
test('un commento a sé non supera le due righe, salvo l’intestazione del file', () => {
  const blocchi = [];
  for (const [f, { commenti, righe }] of perFile) {
    let blocco = null;
    for (const c of commenti) {
      if (c.trailing) { blocchi.push({ f, ls: c.ls, le: c.le, conta: c.rows.length, testa: false }); blocco = null; continue; }
      if (blocco && righe.slice(blocco.le, c.ls - 1).every(vuota)) {
        blocco.le = c.le;
        blocco.conta += c.rows.length;
        continue;
      }
      blocco = { f, ls: c.ls, le: c.le, conta: c.rows.length, testa: righe.slice(0, c.ls - 1).every(vuota) };
      blocchi.push(blocco);
    }
  }
  const fuori = blocchi.filter((b) => b.conta > (b.testa ? 3 : 2)).map((b) => `${b.f}:${b.ls}-${b.le} (${b.conta} righe)`);
  assert.deepEqual(fuori, [], 'blocchi di commento sopra le due righe (tre per l’intestazione)');
});

// L'etichetta che ripete il selettore o il tag sotto non aggiunge niente a chi legge il file.
test('nessuna etichetta che ripete il nome di ciò che sta sotto', () => {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const etichette = [];
  for (const [f, { commenti }] of perFile) for (const c of commenti) {
    if (c.trailing || c.rows.length !== 1 || !c.next) continue;
    const nomi = [];
    const sel = c.next.match(/^([.#]?[A-Za-z_][\w-]*)/);
    if (sel) nomi.push(sel[1].replace(/^[.#]/, ''));
    const tag = c.next.match(/^<([A-Za-z][\w-]*)/);
    if (tag) nomi.push(tag[1]);
    for (const attr of ['id', 'class']) {
      const a = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`).exec(c.next);
      if (a) nomi.push(...a[1].trim().split(/\s+/));
    }
    if (nomi.some((n) => n && norm(c.rows[0]) === norm(n))) etichette.push(`${f}:${c.ls}`);
  }
  assert.deepEqual(etichette, [], 'etichette uguali al nome sotto');
});
