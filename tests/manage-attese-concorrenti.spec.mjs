// #1756.1: due scritture contemporanee sulle attese dello stesso feedback non si cancellano a vicenda.
// Main vero, Firestore finto nel main: fra la lettura e la scrittura del gesto dell'owner una routine scrive un'attesa
// (#14); la scrittura dell'owner trova il documento cambiato, rilegge, e l'attesa della routine resta.
import { test, expect } from './fixtures/electron.mjs';
import { resolve } from 'node:path';

const MAIN = resolve('src/main/main.js');
const MANAGE = 'filo://manage/manage.html';

// Risponde solo a quello che serve alle attese (letture con `waitsFor` nella maschera, numeri, scritture); il resto
// fallisce, così la pagina tiene i dati di prova invece di sostituirli con documenti finti a metà.
async function firestoreFinto(app) {
  await app.evaluate((_e, MAIN) => {
    const req = process.getBuiltinModule('module').createRequire(MAIN);
    const cfg = req('./auth/config');
    req('./auth/token-store').save({ refreshToken: 'rt-finto', email: cfg.adminEmails[0], name: 'Owner' });
    req('./auth/google-auth').restore();
    const docs = {
      f903: { seq: 903, v: 1, waitsFor: [{ id: 'f12', num: '12' }] },
      f12: { seq: 12, v: 1 }, f13: { seq: 13, v: 1 }, f14: { seq: 14, v: 1 },
    };
    const s = { docs, scritture: [], intanto: null };
    globalThis.__fs = s;
    const J = (st, b) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } });
    const fsDoc = (id) => {
      const d = docs[id];
      const fields = { seq: { integerValue: String(d.seq) }, subSeq: { integerValue: '0' } };
      if (d.waitsFor && d.waitsFor.length) {
        fields.waitsFor = { arrayValue: { values: d.waitsFor.map((w) => ({ mapValue: { fields: { id: { stringValue: w.id }, num: { stringValue: w.num } } } })) } };
      }
      return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields, createTime: 'v0', updateTime: `v${d.v}` };
    };
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = (init.method || 'GET').toUpperCase();
      if (u.includes('securetoken')) return J(200, { id_token: 'h.eyJ1c2VyX2lkIjoib3duZXIifQ.s', refresh_token: 'rt-finto', expires_in: 3600 });
      if (u.includes(':batchGet')) {
        const corpo = JSON.parse(init.body);
        if (!(corpo.mask?.fieldPaths || []).includes('waitsFor')) return J(503, {});
        return J(200, corpo.documents.map((n) => {
          const id = n.split('/').pop();
          return docs[id] ? { found: fsDoc(id) } : { missing: n };
        }));
      }
      if (u.includes(':runQuery')) {
        const f = JSON.parse(init.body).structuredQuery?.where?.fieldFilter;
        if (f?.field?.fieldPath !== 'seq') return J(503, {});
        return J(200, Object.keys(docs).filter((id) => String(docs[id].seq) === f.value.integerValue).map((id) => ({ document: fsDoc(id) })));
      }
      if (m === 'PATCH' && u.includes('/documents/feedback/')) {
        const q = new URL(u).searchParams;
        const id = decodeURIComponent(new URL(u).pathname.split('/feedback/')[1]);
        // La routine scrive adesso: dopo la lettura dell'owner, prima della sua scrittura.
        if (s.intanto) { const f = s.intanto; s.intanto = null; f(docs); }
        const d = docs[id];
        const condizione = q.get('currentDocument.updateTime');
        s.scritture.push({ id, condizione });
        if (condizione && condizione !== `v${d.v}`) {
          return J(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'the stored version does not match the required base version' } });
        }
        if (q.getAll('updateMask.fieldPaths').includes('waitsFor')) {
          d.waitsFor = (JSON.parse(init.body).fields.waitsFor?.arrayValue?.values || [])
            .map((x) => ({ id: x.mapValue.fields.id.stringValue, num: x.mapValue.fields.num.stringValue }));
        }
        d.v += 1;
        return J(200, fsDoc(id));
      }
      return J(503, {});
    };
  }, MAIN);
}

const routineScrive = (app, num) => app.evaluate((_e, num) => {
  globalThis.__fs.intanto = (docs) => { docs.f903.waitsFor.push({ id: `f${num}`, num: String(num) }); docs.f903.v += 1; };
}, num);
const sulServer = (app) => app.evaluate(() => globalThis.__fs.docs.f903.waitsFor.map((w) => w.num));

function fb(over = {}) {
  return Object.assign({
    _id: 'f903', name: 'La pratica che aspetta', text: 'Testo.', seq: 903, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'owner:me', senderProof: 'admin',
    createdAt: '2026-10-01T07:00:00Z', images: [], waitsFor: [{ id: 'f12', num: '12' }],
  }, over);
}
const LISTA = [fb(), ...[12, 13, 14].map((n) => fb({ _id: `f${n}`, seq: n, name: `Il ${n}`, waitsFor: undefined }))];

async function apri(app, openTab) {
  await firestoreFinto(app);
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, LISTA);
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  return page;
}

test('l\'owner toglie #12 mentre una routine aggiunge #14: resta #14, non «niente»', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await routineScrive(app, 14);
  await page.locator('#mgAtteseLista .mg-attesa', { hasText: '#12' }).locator('.mg-attesa-togli').click();
  await expect(page.locator('#mgManageMsg')).toHaveText(/Da ora #903 aspetta #14/);
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  await expect(page.locator('#mgAtteseLista')).toContainText('#14');
  expect(await sulServer(app)).toEqual(['14']);
  const scritture = await app.evaluate(() => globalThis.__fs.scritture);
  expect(scritture.map((w) => w.condizione)).toEqual(['v1', 'v2']);
});

test('l\'owner aggiunge #13 mentre una routine aggiunge #14: restano tutte e tre', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await routineScrive(app, 14);
  await page.locator('#mgAtteseInput').fill('13');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(page.locator('#mgManageMsg')).toHaveText(/Da ora #903 aspetta #12, #14, #13/);
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(3);
  expect(await sulServer(app)).toEqual(['12', '14', '13']);
});

test('«Non aspettare più» toglie quelle che l\'owner vede, non quella scritta intanto dalla routine', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await routineScrive(app, 14);
  await page.locator('.mg-tab[data-tab="waiting"]').click();
  await page.locator('.mg-item[data-id="f903"]').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Non aspettare più' }).click();
  await expect(page.locator('#mgManageMsg')).toHaveText(/Da ora #903 aspetta #14/);
  expect(await sulServer(app)).toEqual(['14']);
});
