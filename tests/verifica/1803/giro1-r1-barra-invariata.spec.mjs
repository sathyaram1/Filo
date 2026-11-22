// Verifica #1803.2 giro 1: una mossa a parole che lascia la barra com'era non si racconta come fatta, né nella riga
// (in diretta e riaperta) né a Filo, che sul suo esito scrive la risposta all'utente.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));

test('r1 rinomina allo stesso nome, sposta in cima la prima, rimetti un sito già lì: riga e risposta dicono che non è cambiato niente', async ({ app }) => {
  test.setTimeout(120_000);
  let page = await home(app);
  await app.evaluate(async () => {
    await chrome.storage.local.set({ filo_barra_siti: [
      { id: 'yt', tipo: 'sito', url: 'https://youtube.com/', nome: 'YouTube', icona: '' },
      { id: 'gm', tipo: 'sito', url: 'https://mail.google.com/', nome: 'Gmail', icona: '' },
    ] });
  });
  await page.reload();
  page = await home(app);
  const turni = [
    ['rinomina YouTube in YouTube', { operazione: 'rinomina', elemento: 'YouTube', nome: 'YouTube' }, 'Ha già quel nome nella barra dei siti · YouTube'],
    ['sposta YouTube in cima', { operazione: 'sposta', elemento: 'YouTube', verso: 'cima' }, 'È già a quel posto nella barra dei siti · YouTube'],
    ['rimetti youtube nella barra', { operazione: 'aggiungi', elemento: 'youtube.com', nome: 'Tubo' }, 'È già nella barra dei siti · YouTube'],
    ['sposta Gmail in fondo', { operazione: 'sposta', elemento: 'gmail', verso: 'fondo' }, 'È già a quel posto nella barra dei siti · Gmail'],
    ['rinomina YouTube in Video', { operazione: 'rinomina', elemento: 'YouTube', nome: 'Video' }, 'Rinominato nella barra dei siti · Video'],
  ];
  await modelloFinto(app, turni.flatMap(([, args], i) => [
    { toolCalls: [{ id: `v${i}`, name: 'BARRA_SITI', arguments: JSON.stringify(args) }] },
    { text: `Risposta ${i}.` },
  ]));
  let esiti = [];
  try {
    for (const [i, [chiesto, , riga]] of turni.entries()) {
      await page.locator('#input').fill(chiesto);
      await page.locator('#sendBtn').click();
      await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i}.` })).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('#bubbles')).toContainText(riga);
    }
    await expect(page.locator('#bubbles')).not.toContainText('Messo nella barra');
    await expect(page.locator('#bubbles')).not.toContainText('Spostato nella barra');
    const salvate = await app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti);
    expect(salvate.map((v) => v.nome)).toEqual(['Video', 'Gmail']);
    esiti = (await chiamateAlModello(app)).at(-1).filter((m) => m.role === 'tool').map((m) => String(m.content));
  } finally { await ripristina(app); }

  // Riaperta, la conversazione racconta le stesse righe.
  const chat = (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === 'rinomina YouTube in YouTube'));
  expect(chat).toBeTruthy();
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  for (const [, , riga] of turni) await expect(page.locator('#bubbles')).toContainText(riga, { timeout: 10_000 });
  await expect(page.locator('#bubbles')).not.toContainText('Messo nella barra');

  // Filo scrive la risposta su quello che gli torna: per le quattro mosse senza effetto non deve leggere «fatto».
  expect(esiti).toHaveLength(5);
  for (const e of esiti.slice(0, 4)) expect(e).not.toMatch(/Eseguita: (Messo|Spostato|Rinominato)/);
  expect(esiti[2]).toMatch(/già/);
  expect(esiti[4]).toMatch(/Rinominato/);
});
