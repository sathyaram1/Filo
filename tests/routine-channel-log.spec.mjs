// Spec Playwright: i registri del canale delle routine nella scheda "Log" della
// dashboard di gestione (#477.1).
//
// COSA VERIFICA (comportamento, non stringhe d'errore)
//   Un tentativo respinto dal server e una differenza fra la scelta delle
//   routine e quella del server DEVONO comparire all'owner: se restano solo nel
//   database, "registrato e visibile all'owner" è vero a metà — e la metà che
//   manca è quella che conta, perché un lavoratore che prova azioni fuori dal
//   suo perimetro è il segnale che qualcuno l'ha manipolato.
//
// PRE-CONDIZIONE: senza il blocco nuovo nella pagina questi assert falliscono
// (la sezione non esiste, quindi non contiene nessuna riga).

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

const REJECTIONS = [
  { id: 'r1', at: '2026-08-17T10:00:00.000Z', slug: 'notturna', role: 'secaudit', reason: 'role_forbids', action: 'status' },
  { id: 'r2', at: '2026-08-17T09:00:00.000Z', slug: 'notturna', role: 'verifier', reason: 'branch_mismatch', action: 'verdict' },
];
const COMPARISONS = [
  { id: 'c1', at: '2026-08-17T09:30:00.000Z', slug: 'notturna', same: true, git: { role: 'new-work', num: '#500' }, server: { role: 'new-work', num: '#500' } },
  { id: 'c2', at: '2026-08-17T08:00:00.000Z', slug: 'notturna', same: false, git: { role: 'verifier', num: '#490' }, server: { role: 'new-work', num: '#500' }, serverBlindToBranchState: true },
];

test('i rifiuti del canale compaiono all owner, col motivo in chiaro e la routine che li ha causati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await apriScheda(page, 'log');

  await page.evaluate(({ rej, cmp }) => window.__mgTest.renderChannelLog(rej, cmp), { rej: REJECTIONS, cmp: COMPARISONS });

  const section = page.locator('#mgChannelSection');
  await expect(section).toBeVisible();

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(4);

  // Le righe sono in ordine cronologico inverso: il rifiuto delle 10:00 è la prima.
  await expect(rows.nth(0)).toContainText('Respinto');
  await expect(rows.nth(0)).toContainText('azione fuori dal ruolo');
  await expect(rows.nth(0)).toContainText('notturna');
  // Il motivo grezzo del codice non arriva mai all'owner.
  await expect(page.locator('#mgChannelList')).not.toContainText('role_forbids');
  await expect(page.locator('#mgChannelList')).not.toContainText('branch_mismatch');
  await expect(page.locator('#mgChannelList')).toContainText('ramo diverso da quello assegnato');

  // Un rifiuto si distingue a colpo d'occhio da un confronto.
  await expect(rows.nth(0).locator('.mg-log-role--deny')).toHaveCount(1);
});

// #1653: una fusione fermata da L5 nel recupero del server deve dire di quale feedback è, sennò da qui non si sa chi è fermo.
test('un rifiuto per una fusione fermata dai controlli porta il numero del feedback e il motivo in chiaro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');

  const rej = [
    { id: 'r3', at: '2026-10-25T06:14:00.000Z', slug: 'recupero dal server', reason: 'l5_blocked', action: 'merge', num: '#1040' },
    { id: 'r4', at: '2026-10-25T06:20:00.000Z', slug: 'recupero dal server', reason: 'l5_blocked', action: 'merge', num: 1578 },
    { id: 'r5', at: '2026-10-25T06:30:00.000Z', slug: 'recupero dal server', reason: 'l5_blocked', action: 'merge' },
  ];
  await page.evaluate((r) => window.__mgTest.renderChannelLog(r, []), rej);

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('fusione fermata dai controlli di sicurezza · #1040 · recupero dal server');
  await expect(rows.nth(1)).toContainText('fusione fermata dai controlli di sicurezza · #1578');
  await expect(rows.nth(0)).toContainText('fusione fermata dai controlli di sicurezza · recupero dal server');
  await expect(page.locator('#mgChannelList')).not.toContainText('l5_blocked');
  await expect(page.locator('#mgChannelList')).not.toContainText('##');
});

// #1653: un lavoro fidato o pre-approvato si fonde sopra il blocco, che si registra soltanto: non deve leggersi come fermo.
test('un blocco dei controlli su un lavoro che si fonde lo stesso non si legge come una fusione fermata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');

  const rej = [
    { id: 'f1', at: '2026-10-25T06:27:00.000Z', slug: 'recupero dal server', reason: 'l5_blocked', action: 'merge', num: '#1040.1', siFonde: true,
      detail: 'lavoro fidato, si fonde e si registra: guard_the_guards: firestore.rules' },
    { id: 'f2', at: '2026-10-25T06:26:00.000Z', slug: 'fusione dal server', reason: 'l5_blocked', action: 'merge', num: '#1520', siFonde: true,
      detail: 'pre-approvata dall’owner, si fonde e si registra: guard_the_guards: firestore.rules' },
    { id: 'f3', at: '2026-10-25T06:25:00.000Z', slug: 'fusione dal server', reason: 'l5_blocked', action: 'merge', num: '#1600', siFonde: false,
      detail: 'guard_the_guards: firestore.rules' },
  ];
  await page.evaluate((r) => window.__mgTest.renderChannelLog(r, []), rej);

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Registrato');
  await expect(rows.nth(0)).toContainText('lavoro fidato: la fusione prosegue · #1040.1');
  await expect(rows.nth(0)).not.toContainText('fermata');
  await expect(rows.nth(0).locator('.mg-log-role--deny')).toHaveCount(0);
  await expect(rows.nth(1)).toContainText('pre-approvata dall’owner: la fusione prosegue · #1520');
  await expect(rows.nth(1)).not.toContainText('Respinto');
  // Un blocco che ferma davvero resta un rifiuto.
  await expect(rows.nth(2)).toContainText('Respinto');
  await expect(rows.nth(2)).toContainText('fusione fermata dai controlli di sicurezza · #1600');
});

test('i confronti dicono quando le due strade scelgono lo stesso lavoro e quando no', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await apriScheda(page, 'log');

  await page.evaluate(({ rej, cmp }) => window.__mgTest.renderChannelLog(rej, cmp), { rej: [], cmp: COMPARISONS });

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(2);

  // Accordo: una riga sola col lavoro scelto.
  await expect(rows.nth(0)).toContainText('Accordo');
  await expect(rows.nth(0)).toContainText('Nuovo lavoro');
  await expect(rows.nth(0)).toContainText('#500');

  // Disaccordo: si vedono ENTRAMBE le scelte, e il perché la differenza è attesa.
  await expect(rows.nth(1)).toContainText('Scelte diverse');
  await expect(rows.nth(1)).toContainText('Verifica');
  await expect(rows.nth(1)).toContainText('#490');
  await expect(rows.nth(1)).toContainText('Nuovo lavoro');
  await expect(rows.nth(1)).toContainText('il server non vede ancora lo stato dei rami');

  // Mai il nome interno del ruolo.
  await expect(page.locator('#mgChannelList')).not.toContainText('new-work');
});

test('senza rifiuti e senza confronti il blocco lo dice, invece di restare vuoto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await apriScheda(page, 'log');

  await page.evaluate(() => window.__mgTest.renderChannelLog([], []));

  await expect(page.locator('#mgChannelSection')).toBeVisible();
  await expect(page.locator('#mgChannelEmpty')).toBeVisible();
  await expect(page.locator('#mgChannelList')).toBeHidden();
});

// #958: una prova degli unit sulla fusione che manca sempre non protegge niente. Le richieste senza prova si vedono
// una per una, e quando il server le giudica frequenti un avviso sta in cima al blocco.
const PROVE = {
  righe: [
    { at: '2026-10-04T10:00:00.000Z', via: 'routine', slug: 'notturna', branch: 'worker/42', esito: 'non_provata',
      motivo: 'fusione di prova non riuscita (fatal: refusing to merge unrelated histories)', storia: { superficiale: true, approfondito: 0, intera: false } },
    { at: '2026-10-04T09:00:00.000Z', via: 'routine', slug: 'notturna', branch: 'worker/41', esito: 'verde', mainSha: 'b'.repeat(40) },
    { at: '2026-10-04T08:00:00.000Z', via: 'locale', branch: 'claude/x', esito: 'assente' },
  ],
  riepilogo: { ultime: 3, senzaProva: 2, frequente: true },
};

test('le fusioni senza prova degli unit compaiono all owner, e quando sono frequenti un avviso sta in cima', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');

  await page.evaluate((prove) => window.__mgTest.renderChannelLog([], [], prove), PROVE);
  const rows = page.locator('#mgChannelList .mg-log-row');
  // L'avviso più le due richieste senza prova: quella provata non è una notizia.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('2 delle ultime 3 richieste di fusione');
  await expect(rows.nth(0).locator('.mg-log-role--deny')).toHaveCount(1);
  await expect(rows.nth(1)).toContainText('Senza prova');
  await expect(rows.nth(1)).toContainText('worker/42');
  await expect(rows.nth(1)).toContainText('unrelated histories');
  await expect(rows.nth(1)).toContainText('clone poco profondo');
  await expect(rows.nth(2)).toContainText('fusione locale');
  await expect(rows.nth(2)).toContainText('strumenti senza la prova degli unit');
  await expect(page.locator('#mgChannelList')).not.toContainText('non_provata');
  await expect(page.locator('#mgChannelList')).not.toContainText('worker/41');

  // Rare: le righe restano, l'avviso no.
  await page.evaluate((prove) => window.__mgTest.renderChannelLog([], [], { ...prove, riepilogo: { ultime: 20, senzaProva: 2, frequente: false } }), PROVE);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#mgChannelList')).not.toContainText('delle ultime');
});

// #1652: una sessione che lascia il posto all'altra voce dice all'owner quale lavoro ha lasciato e per quale.
test('i posti lasciati all altra routine compaiono all owner, col lavoro lasciato e quello che aspettava', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');

  const posti = [{
    at: '2026-10-25T16:45:00.000Z', slug: 'server-a', reason: 'slot_to_other_voice', voce: 'server', altraVoce: 'normale',
    lasciato: { num: '#1499', role: 'verifier', priority: 2 }, perIl: [{ num: '#1196', role: 'secaudit', priority: 3 }], altriInAttesa: 1,
  }];
  await page.evaluate((p) => window.__mgTest.renderChannelLog([], [], null, p), posti);
  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Posto lasciato');
  await expect(rows.nth(0)).toContainText('#1499 (Verifica, p2) lasciato alla routine normale per #1196');
  await expect(rows.nth(0)).toContainText('server-a');
  await expect(page.locator('#mgChannelList')).not.toContainText('slot_to_other_voice');
  await expect(page.locator('#mgChannelList')).not.toContainText('secaudit');
});

// #1785: chi ha letto schede e testi dei feedback dal cloud lo vede l'owner, e le letture non coprono i rifiuti.
test('le letture di schede e testi compaiono coi numeri e la routine, solo le più recenti, accanto ai rifiuti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');
  const letture = Array.from({ length: 30 }, (_, i) => ({
    id: `l${i}`, at: new Date(Date.UTC(2026, 9, 29, 12, 59 - i)).toISOString(), slug: 'manutentore', role: 'manutentore',
    op: 'leggi', testi: true, schede: false, numeri: [String(800 + i)], quanti: 1,
  }));
  letture[0] = { ...letture[0], op: 'scheda', testi: false, schede: true, numeri: ['812'] };
  letture[1] = { ...letture[1], testi: false, schede: true, aperti: true, numeri: Array.from({ length: 50 }, (_, k) => String(k + 1)), quanti: 640 };
  const rej = [{ id: 'r', at: '2026-10-29T11:00:00.000Z', slug: 'manutentore', role: 'manutentore', reason: 'fuori_riservati', action: 'feedback.leggi' }];
  await page.evaluate(({ r, l }) => window.__mgTest.renderChannelLog(r, [], null, null, l), { r: rej, l: letture });

  const list = page.locator('#mgChannelList');
  await expect(list.locator('.mg-log-row')).toHaveCount(11);
  await expect(list.locator('.mg-log-row').nth(0)).toContainText('scheda scritta: #812 · manutentore');
  await expect(list).toContainText('schede lette: tutti gli aperti (640)');
  await expect(list).toContainText('testi letti: #802');
  await expect(list).not.toContainText('#829', { useInnerText: true });
  await expect(list).toContainText('testi riservati chiesti fuori dall’ambiente dei riservati');
  await expect(list).not.toContainText('fuori_riservati');
  await page.screenshot({ path: 'tests/.shots/1785-letture-log.png' });
});
