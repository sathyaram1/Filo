// Verifica locale «lavori locali», giro 3: esplorazione in Gestione con dati finti (nessuna scrittura arriva alla rete).
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ieri = '2026-09-30T10:00:00Z';
const UTENTE_LOCALE = { _id: 'u-locale', seq: 801, subSeq: 0, name: 'Utente che chiede lavoro locale', text: 'x', clientId: 'utente-1', createdAt: ieri, status: 'design', statusReason: 'locale', notes: 'Richiede lavoro locale. Serve il deploy.' };
const OWNER_SENZA_PROVA = { _id: 'o-senza', seq: 802, subSeq: 0, name: 'Mio dal Filo installato', text: 'x', clientId: 'owner:abc', createdAt: ieri, status: 'todo' };
const SESSIONE_LOCALE = { _id: 's-locale', seq: 803, subSeq: 0, name: 'Lavoro di una sessione', text: 'x', clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: Date.parse(ieri) }, createdAt: ieri, status: 'todo' };
const FALSO_ATTACCO = { _id: 'f-att', seq: 804, subSeq: 0, name: 'Finta sessione', text: 'x', clientId: 'local:claude', createdAt: ieri, status: 'unlabeled', pipeline: { verdicts: [{ judge: 'A', class: 'attack' }, { judge: 'B', class: 'attack' }], expectedJudges: ['A', 'B'] } };

async function prepara(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true, by: 'owner@example.com', at: Date.now() }; }
      return orig(msg);
    };
  });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, [UTENTE_LOCALE, OWNER_SENZA_PROVA, SESSIONE_LOCALE, FALSO_ATTACCO].map((f) => JSON.parse(JSON.stringify(f))));
  return page;
}

test('esplora: Ricevuti per lavoro locale, «È mio», poi «Locale»', async ({ openTab }) => {
  const page = await prepara(openTab);
  await page.evaluate(() => { window.__mgTest.setTab('inbox'); window.__mgTest.openDetail('u-locale'); });
  const corpo = await page.locator('body').innerText();
  console.log('RICEVUTI-LOCALE contiene giudici-design:', /Per i giudici è una questione di design/.test(corpo), '| locale:', /Richiede lavoro locale/.test(corpo));

  await page.evaluate(() => { window.__mgTest.setTab('queue'); window.__mgTest.openDetail('o-senza'); });
  console.log('O senza prova: È mio visibile', await page.locator('#mgSenderBtn').isVisible(), '| Locale visibile', await page.locator('#mgLocalBtn').isVisible());
  await page.screenshot({ path: 'tests/.shots/giro3-e-mio-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/giro3-e-mio-dark.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'light'));
  await page.locator('#mgSenderBtn').click();
  await page.waitForTimeout(500);
  console.log('updates dopo È mio', JSON.stringify(await page.evaluate(() => window.__updates)));
  console.log('dopo: È mio visibile', await page.locator('#mgSenderBtn').isVisible(), '| Locale visibile', await page.locator('#mgLocalBtn').isVisible(), '| msg', await page.locator('#mgManageMsg').innerText());
  if (await page.locator('#mgLocalBtn').isVisible()) {
    await page.locator('#mgLocalBtn').click();
    await page.waitForTimeout(500);
    console.log('updates dopo Locale', JSON.stringify(await page.evaluate(() => window.__updates.slice(1))));
    console.log('msg', await page.locator('#mgManageMsg').innerText());
  }
  await page.evaluate(() => window.__mgTest.setTab('local'));
  await page.waitForTimeout(300);
  console.log('Lavori locali:', JSON.stringify(await page.locator('.mg-item .mg-item-num').allInnerTexts()));

  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.waitForTimeout(300);
  console.log('Ricevuti:', JSON.stringify(await page.locator('.mg-item .mg-item-num').allInnerTexts()));
  const falso = page.locator('.mg-item[data-id="f-att"]');
  if (await falso.count()) {
    await falso.click({ button: 'right' });
    await page.waitForTimeout(300);
    const voci = await page.locator('.mg-ctxmenu .sn-select-option').evaluateAll((els) => els.map((e) => `${e.textContent.trim()} [${e.title || ''}]`));
    console.log('menu del falso segnalato:', JSON.stringify(voci));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__mgTest.openDetail('f-att'));
    console.log('dettaglio falso: È mio visibile', await page.locator('#mgSenderBtn').isVisible(), 'title:', await page.locator('#mgSenderBtn').getAttribute('title'));
  }
});
