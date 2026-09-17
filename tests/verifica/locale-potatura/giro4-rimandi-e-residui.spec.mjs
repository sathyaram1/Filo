// Verifica locale della potatura dei commenti, quarto giro. Le copie dei giri prima sono
// diventate rimandi: qui si prova che ogni rimando punta a qualcosa che esiste, e si
// misurano i residui che i giri prima non guardavano a macchina (copie nello stesso file,
// commenti vuoti, traduzioni di un letterale in coda, etichette sopra metodi e chiavi).
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
function comments(text) {
  const lines = text.split('\n');
  return commentRanges(text).map(([s, e]) => {
    const ls = lineOf(text, s), le = lineOf(text, e - 1);
    const before = text.slice(text.lastIndexOf('\n', s - 1) + 1, s).trim();
    const rows = text.slice(s, e).split('\n').map(r => r.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, '').replace(/\s*\*\/\s*$/, '').trim());
    let next = '';
    for (let i = le; i < lines.length; i++) { const t = lines[i].trim(); if (t && !/^(\/\/|\/\*|\*)/.test(t)) { next = t; break; } }
    return { ls, le, trailing: before.length > 0, before, rows, next };
  });
}
const letti = new Map();
const testo = (f) => { if (!letti.has(f)) letti.set(f, readFileSync(join(ROOT, f), 'utf8')); return letti.get(f); };

test('ogni rimando a un file, un pattern o una sentinella punta a qualcosa che esiste', () => {
  // Le copie di regola dei giri passati sono diventate rimandi: un rimando nel vuoto lascia
  // la regola in nessun posto, che è peggio della copia.
  // Un percorso preceduto da una barra è di un altro repo (functions/src/…): non si giudica qui.
  const RE = /(?<![\w/])(?:patterns\/[\w-]+\.md|tests\/unit\/[\w.-]+\.mjs|tests\/(?:[\w-]+\/)*[\w.-]+\.spec\.mjs|src\/(?:[\w-]+\/)*[\w.-]+\.(?:js|html|css|mjs|md)|scripts\/[\w.-]+\.(?:mjs|js)|[A-Z][A-Z0-9-]{3,}\.md\b)/g;
  const rotti = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) c.rows.forEach((r, i) => {
      for (const m of r.matchAll(RE)) {
        const p = m[0].replace(/\.$/, '');
        if (!existsSync(join(ROOT, p))) rotti.push(`${f}:${c.ls + i}  ${p}`);
      }
    });
  }
  expect(rotti, 'rimandi a percorsi che non esistono').toEqual([]);
});

test('ogni rimando a una sezione di CLAUDE.md o a un pattern per titolo trova quella sezione', () => {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const titoli = [...md.matchAll(/^##+ (.+)$/gm)].map(m => m[1].trim().toLowerCase());
  const patterns = readFileSync(join(ROOT, 'PATTERNS.md'), 'utf8').toLowerCase();
  const rotti = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) c.rows.forEach((r, i) => {
      for (const m of r.matchAll(/CLAUDE\.md\s*§\s*«?([^»,;:.)]+)/g)) {
        const t = m[1].trim().toLowerCase();
        // «§ Mac» vale per «Filo gira anche su Mac»: basta che il titolo contenga la parola.
        if (!titoli.some(x => x.includes(t) || t.startsWith(x))) rotti.push(`${f}:${c.ls + i}  CLAUDE.md § ${m[1].trim()}`);
      }
      for (const m of r.matchAll(/PATTERNS\.md\s*§?\s*«([^»]+)»/g)) {
        if (!patterns.includes(m[1].trim().toLowerCase())) rotti.push(`${f}:${c.ls + i}  PATTERNS.md «${m[1].trim()}»`);
      }
    });
  }
  expect(rotti, 'rimandi a sezioni che non si trovano').toEqual([]);
});

test('ogni «§n.m» citato in un commento è il titolo di una sezione in un documento del repo', () => {
  // Un numero di sezione senza documento, o di una sezione che nessun .md ha, è un rimando
  // nel vuoto: chi legge non può seguirlo e la regola non sta in nessun posto.
  function mdFiles(dir, acc = []) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) mdFiles(p, acc);
      else if (e.endsWith('.md') || e.endsWith('.txt')) acc.push(p);
    }
    return acc;
  }
  const sezioni = new Set();
  for (const f of mdFiles(ROOT)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/^#+\s*(?:§\s*)?(\d+(?:\.\d+)*[a-z]?)\b/gm)) sezioni.add(m[1]);
  }
  const rotti = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) c.rows.forEach((r, i) => {
      for (const m of r.matchAll(/§\s?(\d+(?:\.\d+)*[a-z]?)\b/g)) {
        if (!sezioni.has(m[1])) rotti.push(`${f}:${c.ls + i}  §${m[1]}`);
      }
    });
  }
  expect(rotti, 'sezioni citate che nessun documento del repo ha').toEqual([]);
});

test('la stessa riga di commento non sta due volte nello stesso file', () => {
  const copie = [];
  for (const f of SRC) {
    const dove = new Map();
    for (const c of comments(testo(f))) c.rows.forEach((r, i) => {
      const k = r.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (k.length < 45) return;
      if (dove.has(k)) copie.push(`${f}:${dove.get(k)} e :${c.ls + i}  «${k.slice(0, 80)}»`); else dove.set(k, c.ls + i);
    });
  }
  expect(copie, 'righe di commento ripetute nello stesso file').toEqual([]);
});

test('nessun commento vuoto né separatore: righe che non dicono niente si pagano comunque', () => {
  const vuoti = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) {
      const pieno = c.rows.some(r => /[\p{L}\p{N}]/u.test(r));
      if (!pieno) vuoti.push(`${f}:${c.ls}`);
    }
  }
  expect(vuoti, 'commenti senza una lettera dentro').toEqual([]);
});

test('nessuna traduzione di un letterale in coda alla riga', () => {
  // «// 24h» dopo 24*60*60*1000 è il cosa: chi legge il numero lo ricostruisce da sé.
  const RE = /^\d+([.,]\d+)?\s*(h|ore?|min(uti)?|s|sec(ondi)?|ms|millisecondi|giorn[oi]|settiman[ae]|mesi|anni|[kmg]b|byte|px|%|caratteri|righe|volte|tentativi)$/i;
  const trovate = [];
  for (const f of SRC) {
    for (const c of comments(testo(f))) {
      if (!c.trailing || c.rows.length !== 1) continue;
      if (RE.test(c.rows[0]) && /\d/.test(c.before)) trovate.push(`${f}:${c.ls}  «${c.rows[0]}» su ${c.before.slice(0, 60)}`);
    }
  }
  expect(trovate, 'commenti in coda che traducono il numero').toEqual([]);
});

test('nessuna etichetta che ripete il nome del metodo, della chiave o della variabile sotto', () => {
  // Il giro 2 guardava function/const/class: qui anche metodi, chiavi di oggetto, assegnazioni.
  const etichette = [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const f of SRC) {
    for (const c of comments(testo(f))) {
      if (c.trailing || c.rows.length !== 1 || !c.next) continue;
      const m = c.next.match(/^(?:export\s+)?(?:async\s+|static\s+|get\s+|set\s+)?(?:function\s+|const\s+|let\s+|var\s+|class\s+)?(?:this\.|[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*(?:[:(=]|\()/);
      if (m && norm(c.rows[0]) && norm(c.rows[0]) === norm(m[1])) etichette.push(`${f}:${c.ls}  «${c.rows[0]}» sopra ${c.next.slice(0, 50)}`);
    }
  }
  expect(etichette, 'etichette uguali al nome sotto').toEqual([]);
});
