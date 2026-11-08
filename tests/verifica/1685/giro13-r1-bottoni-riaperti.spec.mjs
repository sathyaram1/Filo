// Giro 13 di #1685, rilievo 1: riaperta la chat tornano anche «Annulla» della rinomina e il riquadro che corregge un
// colore, non solo file, pagine, appunti, eventi e conferme.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const dimenticaLaMemoria = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

test('r1 file rinominato dalla chat: riaperta, «Annulla» c\'è ancora e rimette il nome di prima', async ({ app }) => {
  test.setTimeout(90_000);
  await livelloAutonomia(app, 'conservativo');
  const dir = cartellaInCasa('filo-g13-');
  writeFileSync(join(dir, 'scan_00231.txt'), 'bolletta della luce marzo');
  try {
    await modelloFinto(app, [
      { text: 'Ecco.', toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ percorsi: [join(dir, 'scan_00231.txt')], nome: 'Bolletta luce marzo' }) }] },
      { text: '' },
    ]);
    const page = await home(app);
    await chiedi(page, 'chiama quel file bolletta luce marzo');
    await expect.poll(() => confirmText(page), { timeout: 20_000 }).toContain('Bolletta luce marzo');
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn', { hasText: 'Annulla' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    expect(readdirSync(dir)).toEqual(['Bolletta luce marzo.txt']);
    const chat = await chatCon(app, 'chiama quel file bolletta luce marzo');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    await expect(page.locator('.dash-bubble-user', { hasText: 'chiama quel file' })).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: 'tests/.shots/giro13-r1-rinomina-riaperta.png' });
    const annulla = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Annulla' });
    await expect(annulla, 'riaperta la chat, il nome di prima si rimette dal suo bottone').toHaveCount(1, { timeout: 5_000 });
    await annulla.click();
    await expect.poll(() => readdirSync(dir), { timeout: 10_000 }).toEqual(['scan_00231.txt']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r1 colore cambiato dalla chat: riaperta, il riquadro per scegliere il colore esatto c\'è ancora', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: 'Fatto.', toolCalls: [{ id: 'e1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"accent","valore":"#c0392b"}' }] },
    { text: '' },
  ]);
  await chiedi(page, 'fai il colore principale più rosso');
  await expect(page.locator('.dash-bubble-filo .sn-refine-trigger')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'fai il colore principale più rosso');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'fai il colore' })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/giro13-r1-estetica-riaperta.png' });
  await expect(page.locator('.dash-bubble-filo .sn-refine-trigger'), 'riaperta la chat, il colore si corregge ancora dal suo riquadro').toHaveCount(1, { timeout: 5_000 });
  await ripristina(app);
});
