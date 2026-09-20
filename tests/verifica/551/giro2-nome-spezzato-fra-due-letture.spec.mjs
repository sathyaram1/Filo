// Verifica #551 — giro 2. La prima cura, la parte che resta scoperta.
//
// Il sintomo della segnalazione è uno solo: «il terminale storpia i nomi dei
// file con trattini lunghi e accenti, e Filo poi non li ritrova». La cura
// chiesta — la shell scrive in UTF-8 — copre la strada per cui il carattere si
// perde DENTRO la shell. Ce n'è una seconda, che non passa dalla shell e vale
// su ogni sistema: l'output di un comando non arriva a Filo tutto in un pezzo.
// Arriva man mano, e ogni pezzo finisce dove capita — anche in mezzo a una
// «à», che in UTF-8 sta su due byte. Se i due pezzi vengono trasformati in
// testo uno per uno, quei due byte non vogliono dire niente né di qua né di
// là, e al loro posto compare un carattere di sostituzione. Il nome torna
// storpiato esattamente come prima.
//
// Succede su ogni comando che scrive un po' alla volta invece che tutto
// insieme: una ricerca ricorsiva in una cartella grande, un elenco lungo, un
// programma che stampa mentre lavora. Qui lo si riproduce in modo
// deterministico (il comando stampa mezza «à», aspetta, stampa l'altra metà),
// perché dal vivo dipende da quando cade la lettura ed è intermittente.
//
// Le prove passano dal canale vero — l'azione ESEGUI_COMANDO, quella che usa
// l'assistente quando cerca un file per l'utente — e dal terminale della
// dashboard, che è la strada gemella.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const NOME = 'RELAZIONE — attività finale.txt';
// I due byte della «à» (0xC3 0xA0) stampati in due momenti diversi: fra l'uno
// e l'altro Filo legge, e si trova in mano mezzo carattere.
const A_META = `printf 'RELAZIONE \\342\\200\\224 attivit\\303'; sleep 0.5; printf '\\240 finale.txt\\n'`;

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('il nome non si rompe se l’output arriva in due pezzi', async ({ app, openTab }) => {
  const page = await openTab(HOME);
  await accendiTerminale(page);

  const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: A_META });
  expect(r.executed, `il comando non è partito: ${JSON.stringify(r).slice(0, 400)}`).toBe(true);
  const stdout = String(r.output?.stdout || '');

  expect(
    stdout.includes('�'),
    `nell’output c’è un carattere di sostituzione: ${JSON.stringify(stdout)}`,
  ).toBe(false);
  expect(stdout).toContain(NOME);
});

test('il nome storpiato non apre più niente col terminale', async ({ app, openTab }) => {
  // Perché conta: il modello prende il nome dall'output e lo rimette nel
  // comando dopo (copia, sposta, apri, leggi col terminale). Se il nome è
  // storpiato quel comando non trova niente, e l'utente si sente rispondere
  // che il suo file non esiste — la lamentela della segnalazione, parola per
  // parola. La tolleranza sul nome vale per il lettore di documenti, non per
  // la shell: qui non salva nessuno.
  const dir = cartellaTemporanea('filo-551-g2-');
  try {
    writeFileSync(join(dir, NOME), 'bilancio chiuso\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const elenco = await execAction(app, {
      type: 'ESEGUI_COMANDO',
      comando: `cd "${dir}"; printf 'RELAZIONE \\342\\200\\224 attivit\\303'; sleep 0.5; printf '\\240 finale.txt\\n'`,
    });
    const nomeLetto = String(elenco.output?.stdout || '')
      .split(/\r?\n/).map((s) => s.trim()).find((s) => s.endsWith('.txt')) || '';

    const riuso = await execAction(app, {
      type: 'ESEGUI_COMANDO',
      comando: `cat "${join(dir, nomeLetto)}"`,
    });
    expect(
      String(riuso.output?.stdout || ''),
      `il nome preso dall’output non riapre il file: ${JSON.stringify(nomeLetto)}`,
    ).toContain('bilancio chiuso');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il terminale della dashboard, sullo stesso comando, non perde niente', async ({ app, openTab }) => {
  // La strada gemella: lo stesso identico comando, digitato dall'utente nel
  // terminale della dashboard invece che emesso dall'assistente. Qui il nome
  // resta intero. Le due strade devono comportarsi allo stesso modo: questa
  // prova è la misura di quanto divergono.
  const page = await openTab(HOME);
  await accendiTerminale(page);

  const out = await page.evaluate((comando) => new Promise((resolve) => {
    let acc = '';
    let chiuso = false;
    const fine = () => { if (!chiuso) { chiuso = true; resolve(acc); } };
    window.filo.shellExec({
      command: comando,
      onData: (d) => { if (d && typeof d.chunk === 'string') acc += d.chunk; },
      onExit: fine,
      onError: fine,
    });
    setTimeout(fine, 15000);
  }), A_META);

  expect(out.includes('�'), `il terminale della dashboard ha perso un carattere: ${JSON.stringify(out)}`).toBe(false);
  expect(out).toContain(NOME);
});
