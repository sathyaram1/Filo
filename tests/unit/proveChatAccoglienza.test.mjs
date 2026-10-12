// Sentinella #663.5: una prova che mette un modello e poi scrive nella chat della home dice com'è l'accoglienza.
// Senza, la home apre l'intervista di benvenuto (subito, o quando arriva l'avviso di prontezza) e il messaggio
// finisce lì: la prova verifica l'intervista invece della chat, e passa o no secondo i tempi.

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

/** PURA. Il blocco che parte dalla graffa in `i`, saltando stringhe e commenti. */
export function blocco(testo, i) {
  let d = 0;
  for (let j = i; j < testo.length; j++) {
    const c = testo[j];
    if (c === '"' || c === "'" || c === '`') {
      for (j++; j < testo.length && testo[j] !== c; j++) if (testo[j] === '\\') j++;
    } else if (c === '/' && testo[j + 1] === '/') {
      while (j < testo.length && testo[j] !== '\n') j++;
    } else if (c === '/' && testo[j + 1] === '*') {
      j = testo.indexOf('*/', j + 2);
      if (j < 0) return testo.slice(i);
      j++;
    } else if (c === '{') d++;
    else if (c === '}' && --d === 0) return testo.slice(i, j + 1);
  }
  return testo.slice(i);
}

/** PURA. I titoli delle prove che mettono un modello e scrivono in chat senza dire com'è l'accoglienza. */
export function proveScoperte(testo, nomeFile = '') {
  if (SULL_ACCOGLIENZA.test(nomeFile)) return [];
  const funzioni = new Map();
  for (const m of testo.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*)[^{]*?\{/g)) {
    funzioni.set(m[1] || m[2], blocco(testo, m.index + m[0].length - 1));
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
  const scoperte = [];
  for (const m of testo.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,[^{]*?\{/g)) {
    const titolo = m[2];
    if (SULL_ACCOGLIENZA.test(titolo)) continue;
    const tutto = raggiunto(blocco(testo, m.index + m[0].length - 1));
    if (METTE_MODELLO.test(tutto) && SCRIVE_IN_CHAT.test(tutto) && !DICHIARA.test(tutto)) scoperte.push(titolo);
  }
  return scoperte;
}

test('ogni prova che mette un modello e scrive nella chat della home dice com\'è l\'accoglienza', () => {
  const scoperte = [];
  for (const f of readdirSync(TESTS).filter((n) => n.endsWith('.spec.mjs'))) {
    for (const t of proveScoperte(readFileSync(join(TESTS, f), 'utf8'), f)) scoperte.push(`${f} › ${t}`);
  }
  assert.deepEqual(scoperte, [],
    'Prima di mettere il modello, segna l\'utente come già accolto: '
    + 'SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }). '
    + 'Se la prova è sull\'intervista di benvenuto, il titolo lo dica.');
});

test('la sentinella riconosce la prova scoperta e quella che dichiara, anche dentro le funzioni che chiama', () => {
  const configura = `async function configura(app) {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k' } }); });
}`;
  const dichiara = `const accolto = async (app) => { await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true })); };`;
  const prova = (titolo, corpo) => `test('${titolo}', async ({ app }) => {\n${corpo}\n});`;
  const scrivi = `  await page.locator('#input').fill('ciao { non chiusa');`;
  const file = [
    configura, dichiara,
    prova('scoperta', `  await configura(app);\n${scrivi}`),
    prova('dichiarata', `  await accolto(app);\n  await configura(app);\n${scrivi}`),
    prova('senza chat', '  await configura(app);'),
    prova('l\\\'intervista riparte', `  await configura(app);\n${scrivi}`),
    prova('commento', `  // setOnboarding( in un commento non vale\n  await configura(app);\n${scrivi}`),
  ].join('\n');
  assert.deepEqual(proveScoperte(file, 'x.spec.mjs'), ['scoperta', 'commento']);
  assert.deepEqual(proveScoperte(file, 'onboarding-x.spec.mjs'), []);
});
