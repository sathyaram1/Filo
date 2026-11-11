// #2199.6 giro 1: il sì in Gestione dentro Filo, dalla pagina al main VERO e al server finto (fetch del main), legge la
// frase che dice dove va davvero il lavoro del server. Solo il canale verso GitHub/Firebase è finto, e l'accesso owner.

import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const ID = 'ab12cd34ef56ab12cd34ef56';
const GIORNO = 24 * 60 * 60 * 1000;

function richiesta() {
  return {
    id: ID, branch: 'claude/lavoro-server', sha: 'a1b2c3d4'.repeat(5), who: 'owner@esempio',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + GIORNO, expired: false, used: false, discarded: false,
  };
}

// Il main parla col server finto: owner con accesso, e ogni chiamata a ownerMergeApprovals risponde da qui.
async function serverFinto(app, approva) {
  await app.evaluate((_e, cfg) => {
    const rq = process.mainModule.require;
    const auth = rq(rq('node:path').join(process.cwd(), 'src/main/auth/google-auth.js'));
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getIdToken = async () => 'token-di-prova';
    const vero = globalThis.__fetchVero2199 || globalThis.fetch;
    globalThis.__fetchVero2199 = vero;
    globalThis.__chiamate2199 = [];
    let usata = false;
    globalThis.fetch = async (url, init) => {
      if (!String(url).endsWith('/ownerMergeApprovals')) return vero(url, init);
      const data = (JSON.parse(String(init && init.body || '{}')).data) || {};
      globalThis.__chiamate2199.push(data.op);
      let result;
      if (data.op === 'list') result = { ok: true, pending: usata ? [] : [cfg.req], failed: [], recent: [], ttlMs: 7 * 86400000 };
      else if (data.op === 'approve') {
        result = usata ? { ok: false, rejected: true, reason: 'already_used', detail: 'richiesta già stata usata' } : cfg.approva;
        usata = true;
      } else result = { ok: true };
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { req: richiesta(), approva });
}

async function apriConCard(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'automation');
  const btn = page.locator('#mgMergeApprovalsOrphans .sn-mac-btn-go');
  await expect(btn).toBeVisible({ timeout: 10_000 });
  return btn;
}

for (const [esito, frase] of [['rimandato', /torna alle routine/], ['all_owner', /torna a te/]]) {
  test(`il sì a un lavoro del server con esito «${esito}»: Gestione in Filo dice dove va il lavoro`, async ({ app, openTab }) => {
    await serverFinto(app, { ok: true, result: 'server', esito });
    const page = await openTab(MANAGE);
    const btn = await apriConCard(page);
    await btn.click();
    await btn.click();
    const stato = page.locator('#mgMergeApprovalsOrphans .sn-mac-status');
    await expect(stato).toContainText(frase, { timeout: 10_000 });
    await expect(stato).not.toContainText(/il server riprende/);
    expect(await app.evaluate(() => globalThis.__chiamate2199)).toContain('approve');
  });
}

test('esplora: dopo «rimandato» il tasto', async ({ app, openTab }) => {
  await serverFinto(app, { ok: true, result: 'server', esito: 'rimandato' });
  const page = await openTab(MANAGE);
  const btn = await apriConCard(page);
  await btn.click();
  await btn.click();
  const stato = page.locator('#mgMergeApprovalsOrphans .sn-mac-status');
  await expect(stato).toContainText(/torna alle routine/, { timeout: 10_000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const b = document.querySelector('#mgMergeApprovalsOrphans .sn-mac-btn-go');
    const c = document.querySelector('#mgMergeApprovalsOrphans .sn-mac-card');
    return { c: !!c, dis: b ? b.disabled : null, cls: c ? c.className : '', st: (document.querySelector('#mgMergeApprovalsOrphans .sn-mac-status') || {}).textContent };
  });
  console.log('ESPLORA', JSON.stringify(info), JSON.stringify(await app.evaluate(() => globalThis.__chiamate2199)));
});
