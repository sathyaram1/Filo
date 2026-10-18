// Aiuti delle prove del verificatore #1193: owner finto e config/routines finto, con ritardi e rifiuti a comando.

export const PAGINA = 'filo://manage/manage.html';

export async function server(app, { routines = {}, getRitardo = 0, patchStatus = 200 } = {}) {
  await app.evaluate(async (electron, cfg) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      const fields = {};
      for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const g = globalThis.__v1193 = { doc: { fields: toFs(cfg.routines).mapValue.fields }, patch: [], getRitardo: cfg.getRitardo, patchStatus: cfg.patchStatus, patchRitardi: [] };
    const risposta = (ok, corpo, status) => ({ ok, status, headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (!/documents\/config\/routines\?/.test(u)) return risposta(false, {}, 503);
      if ((init.method || 'GET') !== 'PATCH') {
        await new Promise((r) => setTimeout(r, g.getRitardo));
        return risposta(true, JSON.parse(JSON.stringify(g.doc)), 200);
      }
      const mask = new URL(u).searchParams.getAll('updateMask.fieldPaths');
      g.patch.push({ mask, body: JSON.parse(init.body) });
      await new Promise((r) => setTimeout(r, g.patchRitardi.shift() || 0));
      if (g.patchStatus !== 200) return risposta(false, { error: { message: 'PERMISSION_DENIED' } }, g.patchStatus);
      // Solo per le sonde: applica foglie semplici ruolo.campo (trattino tolto dagli apici).
      for (const m of mask) {
        const [, ruolo, campo] = m.split('.').map((s) => s.replace(/`/g, ''));
        const body = JSON.parse(init.body).fields || {};
        const v = body.roleModels?.mapValue?.fields?.[ruolo]?.mapValue?.fields?.[campo];
        g.doc.fields.roleModels = g.doc.fields.roleModels || { mapValue: { fields: {} } };
        const rm = g.doc.fields.roleModels.mapValue.fields;
        rm[ruolo] = rm[ruolo] || { mapValue: { fields: {} } };
        if (v) rm[ruolo].mapValue.fields[campo] = v; else delete rm[ruolo].mapValue.fields[campo];
      }
      return risposta(true, JSON.parse(JSON.stringify(g.doc)), 200);
    };
  }, { routines, getRitardo, patchStatus });
}

export const tendina = (page, ruolo, campo) => page.locator('.sn-select-wrap', { has: page.locator(`select[data-ruolo="${ruolo}"][data-campo="${campo}"]`) });

export async function apri(openTab) {
  const page = await openTab(PAGINA);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page;
}

