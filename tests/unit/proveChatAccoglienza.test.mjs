// Sentinella #663.5 e #663.6: una prova che mette un modello e scrive nella chat della home parte già accolta, o la
// home apre l'intervista e il messaggio finisce lì. La fixture apre Filo già accolto; dichiara chi apre Filo da sé o
// chiede il profilo nuovo. Racconto: patterns/accogliere-un-utente-nuovo-e-una-conversazione-e-il-segno.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');

const METTE_MODELLO = /updateSettings\(\s*\{[\s\S]{0,400}?\bapiKeys\b/;
// `#input` c'è solo nella home (src/pages/dashboard/dashboard.html).
const SCRIVE_IN_CHAT = /locator\(\s*['"]#input['"]\s*\)\s*\.\s*(?:fill|press|type|pressSequentially)\s*\(|\.fill\(\s*['"]#input['"]/;
const DICHIARA = /\bfilo_onboarding\b|\bFILO_ONBOARDING\b|\bsetOnboarding\s*\(/;
// Le prove dell'intervista la vogliono aperta.
const SULL_ACCOGLIENZA = /accoglienza|benvenuto|intervista|onboarding/i;
const USA_LA_FIXTURE = /^import\s[^;]*from\s+['"]\.\/fixtures\/electron\.mjs['"]/m;
const PROFILO_NUOVO = /\btest\.use\(\s*\{[^}]*\baccoglienzaFatta\s*:\s*false/g;
const APRE_DA_SE = /\belectron\.launch\s*\(/;
const FIXTURE = join(TESTS, 'fixtures', 'electron.mjs');

/**
 * PURA. Due copie lunghe quanto il testo: `codice` senza commenti né contenuto di stringhe e regex (per contare le
 * graffe), `senzaCommenti` con le stringhe intatte (per cercare). Gli indici restano quelli del testo.
 */
export function maschere(testo) {
  const codice = testo.split('');
  const senzaCommenti = testo.split('');
  const n = testo.length;
  const vuota = (da, a, anche) => {
    for (let k = da; k < a; k++) {
      if (testo[k] === '\n') continue;
      codice[k] = ' ';
      if (anche) senzaCommenti[k] = ' ';
    }
  };
  let prima = '';
  let i = 0;
  while (i < n) {
    const c = testo[i];
    if (c === '/' && testo[i + 1] === '/') {
      const fine = testo.indexOf('\n', i);
      const a = fine < 0 ? n : fine;
      vuota(i, a, true);
      i = a;
    } else if (c === '/' && testo[i + 1] === '*') {
      const fine = testo.indexOf('*/', i + 2);
      const a = fine < 0 ? n : fine + 2;
      vuota(i, a, true);
      i = a;
    } else if (c === '"' || c === "'" || c === '`' || (c === '/' && /^$|[(,=:[!&|?{};>]/.test(prima))) {
      let j = i + 1;
      let classe = false;
      while (j < n && (testo[j] !== c || classe)) {
        if (testo[j] === '\\') j++;
        else if (c === '/' && testo[j] === '[') classe = true;
        else if (c === '/' && testo[j] === ']') classe = false;
        else if (c !== '`' && testo[j] === '\n') break;
        j++;
      }
      vuota(i + 1, Math.min(j, n), false);
      i = j + 1;
      prima = c;
    } else {
      if (!/\s/.test(c)) prima = c;
      i++;
    }
  }
  return { codice: codice.join(''), senzaCommenti: senzaCommenti.join('') };
}

function chiusa(codice, i, apre, chiude) {
  let d = 0;
  for (let j = i; j < codice.length; j++) {
    if (codice[j] === apre) d++;
    else if (codice[j] === chiude && --d === 0) return j;
  }
  return codice.length - 1;
}

/** PURA. I titoli delle prove che mettono un modello e scrivono in chat senza dire com'è l'accoglienza. */
export function proveScoperte(testo, nomeFile = '') {
  if (SULL_ACCOGLIENZA.test(nomeFile)) return [];
  const { codice, senzaCommenti } = maschere(testo);
  // Il corpo che comincia dopo la lista dei parametri aperta in `par`; una freccia senza graffa finisce col suo
  // enunciato.
  const corpoDopo = (par, freccia) => {
    let k = chiusa(codice, par, '(', ')') + 1;
    if (freccia) {
      const f = /^\s*=>\s*/.exec(codice.slice(k));
      if (!f) return '';
      k += f[0].length;
      if (codice[k] !== '{') {
        let d = 0;
        let j = k;
        for (; j < codice.length; j++) {
          const c = codice[j];
          if ('([{'.includes(c)) d++;
          else if (')]}'.includes(c) && --d < 0) break;
          else if (d === 0 && (c === ';' || c === '\n')) break;
        }
        return senzaCommenti.slice(k, j);
      }
    }
    const graffa = codice.indexOf('{', k);
    return graffa < 0 ? '' : senzaCommenti.slice(graffa, chiusa(codice, graffa, '{', '}') + 1);
  };
  const funzioni = new Map();
  for (const m of codice.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) {
    funzioni.set(m[1] || m[2], corpoDopo(m.index + m[0].length - 1, !m[1]));
  }
  // Il corpo della prova più quello delle funzioni del file che chiama, a ogni profondità.
  const raggiunto = (corpo) => {
    const visti = new Set();
    const coda = [corpo];
    let tutto = '';
    while (coda.length) {
      const pezzo = coda.pop();
      tutto += `\n${pezzo}`;
      for (const [nome, b] of funzioni) {
        if (visti.has(nome) || !new RegExp(`(?<![\\w$.])${nome.replace(/\$/g, '\\$')}\\s*\\(`).test(pezzo)) continue;
        visti.add(nome);
        coda.push(b);
      }
    }
    return tutto;
  };
  // Dove vale il profilo nuovo: il gruppo che lo chiede, o tutto il file se lo chiede fuori da ogni gruppo.
  const gruppi = [...codice.matchAll(/\btest\.describe(?:\.\w+)?\(/g)]
    .map((m) => [m.index, chiusa(codice, m.index + m[0].length - 1, '(', ')')]);
  const nuovo = [...codice.matchAll(PROFILO_NUOVO)].map((m) => gruppi
    .filter(([a, b]) => a < m.index && m.index < b)
    .sort((x, y) => (x[1] - x[0]) - (y[1] - y[0]))[0] || [0, testo.length]);
  const fixture = USA_LA_FIXTURE.test(senzaCommenti);
  const scoperte = [];
  for (const m of codice.matchAll(/\btest(?:\.(?:only|skip|fixme|fail))?\(\s*(['"`])/g)) {
    const apre = m.index + m[0].length - 1;
    const chiude = codice.indexOf(m[1], apre + 1);
    const titolo = testo.slice(apre + 1, chiude);
    if (SULL_ACCOGLIENZA.test(titolo)) continue;
    const freccia = codice.slice(chiude).search(/=>\s*\{/);
    if (freccia < 0) continue;
    const graffa = codice.indexOf('{', chiude + freccia);
    const tutto = raggiunto(senzaCommenti.slice(graffa, chiusa(codice, graffa, '{', '}') + 1));
    const accolta = fixture && !APRE_DA_SE.test(tutto) && !nuovo.some(([a, b]) => a < m.index && m.index < b);
    if (!accolta && METTE_MODELLO.test(tutto) && SCRIVE_IN_CHAT.test(tutto) && !DICHIARA.test(tutto)) scoperte.push(titolo);
  }
  return scoperte;
}

// Il profilo accolto non lo semina un aiuto per volta: ogni Filo aperto da una prova eredita FILO_TEST_ACCOLTO dalla
// configurazione, e lo spec che apre Filo con un suo lancio (rete finta, banchi dei giri) parte accolto come la fixture.
test('ogni Filo aperto da una prova parte già accolto, se la prova non chiede il profilo nuovo', () => {
  const ROOT = join(TESTS, '..');
  assert.match(readFileSync(join(ROOT, 'playwright.config.js'), 'utf8'), /^process\.env\.FILO_TEST_ACCOLTO = '1';$/m);
  assert.match(readFileSync(join(ROOT, 'src', 'main', 'shim', 'storage.js'), 'utf8'),
    /if \(buf === null\) \{\n    STATE\.data = \{\};\n(?:\s*\/\/.*\n)*\s*if \(process\.env\.FILO_TEST_ACCOLTO === '1'\) STATE\.data = \{ filo_onboarding: \{ done: true \} \};/);
  const f = readFileSync(FIXTURE, 'utf8');
  assert.match(f, /\baccoglienzaFatta:\s*\[\s*true\s*,\s*\{\s*option:\s*true\s*\}\s*\]/);
  assert.match(f, /FILO_TEST_ACCOLTO: accoglienzaFatta \? '1' : '0'/);
  assert.match(readFileSync(join(TESTS, 'helpers', 'reteFinta.mjs'), 'utf8'), /FILO_TEST_ACCOLTO: accolto \? '1' : '0'/);
});

test('ogni prova che mette un modello e scrive nella chat della home parte già accolta', () => {
  const scoperte = [];
  for (const f of readdirSync(TESTS).filter((n) => n.endsWith('.spec.mjs'))) {
    for (const t of proveScoperte(readFileSync(join(TESTS, f), 'utf8'), f)) scoperte.push(`${f} › ${t}`);
  }
  assert.deepEqual(scoperte, [],
    'Questa prova apre Filo da sé o chiede il profilo nuovo: prima di mettere il modello segna l\'utente come già '
    + 'accolto (SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] })), o usa la fixture così com\'è. '
    + 'Se la prova è sull\'intervista di benvenuto, il titolo lo dica.');
});

test('la sentinella vede la prova scoperta anche dietro funzioni, graffe nelle stringhe e commenti', () => {
  const file = String.raw`
async function configura(app, { chiave = 'k}' } = {}) {
  await app.evaluate(async (_e, k) => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } }); }, chiave);
}
const accolto = async (app) => { await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true })); };
const scrivi = (page) => page.locator('#input').fill('ciao { non chiusa');
test('scoperta', async ({ app, page }) => {
  expect(testo).toMatch(/l'utente {/);
  await configura(app);
  await scrivi(page);
});
test('dichiarata', async ({ app, page }) => { await accolto(app); await configura(app); await scrivi(page); });
test('senza chat', async ({ app }) => { await configura(app); });
test('l\'intervista riparte', async ({ app, page }) => { await configura(app); await scrivi(page); });
test('nel commento non vale', async ({ app, page }) => {
  // accolto(app) e setOnboarding( qui non contano
  await configura(app);
  await scrivi(page);
});
test.skip(` + '`saltata ${1}`' + String.raw`, async ({ app, page }) => { await configura(app); await scrivi(page); });
`;
  assert.deepEqual(proveScoperte(file, 'x.spec.mjs'), ['scoperta', 'nel commento non vale', 'saltata ${1}']);
  assert.deepEqual(proveScoperte(file, 'onboarding-x.spec.mjs'), []);
});

test('con la fixture così com\'è la prova è già accolta; chi apre Filo da sé o chiede il profilo nuovo dichiara', () => {
  // Il lancio è spezzato: scritto per intero, le sentinelle dei lanci leggerebbero questo file come uno che apre Filo.
  const testa = String.raw`import { test, expect } from './fixtures/electron.mjs';
async function configura(app) {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k' } }); });
}
const scrivi = (page) => page.locator('#input').fill('ciao');
const lancia = () => ${'electron.' + 'launch'}({ args: ['.'] });
`;
  const prove = String.raw`
test('con la fixture', async ({ app, page }) => { await configura(app); await scrivi(page); });
test('aperta da sé', async ({ page }) => { const app = await lancia(); await configura(app); await scrivi(page); });
test.describe(() => {
  test.use({ accoglienzaFatta: false });
  test('nel gruppo del profilo nuovo', async ({ app, page }) => { await configura(app); await scrivi(page); });
});
`;
  assert.deepEqual(proveScoperte(testa + prove, 'x.spec.mjs'), ['aperta da sé', 'nel gruppo del profilo nuovo']);
  assert.deepEqual(proveScoperte(`${testa}test.use({ accoglienzaFatta: false });\n${prove}`, 'x.spec.mjs'),
    ['con la fixture', 'aperta da sé', 'nel gruppo del profilo nuovo']);
  assert.deepEqual(proveScoperte(`// test.use({ accoglienzaFatta: false });\n${testa}${prove}`, 'x.spec.mjs'),
    ['aperta da sé', 'nel gruppo del profilo nuovo']);
  assert.deepEqual(proveScoperte(testa.replace('./fixtures/electron.mjs', '@playwright/test') + prove, 'x.spec.mjs'),
    ['con la fixture', 'aperta da sé', 'nel gruppo del profilo nuovo']);
});
