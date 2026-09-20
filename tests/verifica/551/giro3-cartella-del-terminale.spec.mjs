// Verifica #551 — giro 3. Il lettore di documenti non sa dove Filo sta
// guardando.
//
// Il terminale ha una cartella di lavoro e l'assistente la sposta da sé; il
// lettore di documenti quella cartella non la guarda mai. Un nome senza
// percorso — cioè quello che un elenco stampa, perché un elenco stampa i nomi —
// viene cercato nella cartella del PROGRAMMA Filo, che con la richiesta
// dell'utente non c'entra niente.
//
// Prima il file semplicemente non si trovava. Adesso che un nome quasi giusto
// viene perdonato, quel nome può combaciare con un file della cartella di Filo:
// il file si apre, il suo contenuto entra nella risposta come se fosse il
// documento dell'utente, e Filo risponde su quello.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

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

// Un turno di chat: stesso mittente per tutte le azioni, come il ciclo
// dell'assistente quando lancia un comando e poi prosegue da sé.
const turnoDiChat = (app, azioni) =>
  app.evaluate(async (electron, azioniIn) => {
    // Il mittente com'è fatto davvero: un oggetto nuovo per ogni messaggio, che
    // porta con sé i webContents della scheda. Dentro UN turno l'assistente
    // riusa lo stesso oggetto per tutte le azioni che lancia di fila.
    const wc = electron.webContents.getAllWebContents()
      .find((w) => String(w.getURL() || '').includes('dashboard.html'));
    const mittente = { url: wc ? wc.getURL() : '', tab: null, wc: wc || null };
    const esiti = [];
    for (const a of azioniIn) {
      esiti.push(await globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: mittente }));
    }
    return esiti;
  }, azioni);

test('il nome stampato dall’elenco apre il file dell’utente, non uno di Filo', async ({ app, openTab }) => {
  const base = cartellaTemporanea('filo-551-senza-cartella-');
  try {
    writeFileSync(join(base, 'appunti.txt'), 'appunti dell utente\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Il giro che fa Filo dal vivo: entra nella cartella dell'utente ed elenca.
    const [vai, elenco] = await turnoDiChat(app, [
      { type: 'ESEGUI_COMANDO', comando: `cd '${base}'` },
      { type: 'ESEGUI_COMANDO', comando: 'ls' },
    ]);
    expect(vai.executed).toBe(true);
    expect(String(elenco.output?.stdout || '')).toContain('appunti.txt');

    // Un nome con un carattere perso, come quelli che il terminale di Windows
    // consegnava. Nella cartella dove Filo sta guardando non c'è niente che gli
    // somigli: l'unica cosa che ci somiglia sta nella cartella del programma.
    const r = await leggiDocumento(page, 'package.jso�');
    const aperto = String(r?.output?.name || '');
    expect(
      r?.output?.ok === true,
      `Filo ha aperto un file che non sta dove l'utente sta guardando: ${JSON.stringify(aperto)}`,
    ).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
