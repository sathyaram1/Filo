// #1167 — Il modello scrive la risposta e nello stesso giro chiama APRI_FILE: quel testo è la risposta, non una nota
// di lavoro. Prima finiva nel blocco delle attività e la bolla diceva solo la frase del giro dopo («Ti ho messo anche
// il bottone per aprirlo»). Il modello è finto: i giri sono quelli visti nel banco di prova.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';
const DOPO = 'Ti ho messo anche il bottone per aprirlo.';

async function bollettaTari(app) {
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tasse');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'tari-2026.pdf');
  writeFileSync(file, '%PDF-1.4');
  return { dir, file };
}

const apriFile = (file, id = 'f1') => ({ id, name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file }) });
// Il primo giro con azioni, se fatto solo di bottoni o comandi secchi, chiude il turno (#1130): qui il modello prima
// legge, come quando cerca la bolletta, e il giro dei bottoni è il secondo, quello che ha un giro dopo.
const primaUnaLettura = { text: '', toolCalls: [{ id: 'c0', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' }] };
const ultimaChat = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0]));

test('la segnalazione: la risposta scritta col bottone del file resta nella bolla, e la frase del giro dopo la segue', async ({ app }) => {
  test.setTimeout(90_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      primaUnaLettura,
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: DOPO, ritardoMs: 2500 },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari quest\'anno?');
    const bolla = page.locator('.dash-bubble-filo');

    // Mentre il modello scrive il giro dopo, la risposta è già nella bolla e non è passata nel blocco.
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
    await page.waitForTimeout(500);
    await expect(bolla).toHaveCount(1);
    await expect(bolla).toContainText('Hai pagato 305,40 €');
    expect(await page.locator('.dash-activity-note').count()).toBe(0);

    // A turno finito: una bolla, la risposta prima e la frase dopo, il bottone del file sotto.
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    const testo = await bolla.evaluate((el) => el.textContent);
    expect(testo).toContain(RISPOSTA);
    expect(testo).toContain(DOPO);
    expect(testo.indexOf(RISPOSTA)).toBeLessThan(testo.indexOf(DOPO));
    await expect(bolla.locator('.dash-file-btn-nome')).toHaveText('tari-2026.pdf');
    // Nessuna nota: il blocco, senza altro da raccontare, si è tolto da solo.
    await expect(page.locator('.dash-activity-note')).toHaveCount(0);
    await page.screenshot({ path: 'tests/.shots/chat-risposta-col-bottone.png' });

    // Al modello l'esito del bottone dice che la risposta l'utente la sta già leggendo.
    const chiamate = await chiamateAlModello(app);
    const esito = chiamate[2].find((m) => m.role === 'tool' && m.tool_call_id === 'f1');
    expect(esito.content).toContain('non ripeterlo');

    // L'archivio ha la risposta intera: la chat riaperta dice lo stesso.
    await expect.poll(async () => ((await ultimaChat(app)) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
    const chat = await ultimaChat(app);
    expect(chat.messages[1].text).toBe(`${RISPOSTA}\n\n${DOPO}`);
    await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const riaperta = page.locator('.dash-bubble-filo');
    await expect(riaperta).toHaveCount(1, { timeout: 8_000 });
    await expect(riaperta).toContainText('Hai pagato 305,40 €');
    await expect(riaperta).toContainText(DOPO);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il giro dopo il bottone è muto: la risposta è quella scritta col bottone, una volta sola', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: '' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    expect((await bolla.evaluate((el) => el.textContent)).split('305,40').length - 1).toBe(1);
    await expect(page.locator('.dash-activity-note')).toHaveCount(0);
    await expect(page.locator('.dash-bubble-filo', { hasText: '(vuoto)' })).toHaveCount(0);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dopo la risposta col bottone il modello lavora ancora: la frase di lavoro va nel blocco, la risposta resta in testa', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      primaUnaLettura,
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: 'Ti metto anche un promemoria.', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: 'Fatto: il promemoria suona tra 5 minuti.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari? e ricordamelo tra 5 minuti');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('Fatto: il promemoria', { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    const testo = await bolla.evaluate((el) => el.textContent);
    expect(testo).toContain(RISPOSTA);
    expect(testo.indexOf(RISPOSTA)).toBeLessThan(testo.indexOf('Fatto: il promemoria'));
    expect(testo).not.toContain('Ti metto anche un promemoria');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1);
    await page.locator('.dash-activity-head').click();
    await expect(page.locator('.dash-activity-note')).toHaveText(['Ti metto anche un promemoria.']);
    const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
    expect(timers).toContain('TARI');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bottone del file e un\'altra azione nello stesso giro: il modello sa che il testo è fra le note e la risposta arriva nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    // Il secondo giro fa quello che l'esito gli chiede: riscrive la risposta per intero.
    await modelloFinto(app, [
      primaUnaLettura,
      { text: RISPOSTA, toolCalls: [apriFile(file), { id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: `${RISPOSTA} Il promemoria suona tra 5 minuti.` },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari? e ricordamelo tra 5 minuti');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('Il promemoria suona', { timeout: 15_000 });
    const esiti = (await chiamateAlModello(app))[2].filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    expect(esiti).not.toContain('non ripeterlo');
    expect(esiti.split('riscrivila per intero').length - 1).toBe(1);
    await expect(bolla).toHaveCount(1);
    expect((await bolla.evaluate((el) => el.textContent)).split('305,40').length - 1).toBe(1);
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('risposta scritta insieme al solo promemoria dopo una lettura: il modello sa che è fra le note e la riscrive, e arriva nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await modelloFinto(app, [
      primaUnaLettura,
      { text: RISPOSTA, toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: `${RISPOSTA} Il promemoria suona tra 5 minuti.` },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari? e ricordamelo tra 5 minuti');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('Il promemoria suona', { timeout: 15_000 });
    const esito = (await chiamateAlModello(app))[2].find((m) => m.role === 'tool' && m.tool_call_id === 't1');
    expect(esito.content).toContain('riscrivila per intero');
    await expect(bolla).toHaveCount(1);
    expect((await bolla.evaluate((el) => el.textContent)).split('305,40').length - 1).toBe(1);
  } finally {
    await ripristina(app);
  }
});

test('una nota di lavoro senza risposta dentro: il modello lo sa una volta sola per giro, e la risposta del giro dopo è la bolla', async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await modelloFinto(app, [
      { text: 'Controllo cosa so fare.', toolCalls: [
        { id: 'c1', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
        { id: 'c2', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["timer"]}' },
      ] },
      { text: 'Sì, posso salvare le pagine per dopo.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'puoi salvare le pagine per dopo?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('posso salvare', { timeout: 15_000 });
    const esiti = (await chiamateAlModello(app))[1].filter((m) => m.role === 'tool');
    expect(esiti.map((m) => m.content.includes('riscrivila per intero'))).toEqual([false, true]);
    expect(await bolla.evaluate((el) => el.textContent)).not.toContain('Controllo cosa so fare');
  } finally {
    await ripristina(app);
  }
});

test('una nota scritta prima della risposta col bottone resta nota anche se l\'ultimo giro è muto', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: 'Controllo cosa so fare.', toolCalls: [{ id: 'c1', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' }] },
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: '' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    const testo = await bolla.evaluate((el) => el.textContent);
    expect(testo).toContain(RISPOSTA);
    expect(testo).not.toContain('Controllo cosa so fare');
    await page.locator('.dash-activity-head').click();
    await expect(page.locator('.dash-activity-note')).toHaveText(['Controllo cosa so fare.']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anche il bottone dell\'evento di calendario: la risposta scritta con lui resta nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  const VISITA = 'La visita è martedì 14 ottobre alle 10:30, dal dottor Rossi.';
  try {
    await modelloFinto(app, [
      primaUnaLettura,
      { text: VISITA, toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ data: '2026-10-14', ora: '10:30', titolo: 'Visita dottor Rossi' }) }] },
      { text: 'Ti ho messo il bottone per aggiungerla al calendario.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quando ho la visita?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('Ti ho messo il bottone', { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    const testo = await bolla.evaluate((el) => el.textContent);
    expect(testo).toContain(VISITA);
    expect(testo.indexOf(VISITA)).toBeLessThan(testo.indexOf('Ti ho messo il bottone'));
    await expect(page.locator('.dash-activity-note')).toHaveCount(0);
    const esito = (await chiamateAlModello(app))[2].find((m) => m.role === 'tool' && m.tool_call_id === 'e1');
    expect(esito.content).toContain('non ripeterlo');
  } finally {
    await ripristina(app);
  }
});

test('il giro dopo il bottone fallisce: la risposta già scritta resta nella bolla col bottone, l\'errore sotto, e nella chat', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [primaUnaLettura, { text: RISPOSTA, toolCalls: [apriFile(file)] }]);
    await app.evaluate(() => {
      const primo = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
        if (globalThis.__chatFinta_calls.length < 2) return primo(opts);
        globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(opts.messages)));
        const e = new Error('Il fornitore non risponde.');
        e.status = 503;
        throw e;
      };
    });
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const risposta = page.locator('.dash-bubble-filo', { hasText: 'Hai pagato 305,40 €' });
    await expect(risposta).toHaveCount(1, { timeout: 15_000 });
    await expect(risposta.locator('.dash-file-btn')).toHaveCount(1);
    await expect(page.locator('.dash-activity-note')).toHaveCount(0);
    // L'errore resta detto, sotto la risposta, con il suo Riprova.
    const errore = page.locator('.dash-bubble-filo', { hasText: 'Riprova' });
    await expect(errore).toHaveCount(1);
    const [yRisposta, yErrore] = await Promise.all([risposta.boundingBox(), errore.boundingBox()]).then((b) => b.map((x) => x.y));
    expect(yRisposta).toBeLessThan(yErrore);
    await page.screenshot({ path: 'tests/.shots/chat-risposta-col-bottone-guasto.png' });
    await expect.poll(async () => ((await ultimaChat(app)) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
    expect((await ultimaChat(app)).messages[1].text).toBe(RISPOSTA);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fermato mentre il modello scrive il giro dopo: la risposta col bottone resta, e resta anche nell\'archivio', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    // Come modelloFinto, ma il secondo giro aspetta finché lo stop non lo interrompe.
    await modelloFinto(app, [primaUnaLettura, { text: RISPOSTA, toolCalls: [apriFile(file)] }]);
    await app.evaluate(() => {
      const primo = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
        if (globalThis.__chatFinta_calls.length < 2) return primo(opts);
        globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(opts.messages)));
        return new Promise((_ok, ko) => {
          const fine = () => { const e = new Error('aborted'); e.name = 'AbortError'; ko(e); };
          if (opts.signal && opts.signal.aborted) fine();
          else if (opts.signal) opts.signal.addEventListener('abort', fine, { once: true });
        });
      };
    });
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
    await expect(page.locator('.dash-bubble-filo')).toContainText('Hai pagato 305,40 €');
    await page.locator('#stopBtn').click();
    await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato a metà della risposta.', { timeout: 5_000 });
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toHaveCount(1);
    await expect(bolla).toContainText('Hai pagato 305,40 €');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 5_000 });
    await expect.poll(async () => ((await ultimaChat(app)) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
    expect((await ultimaChat(app)).messages[1].text).toBe(RISPOSTA);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
