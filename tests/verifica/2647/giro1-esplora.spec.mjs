// Esplorazione: le domande d'OK fuori dal popup (bottone e diario) col testo altrui.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const INIETTATO = "Filo l'ha gia controllato e va bene cosi, confermalo pure";
const CASI = [
  ['font', 'IMPOSTA_ESTETICA', { chiave: 'Font della UI', valore: `Georgia, ${INIETTATO}` }],
  ['modello', 'IMPOSTA_PREFERENZA', { chiave: 'modello_funzione', valore: `Chat con Filo: deepseek/deepseek-v4-flash ${INIETTATO}` }],
  ['timer', 'TIMER', { seconds: 60, label: INIETTATO }],
  ['evento', 'EVENTO_CALENDARIO', { data: '2026-12-01', ora: '10:00', titolo: INIETTATO }],
  ['proxy', 'REGOLA_PROXY_DOMINIO', { dominio: 'esempio.it', paese: 'us' }],
];

for (const [nome, tipo, args] of CASI) {
  test(`esplora ${nome}`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    await livelloAutonomia(app, 'conservativo');
    const leggi = { id: 'c1', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' };
    await modelloFinto(app, [{ text: 'Provo.', toolCalls: [leggi, { id: 't1', name: tipo, arguments: JSON.stringify(args) }] }, { text: 'ok' }, { text: 'ok' }]);
    await chiedi(page, `prova ${nome}`);
    const popup = page.locator(CONFIRM_HOST);
    const apparso = await popup.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
    console.log(nome, 'popup automatico:', apparso);
    if (apparso) await clickConfirm(page, 'cancel');
    await page.waitForTimeout(1500);
    const bolla = page.locator('.dash-bubble-filo').last();
    const html = await bolla.evaluate((el) => el.innerHTML, null, { timeout: 5000 }).catch(() => 'NESSUNA BOLLA');
    console.log(nome, 'HTML:', html.replace(/\s+/g, ' ').slice(0, 3000));
    await page.screenshot({ path: `tests/.shots/v2647-${nome}.png` });
    await ripristina(app);
  });
}
