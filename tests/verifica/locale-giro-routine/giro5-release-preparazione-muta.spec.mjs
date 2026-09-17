// Prove del giro 5 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 1, letto e non eseguito (il lavoro di GitHub non gira da qui): nel
// lavoro della suite, i passi PRIMA della suite — l'installazione delle
// dipendenze, il binario di Electron, lo schermo virtuale — non hanno un
// paracadute. Se uno di loro è rosso il lavoro si ferma lì: la suite non
// parte, il verdetto non gira, l'allarme non parte (il suo `if` guarda solo
// l'esito del verdetto), la versione non esce, e nessun feedback lo dice. È
// la «pubblicazione che si ferma in silenzio» che il punto 1 voleva chiudere
// per i rossi della suite, riaperta per i rossi della sua preparazione. Con
// un `npm ci` rotto su main (un lockfile fuori sincrono) si vede la prima
// volta che qualcuno si chiede perché non arrivano più aggiornamenti.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** I passi del job `suite`, nell'ordine: { name, righe } (righe = il blocco YAML del passo, grezzo). */
function passiDellaSuite() {
  // Sulla macchina di chi sviluppa il file può stare con i ritorni a capo di Windows.
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const daSuite = yml.slice(yml.indexOf('\n  suite:\n'));
  const soloSuite = daSuite.slice(0, daSuite.indexOf('\n  release:\n'));
  const blocchi = soloSuite.split(/\n(?=      - name: )/).slice(1);
  return blocchi.map((b) => ({ name: b.match(/- name: (.*)/)[1].trim(), righe: b }));
}

test.describe('lavoro di release — la preparazione della suite (letto, non eseguito)', () => {
  test('un rosso nei passi prima della suite (npm ci, Electron, xvfb) arriva all\'allarme come un rosso della suite', async () => {
    const passi = passiDellaSuite();
    const nomi = passi.map((p) => p.name);
    const preparazione = passi.filter((p) => /Install dipendenze|Binario di Electron|Schermo virtuale/.test(p.name));
    expect(preparazione.length).toBe(3);
    const allarme = passi.find((p) => /Rosso nuovo/.test(p.name));
    expect(allarme, `passi trovati: ${nomi.join(' | ')}`).toBeTruthy();
    const ifAllarme = (allarme.righe.match(/\n\s+if: (.*)/) || [])[1] || '';
    // O l'allarme scatta anche quando un passo prima è rosso (failure()), oppure
    // ogni passo di preparazione prosegue col rosso e lo si vede dal verdetto.
    const allarmeCopreTutto = /failure\(\)|always\(\)/.test(ifAllarme);
    const preparazioneProsegue = preparazione.every((p) => /continue-on-error: true/.test(p.righe));
    expect(allarmeCopreTutto || preparazioneProsegue).toBe(true);
  });
});
