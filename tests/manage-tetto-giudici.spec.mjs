// Gestione → Automazioni, il tetto di spesa dei giudici per i non fidati (#1515), sul main vero con un Firestore finto:
// 2 $ e 40.000 caratteri di fabbrica, la spesa di oggi accanto al tetto, un valore nuovo che arriva in
// config/automation e si ritrova riaprendo, un valore storto che non parte, una spesa ignota che non è uno zero.
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

async function preparaServer(app, { automation = {}, contatore = null, contatoreGiu = false } = {}) {
  await app.evaluate(async (electron, cfg) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const oggi = new Date().toISOString().slice(0, 10);
    const docs = { 'config/automation': { ...cfg.automation } };
    if (cfg.contatore) docs['identities/spesa-giudici'] = { giorno: oggi, ...cfg.contatore };
    const g = globalThis.__g1515 = { docs, patch: [] };
    const toFs = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
      : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
    const risposta = (status, corpo) => ({ ok: status < 300, status, headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      const u = new globalThis.URL(String(url));
      const percorso = decodeURIComponent(u.pathname.split('/documents/')[1] || '');
      if (!['config/automation', 'identities/spesa-giudici'].includes(percorso)) return risposta(503, {});
      if ((init.method || 'GET') === 'PATCH') {
        const maschera = u.searchParams.getAll('updateMask.fieldPaths');
        const corpo = JSON.parse(init.body).fields || {};
        g.patch.push({ percorso, maschera });
        g.docs[percorso] = g.docs[percorso] || {};
        for (const k of maschera) {
          const v = corpo[k];
          g.docs[percorso][k] = 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : Object.values(v)[0];
        }
        return risposta(200, {});
      }
      if (percorso === 'identities/spesa-giudici' && cfg.contatoreGiu) throw new Error('offline');
      if (!g.docs[percorso]) return risposta(404, {});
      const fields = {};
      for (const [k, v] of Object.entries(g.docs[percorso])) fields[k] = toFs(v);
      return risposta(200, { fields });
    };
  }, { automation, contatore, contatoreGiu });
}

const sulServer = (app) => app.evaluate(() => globalThis.__g1515.docs['config/automation']);
const scritture = (app) => app.evaluate(() => globalThis.__g1515.patch);

async function pronta(page) {
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_SPESA_GIUDICI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await apriScheda(page, 'automation');
  await expect(page.locator('#panel-automation')).not.toHaveClass(/mg-in-lettura/);
  return page;
}
const apri = async (openTab) => pronta(await openTab(URL));

test('di fabbrica 2 $ e 40.000 caratteri, la spesa di oggi accanto al tetto, e un valore nuovo arriva in config/automation', async ({ app, openTab }) => {
  await preparaServer(app, { automation: { enabled: false }, contatore: { spesoUsd: 0.42 } });
  let page = await apri(openTab);

  await expect(page.locator('#mgJudgeBudget')).toHaveValue('2');
  await expect(page.locator('#mgJudgeChars')).toHaveValue('40000');
  await expect(page.locator('#mgJudgeSpesaTesto')).toHaveText('Oggi: 0,42 $ su 2,00 $');
  await expect(page.locator('#mgJudgeSpesaBarra')).toBeVisible();
  await expect(page.locator('#mgJudgeSpesaNota')).toBeHidden();
  await expect(page.locator('#mgJudgeSpesa')).toHaveAttribute('title', /Il contatore riparte da zero alle \d{2}:\d{2}\./);
  await page.locator('#mgJudgeBudgetBlock').screenshot({ path: 'tests/.shots/1515-tetto-giudici.png' });
  await page.locator('#mgJudgeCharsBlock').screenshot({ path: 'tests/.shots/1515-lunghezza.png' });

  // Invio salva il tetto; la riga della spesa segue il tetto nuovo.
  await page.locator('#mgJudgeBudget').fill('3.5');
  await page.locator('#mgJudgeBudget').press('Enter');
  await expect(page.locator('#mgJudgeBudgetMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgJudgeSpesaTesto')).toHaveText('Oggi: 0,42 $ su 3,50 $');
  expect(await sulServer(app)).toEqual({ enabled: false, judgeBudgetUsd: 3.5 });

  // Lasciare il campo salva la lunghezza, senza toccare il tetto.
  await page.locator('#mgJudgeChars').fill('60000');
  await page.locator('#mgJudgeBudgetBlock .mg-auto-field-label').click();
  await expect(page.locator('#mgJudgeCharsMsg')).toHaveText('Salvato.');
  expect(await sulServer(app)).toEqual({ enabled: false, judgeBudgetUsd: 3.5, judgeMaxChars: 60000 });
  expect(await scritture(app)).toEqual([
    { percorso: 'config/automation', maschera: ['judgeBudgetUsd'] },
    { percorso: 'config/automation', maschera: ['judgeMaxChars'] },
  ]);

  // «Rimetti com'era» riporta il tetto di prima, sul server.
  await page.locator('#mgJudgeBudgetRimetti').click();
  await expect(page.locator('#mgJudgeBudgetMsg')).toHaveText('Rimesso com’era.');
  await expect(page.locator('#mgJudgeBudget')).toHaveValue('2');
  expect((await sulServer(app)).judgeBudgetUsd).toBe(2);

  await page.reload();
  page = await pronta(page);
  await expect(page.locator('#mgJudgeBudget')).toHaveValue('2');
  await expect(page.locator('#mgJudgeChars')).toHaveValue('60000');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#mgJudgeBudgetBlock').screenshot({ path: 'tests/.shots/1515-tetto-giudici-scuro.png' });
});

test('tetto pieno: lo dice senza hover, con l\'ora in cui riparte', async ({ app, openTab }) => {
  await preparaServer(app, { automation: { judgeBudgetUsd: 2 }, contatore: { spesoUsd: 1.95, prenotatoUsd: 0.1 } });
  const page = await apri(openTab);
  await expect(page.locator('#mgJudgeSpesaTesto')).toHaveText('Oggi: 1,95 $ su 2,00 $, più 0,10 $ prenotati per i giudizi in corso');
  await expect(page.locator('#mgJudgeSpesa')).toHaveClass(/is-pieno/);
  await expect(page.locator('#mgJudgeSpesaNota')).toHaveText(/^Tetto raggiunto\. I nuovi feedback dei non fidati aspettano te fino alle \d{2}:\d{2}\.$/);
  await page.locator('#mgJudgeBudgetBlock').screenshot({ path: 'tests/.shots/1515-tetto-pieno.png' });

  // Alzare il tetto toglie l'avviso subito.
  await page.locator('#mgJudgeBudget').fill('5');
  await page.locator('#mgJudgeBudgetSave').click();
  await expect(page.locator('#mgJudgeBudgetMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgJudgeSpesa')).not.toHaveClass(/is-pieno/);
  await expect(page.locator('#mgJudgeSpesaNota')).toBeHidden();
});

test('un valore storto non parte e dice perché; uno vuoto chiede un numero', async ({ app, openTab }) => {
  await preparaServer(app, { contatore: { spesoUsd: 0 } });
  const page = await apri(openTab);
  await page.locator('#mgJudgeBudget').fill('-1');
  await page.locator('#mgJudgeBudgetSave').click();
  await expect(page.locator('#mgJudgeBudgetMsg')).toHaveText('Tetto di spesa dei giudici: non può essere negativo.');
  await page.locator('#mgJudgeChars').fill('200000');
  await page.locator('#mgJudgeChars').press('Enter');
  await expect(page.locator('#mgJudgeCharsMsg')).toHaveText('Lunghezza giudicata: al massimo 130.000.');
  await page.locator('#mgJudgeChars').fill('');
  await page.locator('#mgJudgeChars').press('Enter');
  await expect(page.locator('#mgJudgeCharsMsg')).toHaveText('Lunghezza giudicata: scrivi un numero.');
  expect(await scritture(app)).toEqual([]);
});

test('la spesa che non si è potuta leggere è un trattino, non uno zero', async ({ app, openTab }) => {
  await preparaServer(app, { contatoreGiu: true });
  const page = await apri(openTab);
  await expect(page.locator('#mgJudgeSpesaTesto')).toHaveText('Oggi: — su 2,00 $');
  await expect(page.locator('#mgJudgeSpesaBarra')).toBeHidden();
  await expect(page.locator('#mgJudgeSpesaNota')).toHaveText('La spesa di oggi non si è potuta leggere.');
  // Il tetto si legge e si cambia lo stesso.
  await expect(page.locator('#mgJudgeBudget')).toHaveValue('2');
});
