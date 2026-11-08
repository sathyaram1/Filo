// Giro 13 di #1685, esplorazione: i bottoni che una risposta lascia da cliccare tornano tutti nella chat riaperta?
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

test('esplora rinomina: riaperta la chat, «Annulla» rimette ancora il nome di prima', async ({ app }) => {
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
    console.log('LIVE', await page.locator('.dash-bubble-filo').last().innerText());
    const chat = await chatCon(app, 'chiama quel file bolletta luce marzo');
    console.log('SALVATA', JSON.stringify(chat.messages));
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    await expect(page.locator('.dash-bubble-user', { hasText: 'chiama quel file' })).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(800);
    console.log('RIAPERTA', await page.locator('.dash-bubble-filo').last().innerText());
    await page.screenshot({ path: 'tests/.shots/giro13-rinomina-riaperta.png' });
    console.log('ANNULLA RIAPERTA', await page.locator('.dash-action-btn', { hasText: 'Annulla' }).count());
    console.log('DISCO', readdirSync(dir));
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('esplora estetica: riaperta la chat, il riquadro per correggere il colore c\'è ancora', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: 'Fatto.', toolCalls: [{ id: 'e1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"accent","valore":"#c0392b"}' }] },
    { text: '' },
  ]);
  await chiedi(page, 'fai il colore principale più rosso');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  console.log('LIVE EST', await page.locator('.dash-bubble-filo').last().innerHTML());
  const chat = await chatCon(app, 'fai il colore principale più rosso');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'fai il colore' })).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  console.log('RIAPERTA EST', await page.locator('.dash-bubble-filo').last().innerHTML());
  await page.screenshot({ path: 'tests/.shots/giro13-estetica-riaperta.png' });
  await ripristina(app);
});

test('esplora pagina: riaperta la chat, il collegamento ha il nome e apre la pagina', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const url = testServer.html('<title>Posta</title><h1>Posta</h1>');
  await modelloFinto(app, [{ text: 'Ecco la posta.', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'Posta <b>x</b>', background: true }) }] }, { text: '' }]);
  await chiedi(page, 'apri la posta');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  console.log('LIVE NAV', await page.locator('.dash-bubble-filo .dash-action-link-chip').first().evaluate((e) => e.outerHTML));
  const chat = await chatCon(app, 'apri la posta');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const chip = page.locator('.dash-bubble-filo .dash-action-link-chip');
  await expect(chip).toHaveCount(1, { timeout: 8_000 });
  console.log('RIAPERTA NAV', await chip.evaluate((e) => e.outerHTML));
  await chip.click();
  await page.waitForTimeout(1500);
  console.log('SCHEDE', await shell.locator('.tab').count());
  await ripristina(app);
});
