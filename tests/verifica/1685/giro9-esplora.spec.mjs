// Verifica #1685 giro 9, esplorazione: l'OK e la ripresa accanto ai seguiti scritti mentre Filo lavora (#1296).
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const mkdir = (id, dir, nome) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });
async function okAlBottone(page, bottone) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(bottone).toHaveText(/^✓/, { timeout: 10_000 });
}
const messaggi = (app, testo) => app.evaluate(async (_e, t) => {
  for (const c of await globalThis.SN_FILO_CHATS.list()) {
    const chat = await globalThis.SN_FILO_CHATS.get(c.id);
    if (chat && chat.messages.some((m) => m.text === t)) return chat.messages.map((m) => `${m.role}: ${m.text} ${JSON.stringify(m.esiti || [])}`);
  }
  return [];
}, testo);
async function seguito(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-user.dash-bubble-attesa', { hasText: testo })).toBeVisible({ timeout: 2_000 });
}

test('E1 OK dato durante un\'altra risposta, poi un seguito: il seguito sa dell\'OK', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g9-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'tre')] },
      { text: 'Aspetto il tuo OK.' },
      { text: 'Sono le dieci.', ritardoMs: 4000 },
      { text: 'Risposta al seguito.' },
      { text: 'ALTRO GIRO.' },
    ]);
    await chiedi(page, 'crea la cartella tre');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto il tuo OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'intanto che ore sono?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 5_000 }).toBe(3);
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' }));
    await seguito(page, 'e domani piove?');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    const ch = await chiamateAlModello(app);
    console.log('CHIAMATE', ch.length);
    console.log('ULTIMA', JSON.stringify(ch[3].filter((m) => m.role !== 'system'), null, 1));
    console.log('ARCHIVIOX', JSON.stringify(await messaggi(app, 'crea la cartella tre'), null, 1));
    console.log('BOLLE', await page.locator('.dash-bubble').allInnerTexts());
    expect(existsSync(join(dir, 'tre'))).toBe(true);
    expect(JSON.stringify(ch[3])).toMatch(/Comando eseguito[^"]*mkdir/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('E3 la ripresa dopo l\'OK fallisce, Riprova: il modello non legge la ripresa due volte', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g9-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'cinque')] },
      { text: 'Aspetto il tuo OK.' },
      { text: 'Fatto, cartella creata.' },
      { text: 'Prego.' },
    ]);
    await app.evaluate(() => {
      const f = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
      let k = 0;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
        k += 1;
        if (k === 3) { globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(o.messages))); const e = new Error('Servizio non disponibile'); e.status = 503; throw e; }
        return f(o);
      };
    });
    await chiedi(page, 'crea la cartella cinque');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto il tuo OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella cinque' }));
    const riprova = page.locator('.dash-action-btn', { hasText: 'Riprova' });
    await expect(riprova).toBeVisible({ timeout: 15_000 });
    console.log('BOLLE3a', await page.locator('.dash-bubble').allInnerTexts());
    await riprova.click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto, cartella creata' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'grazie');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Prego' })).toBeVisible({ timeout: 15_000 });
    const ch = await chiamateAlModello(app);
    console.log('CHIAMATE3', ch.length);
    for (const c of ch.slice(2)) console.log('RICH3', JSON.stringify(c.filter((m) => m.role !== 'system').map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : JSON.stringify(m.content).slice(0, 400)}`), null, 1));
    console.log('ARCHIVIO3', JSON.stringify(await messaggi(app, 'crea la cartella cinque'), null, 1));
    console.log('BOLLE3', await page.locator('.dash-bubble').allInnerTexts());
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('E2 un seguito scritto durante la ripresa dopo l\'OK: risposta una volta, tutto nella conversazione', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g9-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'quattro')] },
      { text: 'Aspetto il tuo OK.' },
      { text: '', ritardoMs: 4000 },
      { text: 'Risposta al seguito.' },
      { text: 'ALTRO GIRO.' },
    ]);
    await chiedi(page, 'crea la cartella quattro');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto il tuo OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella quattro' }));
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 5_000 }).toBe(3);
    await seguito(page, 'grazie mille');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    const ch = await chiamateAlModello(app);
    console.log('CHIAMATE2', ch.length);
    console.log('ULTIMA2', JSON.stringify(ch[ch.length - 1]).slice(-2500));
    const arch = await messaggi(app, 'crea la cartella quattro');
    console.log('ARCHIVIO2', arch.join('\n'));
    console.log('BOLLE2', await page.locator('.dash-bubble').allInnerTexts());
    expect(arch.filter((m) => m.startsWith('user: grazie mille')).length).toBe(1);
    expect(ch.length).toBe(4);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
