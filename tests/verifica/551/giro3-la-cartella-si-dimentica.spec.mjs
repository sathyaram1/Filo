// Verifica #551 — giro 3. La lamentela della segnalazione per una strada che
// non passa dalla codifica: «Filo lo cerca col terminale… e poi a quel percorso
// non c'è nessun file».
//
// La cartella di lavoro dell'assistente viene appuntata sul MITTENTE del
// messaggio. Il mittente però non è la scheda: è un oggetto costruito da capo a
// ogni messaggio che arriva dalla pagina. Appena il messaggio cambia,
// l'appunto è perso e Filo riparte dalla home. Quindi:
//   • un «cd» vale finché dura il turno e non un minuto di più;
//   • il comando che l'utente conferma nel popup NON gira dove il popup dice:
//     quel popup esiste apposta per dire in quale cartella il comando andrà a
//     scrivere, e a confermarlo è per forza un messaggio nuovo.
//
// I giri passati questa porta non l'hanno vista perché la provavano chiamando
// l'azione dentro al processo principale, senza mittente: senza mittente
// l'appunto finisce in una variabile condivisa, che invece sopravvive.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
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

// Un turno di chat: più azioni di fila con lo STESSO mittente, come fa il
// ciclo dell'assistente quando lancia un comando dopo l'altro da solo.
const turnoDiChat = (app, azioni) =>
  app.evaluate(async (_electron, azioniIn) => {
    const mittente = { url: 'filo://dashboard/dashboard.html', tab: null };
    const esiti = [];
    for (const a of azioniIn) {
      esiti.push(await globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: mittente }));
    }
    return esiti;
  }, azioni);

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('un «cd» vale ancora al messaggio dopo', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-memoria-');
  try {
    writeFileSync(join(base, 'bolletta.txt'), 'totale 84,50\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const cd = await eseguiComando(page, `cd '${base}'`);
    expect(cd.executed, `il cd non è partito: ${JSON.stringify(cd).slice(0, 300)}`).toBe(true);

    const ls = await eseguiComando(page, 'ls');
    expect(
      String(ls.output?.stdout || ''),
      'il comando dopo il «cd» gira in un’altra cartella: il file appena trovato «non esiste»',
    ).toContain('bolletta.txt');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('il comando che l’utente conferma gira dove Filo aveva detto', async ({ app, openTab }) => {
  const base = cartellaTemporanea('filo-551-conferma-');
  try {
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Il turno dell'assistente: entra nella cartella dell'utente e poi propone
    // un comando che modifica — livello 2, quindi si ferma e chiede.
    const [vai, proposta] = await turnoDiChat(app, [
      { type: 'ESEGUI_COMANDO', comando: `cd '${base}'` },
      { type: 'ESEGUI_COMANDO', comando: 'mkdir prova-di-filo' },
    ]);
    expect(vai.executed).toBe(true);
    expect(proposta.executed, 'un comando che modifica deve fermarsi a chiedere').toBe(false);
    // Quello che l'utente legge nel popup: la cartella in cui il comando scriverà.
    const mostrata = String(proposta.action?._cwd || proposta.describe || '');
    expect(mostrata, 'il popup non dice più in quale cartella si scriverà').toContain('filo-551-conferma-');

    // L'utente conferma: è per forza un messaggio nuovo.
    const fatto = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'filo_confirm_action',
        action: { type: 'ESEGUI_COMANDO', comando: 'mkdir prova-di-filo' },
      }, (r) => resolve(r));
    }));
    expect(fatto.executed, `la conferma non ha eseguito: ${JSON.stringify(fatto).slice(0, 300)}`).toBe(true);

    expect(
      existsSync(join(base, 'prova-di-filo')),
      'il comando confermato ha scritto in una cartella diversa da quella mostrata nel popup',
    ).toBe(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(join(process.env.HOME || '/root', 'prova-di-filo'), { recursive: true, force: true });
  }
});
