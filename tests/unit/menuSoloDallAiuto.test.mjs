// Sentinella (#1052): le prove trovano il menu del tasto destro solo da tests/helpers/menuContestuale.mjs, l'unico punto
// che sa dove è disegnato. Un selettore del menu (`sn-menu…`, `data-sn-icon-id`, le classi che solo il menu assegna) cercato
// sulla pagina è rosso; lo script di un sito finto che cerca il menu da sé porta `menu-dal-sito` in un commento vicino.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TESTS = join(ROOT, 'tests');
const AIUTO = 'menuContestuale.mjs';
// Oltre a `sn-menu…`, ogni classe che solo il menu assegna (la voce con l'icona…): un pezzo nuovo del menu entra da
// sé. Una classe assegnata anche altrove (sn-disabled) è uno stato condiviso, non il menu.
const SORGENTI_MENU = ['src/content/menu.js'];
const ASSEGNATE = /(?:className\s*=\s*|classList\.(?:add|toggle)\(\s*|class=\\?)(['"`])([^'"`\\]*)/g;
function classiAssegnate(testo) {
  const out = new Set();
  for (const m of testo.matchAll(ASSEGNATE)) for (const c of m[2].split(/\s+/)) if (/^sn-[\w-]+$/.test(c)) out.add(c);
  return out;
}
function classiDelMenu() {
  const delMenu = new Set();
  for (const f of SORGENTI_MENU) for (const c of classiAssegnate(readFileSync(join(ROOT, f), 'utf8'))) delMenu.add(c);
  const altrove = new Set();
  (function giro(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) giro(p);
      else if (/\.(m?js|html)$/.test(nome) && !SORGENTI_MENU.includes(relative(ROOT, p).split(sep).join('/'))) {
        for (const c of classiAssegnate(readFileSync(p, 'utf8'))) altrove.add(c);
      }
    }
  })(join(ROOT, 'src'));
  return [...delMenu].filter((c) => !c.startsWith('sn-menu') && !altrove.has(c)).sort();
}
const CLASSI_DEL_MENU = classiDelMenu();
const TRACCIA = new RegExp(['sn-menu', 'data-sn-icon-id', ...CLASSI_DEL_MENU.map((c) => `(?<![\\w-])${c}(?![\\w-])`)].join('|'));
const MARCATORE = 'menu-dal-sito';
// I metodi con cui una prova cerca nel documento: decide chi li riceve. Le asserzioni sulla classe di un elemento già
// trovato non cercano niente.
const CERCATORI = new Set(['locator', '$', '$$', '$eval', '$$eval', 'waitForSelector', 'evaluate', 'evaluateHandle',
  'evaluateAll', 'frameLocator', 'addInitScript', 'addScriptTag', 'setContent', 'executeJavaScript',
  'executeJavaScriptInIsolatedWorld', 'isVisible', 'click', 'hover', 'fill', 'textContent', 'innerText', 'count']);
const NEUTRE = new Set(['toHaveClass', 'toContainClass']);

function sorgenti(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (p === join(TESTS, 'unit') || p === join(TESTS, 'verifica')) continue;
      sorgenti(p, out);
    } else if (/\.(m?js|cjs)$/.test(nome) && nome !== AIUTO) out.push(p);
  }
  return out;
}

const funzione = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)
  || ts.isMethodDeclaration(n);
const chiamataDiProva = (n) => ts.isCallExpression(n) && /^(test|describe)\b/.test(n.expression.getText());

export function cercheFuoriDallAiuto(testo, nomeFile = 'x.spec.mjs') {
  const sf = ts.createSourceFile(nomeFile, testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const righe = testo.split('\n');
  const aiuto = new Set();
  const derivati = new Set();
  const locali = new Map();
  const dichiarazioni = [];
  const identificatori = [];
  const letterali = [];

  (function visita(n) {
    if (ts.isImportDeclaration(n) && String(n.moduleSpecifier.text || '').endsWith(AIUTO)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamespaceImport(b)) aiuto.add(b.name.text);
      if (b && ts.isNamedImports(b)) for (const el of b.elements) aiuto.add(el.name.text);
    }
    if (ts.isFunctionDeclaration(n) && n.name) locali.set(n.name.text, n);
    if (ts.isVariableDeclaration(n)) {
      dichiarazioni.push(n);
      if (ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
        locali.set(n.name.text, n.initializer);
      }
    }
    if (ts.isIdentifier(n)) identificatori.push(n);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && TRACCIA.test(n.text)) letterali.push(n);
    if (ts.isTemplateExpression(n) && TRACCIA.test(n.head.text + n.templateSpans.map((s) => s.literal.text).join(''))) letterali.push(n);
    ts.forEachChild(n, visita);
  })(sf);

  const nomi = (b, out = []) => {
    if (ts.isIdentifier(b)) out.push(b.text);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) for (const el of b.elements) if (el.name) nomi(el.name, out);
    return out;
  };
  function daMenu(e) {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e))) e = e.expression;
    if (!e) return false;
    if (ts.isIdentifier(e)) return derivati.has(e.text) || aiuto.has(e.text);
    if (ts.isCallExpression(e)) {
      const c = e.expression;
      if (ts.isIdentifier(c) && aiuto.has(c.text)) return true;
      if (ts.isIdentifier(c) && locali.has(c.text)) return restituisceIlMenu(locali.get(c.text));
      return daMenu(c);
    }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return daMenu(e.expression);
    return false;
  }
  // Una funzione dello spec che apre il menu e ne restituisce un pezzo vale quanto l'aiuto.
  const inEsame = new Set();
  function restituisceIlMenu(fn) {
    if (inEsame.has(fn) || !fn.body) return false;
    inEsame.add(fn);
    try {
      if (!ts.isBlock(fn.body)) return daMenu(fn.body);
      const ritorni = [];
      (function cerca(n) {
        if (n !== fn.body && funzione(n)) return;
        if (ts.isReturnStatement(n)) ritorni.push(n.expression);
        ts.forEachChild(n, cerca);
      })(fn.body);
      return ritorni.length > 0 && ritorni.every((r) => r && daMenu(r));
    } finally { inEsame.delete(fn); }
  }
  for (let cambiato = true; cambiato;) {
    cambiato = false;
    for (const d of dichiarazioni) {
      if (!d.initializer || !daMenu(d.initializer)) continue;
      for (const nome of nomi(d.name)) if (!derivati.has(nome)) { derivati.add(nome); cambiato = true; }
    }
  }

  function marcato(n) {
    if (ts.isSourceFile(n) || ts.isBlock(n) || funzione(n) || chiamataDiProva(n)) return false;
    if (ts.isExpressionStatement(n) && chiamataDiProva(n.expression)) return false;
    const riga = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    return righe[riga].includes(MARCATORE) || (riga > 0 && righe[riga - 1].includes(MARCATORE));
  }
  const riferimenti = (nome, dentro, esclusa) => identificatori.filter((id) => id.text === nome && id !== esclusa
    && id.pos >= dentro.pos && id.end <= dentro.end
    && !(ts.isPropertyAccessExpression(id.parent) && id.parent.name === id)
    && !(ts.isPropertyAssignment(id.parent) && id.parent.name === id));

  function parametroAmmesso(fn, i, visti) {
    const chiave = `${fn.pos}:${i}`;
    if (visti.has(chiave)) return true;
    visti.add(chiave);
    const p = fn.parameters[i];
    if (!p || !ts.isIdentifier(p.name) || p.dotDotDotToken || !fn.body) return false;
    return riferimenti(p.name.text, fn.body, p.name).every((r) => usoAmmesso(r, visti));
  }

  function usoAmmesso(nodo, visti = new Set()) {
    if (marcato(nodo)) return true;
    let figlio = nodo;
    for (let p = nodo.parent; p; figlio = p, p = p.parent) {
      if (marcato(p)) return true;
      if (ts.isCallExpression(p) && p.arguments.includes(figlio)) {
        const c = p.expression;
        if (ts.isPropertyAccessExpression(c) && (NEUTRE.has(c.name.text) || daMenu(c.expression))) return true;
        if (ts.isPropertyAccessExpression(c) && CERCATORI.has(c.name.text)) return daMenu(c.expression);
        if (ts.isIdentifier(c) && aiuto.has(c.text)) return true;
        if (ts.isIdentifier(c) && locali.has(c.text)) return parametroAmmesso(locali.get(c.text), p.arguments.indexOf(figlio), visti);
      }
      if (ts.isVariableDeclaration(p) && p.initializer === figlio && ts.isIdentifier(p.name)) {
        if (visti.has(p)) return true;
        visti.add(p);
        const ambito = p.parent?.parent?.parent || sf;
        const usi = riferimenti(p.name.text, ambito, p.name);
        return usi.length > 0 && usi.every((r) => usoAmmesso(r, visti));
      }
    }
    return false;
  }

  return letterali.filter((l) => !usoAmmesso(l)).map((l) => {
    const riga = sf.getLineAndCharacterOfPosition(l.getStart(sf)).line;
    return { riga: riga + 1, testo: righe[riga].trim().slice(0, 140) };
  });
}

test('le prove cercano il menu del tasto destro solo dall\'aiuto (tests/helpers/menuContestuale.mjs)', () => {
  const fuori = [];
  for (const file of sorgenti(TESTS)) {
    const testo = readFileSync(file, 'utf8');
    if (!TRACCIA.test(testo)) continue;
    for (const c of cercheFuoriDallAiuto(testo, file)) fuori.push(`${relative(ROOT, file).split(sep).join('/')}:${c.riga}  ${c.testo}`);
  }
  assert.deepEqual(fuori, [], 'Il menu si cerca con menuDi(scheda) da tests/helpers/menuContestuale.mjs: è l\'unico punto '
    + 'che sa dove è disegnato. Se è lo script del sito finto a cercarlo, un commento con «menu-dal-sito» sulla riga o su '
    + 'quella prima.\n' + fuori.join('\n'));
});

test('la sentinella riconosce chi cerca il menu senza l\'aiuto', () => {
  const imp = "import { menuDi } from './helpers/menuContestuale.mjs';\n";
  const casi = [
    ["await page.locator('.sn-menu-item').click();", 1],
    ["await expect(page.locator('[data-sn-icon-id=\"copy\"]')).toBeVisible();", 1],
    ["const n = await page.evaluate(() => document.querySelectorAll('.sn-menu').length);", 1],
    ["const SEL = '.sn-menu-paste-main';\nawait page.locator(SEL).click();", 1],
    ["const menu = page.locator('.sn-menu');\nawait menu.locator('.sn-menu-item').first().click();", 2],
    [`${imp}await menuDi(page).locator('.sn-menu-item').click();`, 0],
    [`${imp}const menu = menuDi(page);\nconst g = menu.locator('.sn-menu-sub');\nawait g.locator('.sn-menu-item').click();`, 0],
    [`${imp}await menuDi(page).valuta(() => document.querySelector('.sn-menu').scrollTop);`, 0],
    [`${imp}const SEL = '.sn-menu-paste-main';\nawait menuDi(page).locator(SEL).click();`, 0],
    [`${imp}const voce = (p, sel) => menuDi(p).locator(sel);\nawait voce(page, '.sn-menu-item').click();`, 0],
    [`${imp}const voce = (p, sel) => p.locator(sel);\nawait voce(page, '.sn-menu-item').click();`, 1],
    ["// menu-dal-sito: lo script della pagina prova a premere Incolla\nawait page.evaluate(() => document.querySelector('.sn-menu-paste-main')?.click());", 0],
    ["await expect(riga).toHaveClass('sn-menu-item');", 0],
    ["await expect(page.locator('.sn-has-icon')).toHaveCount(1);", 1],
    [`${imp}await expect(menuDi(page).locator('.sn-has-icon')).toHaveCount(1);`, 0],
    ["await expect(pop.locator('.sn-select-option')).toHaveClass(/sn-disabled/);", 0],
    // #1452.1: la prova del pannello red team cercava «Invia attacco» sulla pagina, ed era rossa anche su main.
    ["const voce = page.locator('.sn-menu .sn-menu-item', { hasText: 'Invia attacco' }).first();\nawait expect.poll(async () => voce.isVisible()).toBe(true);\nawait voce.click();", 1],
    [`${imp}const voce = menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Invia attacco' }).first();\nawait expect.poll(async () => voce.isVisible()).toBe(true);\nawait voce.click();`, 0],
  ];
  for (const [codice, attese] of casi) assert.equal(cercheFuoriDallAiuto(codice).length, attese, codice);
});

test('le classi che solo il menu assegna, anche fuori da «sn-menu…», contano come menu', () => {
  assert.ok(CLASSI_DEL_MENU.includes('sn-has-icon'), 'sn-has-icon');
  assert.ok(!CLASSI_DEL_MENU.includes('sn-disabled'), 'sn-disabled la assegnano anche altri riquadri');
});
