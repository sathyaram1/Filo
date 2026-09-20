// Verifica #551 — giro 3. La lamentela della segnalazione, per una strada che
// non passa dalla codifica: «Filo lo cerca col terminale… poi chiede di leggere
// il primo e il lettore risponde che a quel percorso non c'è nessun file».
//
// La cartella di lavoro del terminale PERSISTE fra un comando e l'altro, ed è
// scritto nelle istruzioni che Filo riceve. La lettura di un documento, invece,
// quella cartella non la guarda: un nome senza percorso viene cercato nella
// cartella del programma Filo, che con la richiesta dell'utente non c'entra
// niente. Due conseguenze, tutte e due qui sotto:
//   1) il file che Filo ha appena elencato non si apre;
//   2) peggio: adesso che un nome quasi giusto viene perdonato, quel nome può
//      combaciare con un file della cartella di Filo, e il suo contenuto entra
//      nella risposta come se fosse il documento dell'utente.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const eseguiComando = (page, comando) =>
  page.evaluate((c) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'filo_confirm_action',
      action: { type: 'ESEGUI_COMANDO', comando: c },
    }, (r) => resolve(r));
  }), comando);

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('il file appena elencato si apre col nome che il terminale ha stampato', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-cwd-');
  try {
    writeFileSync(join(base, 'Relazione — attività.txt'), 'giacenza media 1.234 euro\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Il giro che fa Filo dal vivo: entra nella cartella dell'utente ed elenca.
    const cd = await eseguiComando(page, `cd '${base}'`);
    expect(cd.executed, `il cd non è partito: ${JSON.stringify(cd).slice(0, 300)}`).toBe(true);
    const ls = await eseguiComando(page, 'ls');
    const nome = String(ls.output?.stdout || '').trim().split('\n').pop().trim();
    expect(nome, 'il terminale non ha stampato il nome del file').toBe('Relazione — attività.txt');

    // Quel nome è tutto ciò che l'elenco ha dato: la cartella dov'è, Filo ce
    // l'ha già, ed è quella in cui si trova adesso.
    const r = await leggiDocumento(page, nome);
    expect(
      r?.output?.ok,
      `il file elencato un attimo fa non si apre: ${JSON.stringify(r?.output?.detail || '')}`,
    ).toBe(true);
    expect(String(r?.output?.text || '')).toContain('giacenza media');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un nome senza cartella non può pescare un file del programma Filo', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-cwd2-');
  try {
    writeFileSync(join(base, 'appunti.txt'), 'appunti dell utente\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);
    const cd = await eseguiComando(page, `cd '${base}'`);
    expect(cd.executed).toBe(true);

    // Un nome con un carattere perso, come quelli che il terminale di Windows
    // consegnava. Nella cartella dell'utente non c'è niente che gli somigli:
    // l'unica cosa che ci somiglia sta nella cartella del programma.
    const r = await leggiDocumento(page, 'package.jso�');
    const aperto = String(r?.output?.path || r?.output?.name || '');
    expect(
      r?.output?.ok === true && !aperto.startsWith(base),
      `Filo ha aperto un file che non sta dove l'utente sta guardando: ${JSON.stringify(aperto)}`,
    ).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
