// Verifica #551 — giro 7. Il nome del file arriva al modello DIVERSO da com'è
// scritto sul disco, e da quel nome non si torna indietro. È la lamentela della
// segnalazione parola per parola, per una strada che non passa dalla codifica
// della console.
//
// Tutto quello che entra nel prompt venendo da fuori passa da una busta che lo
// ripulisce. Fra le cose che la busta riscrive ci sono i NOMI delle sue
// marcature: una manciata di parole con un trattino basso in mezzo
// (`ricerca_web`, `dati_pagina`, `esito_comando`, `documento_esterno`…). Dove
// compaiono vengono riscritte in minuscolo e col trattino basso cambiato in
// trattino — e la regola non distingue una marcatura da un NOME DI FILE che si
// chiama così.
//
// Il giro è quello della segnalazione: Filo elenca la cartella, il modello
// legge i nomi dall'output, ne ricopia uno e chiede di leggerlo. Solo che il
// nome che ha letto non esiste sul disco, e il perdono sui nomi quasi giusti
// non lo recupera: il trattino basso non è fra le sviste che perdona.
//
// Il quarto giro ha già trovato questa famiglia — i segni di direzione dei nomi
// in arabo, tolti dalla stessa busta — e l'ha chiusa insegnando al confronto fra
// nomi a togliere esattamente quelli. Questa è la stessa porta, per i caratteri
// che la busta non toglie ma SOSTITUISCE.
//
// PORTA APERTA DI PROPOSITO. Il server ha mandato questo rilievo a un feedback
// derivato, che ha una coda sua: in questo giro non si corregge. Le due prove
// che la aprono restano qui, perché sono la memoria del giro, ma sono marchiate
// come «deve fallire»: finché la porta è aperta non fanno rumore, e il giorno in
// cui verrà chiusa diventeranno rosse. Allora si toglie il marchio e restano
// prove normali.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

// L'output di un comando così come lo riceve il modello: imbustato, cioè
// ripulito. È la forma in cui il nome del file gli arriva davvero.
const comeLoLeggeIlModello = (app, testo) =>
  app.evaluate((_electron, t) => globalThis.SN_ESTERNO.imbusta({
    tipo: 'ESITO_COMANDO', testo: t, conIntestazione: false,
  }), testo);

const NOMI = ['ricerca_web.csv', 'Dati_Pagina.txt', 'esito_comando.log'];

test('il nome del file arriva al modello com’è scritto sul disco', async ({ app, openTab }) => {
  test.fail(true, 'porta aperta: il rilievo è in coda come feedback derivato');
  const dir = cartellaTemporanea('filo-551-g7-nomi-');
  try {
    for (const n of NOMI) writeFileSync(join(dir, n), `contenuto di ${n}\n`, 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `ls "${dir}"` });
    expect(r.executed, `il comando non è partito: ${JSON.stringify(r).slice(0, 400)}`).toBe(true);
    const grezzo = String(r.output?.stdout || '');
    for (const n of NOMI) expect(grezzo, `${n}: il terminale non l’ha nemmeno elencato`).toContain(n);

    const imbustato = await comeLoLeggeIlModello(app, grezzo);
    for (const n of NOMI) {
      expect(
        imbustato,
        `il modello legge un nome diverso da quello sul disco: di "${n}" non c’è traccia in `
        + `${JSON.stringify(imbustato.slice(0, 300))}`,
      ).toContain(n);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il file si apre anche col nome che il modello ha letto', async ({ app, openTab }) => {
  test.fail(true, 'porta aperta: il rilievo è in coda come feedback derivato');
  const dir = cartellaTemporanea('filo-551-g7-riapri-');
  try {
    // La terza porta, quella che l'utente sente: dal nome storpiato non si
    // torna indietro. Il perdono sui nomi quasi giusti non copre il trattino
    // basso diventato trattino, quindi la lettura fallisce «in modo onesto» su
    // un file che esiste.
    for (const n of NOMI) writeFileSync(join(dir, n), `contenuto di ${n}\n`, 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `ls "${dir}"` });
    expect(r.executed).toBe(true);
    const imbustato = await comeLoLeggeIlModello(app, String(r.output?.stdout || ''));
    const letti = imbustato.split(/\r?\n/).map((s) => s.trim())
      .filter((s) => /\.(csv|txt|log)$/i.test(s));
    expect(letti.length, 'dall’elenco imbustato non è uscito nessun nome di file').toBeGreaterThan(0);

    for (const nome of letti) {
      const esito = await leggiDocumento(page, join(dir, nome));
      expect(
        esito?.output?.ok,
        `Filo ha stampato "${nome}" e poi non lo ritrova: ${String(esito?.output?.detail || '')}`,
      ).toBe(true);
      expect(String(esito?.output?.text || ''), `"${nome}": aperto il file sbagliato`)
        .toContain('contenuto di');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anche il nome VERO che Filo riferisce al modello resta quello sul disco', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g7-nome-vero-');
  try {
    // Quarta porta: quando il percorso chiesto non esiste e Filo apre lo stesso
    // il file dal nome quasi uguale, lo DICE al modello — «il nome VERO è …» —
    // proprio perché il turno dopo non ricominci col nome che non esiste. Quella
    // riga passa dalla stessa rete, quindi può riscrivere il nome vero mentre lo
    // annuncia.
    const vero = 'ricerca_web.csv';
    writeFileSync(join(dir, vero), 'Data;Causale\n', 'utf8');
    const page = await openTab(HOME);
    // Chiesto con la «à» persa: è la svista che il lettore perdona.
    const esito = await leggiDocumento(page, join(dir, vero));
    expect(esito?.output?.ok, 'il file non si è aperto').toBe(true);
    expect(String(esito?.output?.name || ''), 'il nome riportato non è quello sul disco').toBe(vero);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
