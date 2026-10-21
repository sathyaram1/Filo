// Gestione → Automazioni, modello e sforzo del worker per fase (#1193), sul main vero: owner finto e un Firestore
// finto che applica la maschera foglia per foglia come quello vero (apici inversi compresi). Quello che difendono:
// la scelta arriva in config/routines.roleModels, si ritrova riaprendo la pagina, si toglie, e mai un valore non letto.
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

async function preparaServer(app, { routines = {}, owner = true, getGiu = false, ritardoGet = 0 } = {}) {
  await app.evaluate(async (electron, cfg) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    if (cfg.owner) {
      auth.getIdToken = async () => 'finto';
      auth.isAdmin = () => true;
      auth.isSignedIn = () => true;
      auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    }
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      const fields = {};
      for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    // Come Firestore: un segmento con caratteri speciali senza apici inversi è un errore, non un nome.
    const segmenti = (p) => {
      const out = [];
      let i = 0;
      while (i < p.length) {
        if (p[i] === '`') {
          let s = '';
          i += 1;
          while (i < p.length && p[i] !== '`') { if (p[i] === '\\') i += 1; s += p[i]; i += 1; }
          i += 1;
          out.push(s);
        } else {
          let j = p.indexOf('.', i);
          if (j < 0) j = p.length;
          const s = p.slice(i, j);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return null;
          out.push(s);
          i = j;
        }
        if (p[i] === '.') i += 1;
      }
      return out;
    };
    const foglia = (fields, segs) => {
      let cur = { mapValue: { fields } };
      for (const s of segs) {
        cur = cur && cur.mapValue && cur.mapValue.fields ? cur.mapValue.fields[s] : undefined;
        if (!cur) return undefined;
      }
      return cur;
    };
    const applica = (fields, segs, corpo) => {
      const v = foglia(corpo, segs);
      let cur = fields;
      for (const s of segs.slice(0, -1)) {
        if (!cur[s] || !cur[s].mapValue) {
          if (v === undefined) return;
          cur[s] = { mapValue: { fields: {} } };
        }
        cur[s].mapValue.fields = cur[s].mapValue.fields || {};
        cur = cur[s].mapValue.fields;
      }
      if (v === undefined) delete cur[segs[segs.length - 1]];
      else cur[segs[segs.length - 1]] = v;
    };
    const g = globalThis.__g1193 = { doc: { fields: toFs(cfg.routines).mapValue.fields }, maschere: [], ritardi: [], getGiu: cfg.getGiu, ritardoGet: cfg.ritardoGet };
    const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (!/documents\/config\/routines\?/.test(u)) return risposta(false, {}, 503);
      if ((init.method || 'GET') !== 'PATCH') {
        if (g.getGiu) throw new Error('offline');
        await new Promise((r) => setTimeout(r, g.ritardoGet));
        return risposta(true, JSON.parse(JSON.stringify(g.doc)));
      }
      const maschera = new URL(u).searchParams.getAll('updateMask.fieldPaths');
      const segs = maschera.map(segmenti);
      if (segs.some((s) => !s)) return risposta(false, { error: { message: 'Invalid field path' } }, 400);
      const corpo = JSON.parse(init.body).fields || {};
      for (const s of segs) applica(g.doc.fields, s, corpo);
      g.maschere.push(maschera);
      await new Promise((r) => setTimeout(r, g.ritardi.shift() || 0));
      return risposta(true, JSON.parse(JSON.stringify(g.doc)));
    };
  }, { routines, owner, getGiu, ritardoGet });
}

// Il documento del server finto, in chiaro.
async function sulServer(app) {
  const doc = await app.evaluate(() => globalThis.__g1193.doc);
  const daFs = (v) => {
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) out[k] = daFs(x);
    return out;
  };
  return daFs({ mapValue: doc });
}

async function pronta(page) {
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await apriScheda(page, 'automation');
  return page;
}
const apri = async (openTab) => pronta(await openTab(URL));
// Riaprire la pagina: niente resta in memoria, quello che si vede viene dal server.
async function riapri(page) {
  await page.reload();
  return pronta(page);
}

const tendina = (page, ruolo, campo) => page.locator('.sn-select-wrap', { has: page.locator(`select[data-ruolo="${ruolo}"][data-campo="${campo}"]`) });

async function scegli(page, ruolo, campo, voce) {
  const t = tendina(page, ruolo, campo);
  await t.locator('.sn-select-button').click();
  await t.locator('.sn-select-option', { hasText: voce }).click();
}

test('si sceglie un modello per una fase, si ritrova riaprendo la pagina, e si toglie', async ({ app, openTab }) => {
  await preparaServer(app, { routines: { enabled: true, maxSessions: 2, roleModels: { secaudit: { effort: 'high' } } } });
  let page = await apri(openTab);

  // Tutte le fasi, ognuna con le sue due tendine; quello che c'è già sul server si vede.
  await expect(page.locator('#mgRoleModels select')).toHaveCount(8);
  await expect(page.locator('#mgRoleModels .mg-role-name')).toHaveText(['Primo lavoro', 'Verifica', 'Correzione', 'Controllo cieco']);
  await expect(tendina(page, 'secaudit', 'effort').locator('.sn-select-value')).toHaveText('high');
  await expect(tendina(page, 'verifier', 'model').locator('.sn-select-value')).toHaveText('Definizione dell\'agente');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('');

  await scegli(page, 'verifier', 'model', 'Sonnet');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Verifica: salvato.');
  // Sul server la sola foglia scelta: il resto del documento e le altre fasi non si toccano.
  expect(await sulServer(app)).toEqual({ enabled: true, maxSessions: 2, roleModels: { secaudit: { effort: 'high' }, verifier: { model: 'sonnet' } } });

  // Il trattino del primo lavoro arriva al server come nome, non come espressione.
  await scegli(page, 'new-work', 'effort', 'max');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Primo lavoro: salvato.');
  expect((await sulServer(app)).roleModels['new-work']).toEqual({ effort: 'max' });
  expect(await app.evaluate(() => globalThis.__g1193.maschere)).toEqual([['roleModels.verifier.model'], ['roleModels.`new-work`.effort']]);

  page = await riapri(page);
  await expect(page.locator('select[data-ruolo="verifier"][data-campo="model"]')).toHaveValue('sonnet');
  await expect(tendina(page, 'verifier', 'model').locator('.sn-select-value')).toHaveText('Sonnet');
  await expect(page.locator('select[data-ruolo="new-work"][data-campo="effort"]')).toHaveValue('max');
  await page.locator('#mgRoleModelsBlock').screenshot({ path: 'tests/.shots/1193-modelli-per-fase.png' });

  // Tolta: torna la definizione dell'agente, e sul server la foglia non c'è più.
  await scegli(page, 'verifier', 'model', 'Definizione dell\'agente');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Verifica: salvato.');
  expect((await sulServer(app)).roleModels.verifier).toEqual({});

  page = await riapri(page);
  await expect(page.locator('select[data-ruolo="verifier"][data-campo="model"]')).toHaveValue('');
  await expect(tendina(page, 'verifier', 'model').locator('.sn-select-value')).toHaveText('Definizione dell\'agente');
  await expect(page.locator('select[data-ruolo="new-work"][data-campo="effort"]')).toHaveValue('max');

  await page.emulateMedia({ colorScheme: 'dark' });
  await scegli(page, 'fixer', 'model', 'Haiku');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Correzione: salvato.');
  await page.locator('#mgRoleModelsBlock').screenshot({ path: 'tests/.shots/1193-modelli-per-fase-scuro.png' });
});

test('«Definizione dell\'agente» si legge intera, anche nella colonna stretta', async ({ app, openTab }) => {
  await preparaServer(app);
  const page = await apri(openTab);
  for (const [w, h] of [[1536, 864], [1280, 800], [1000, 800]]) {
    await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(s[0], s[1]); }, [w, h]);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(w - 60);
    await expect(tendina(page, 'secaudit', 'effort').locator('.sn-select-value')).toHaveText('Definizione dell\'agente');
    const tagliate = await page.evaluate(() => Array.from(document.querySelectorAll('#mgRoleModels .sn-select-value'))
      .filter((v) => v.scrollWidth > v.clientWidth + 1).length);
    expect(tagliate, `${w}px`).toBe(0);
  }
  // L'ultima tendina aperta scende sotto il riquadro senza essere tagliata.
  await tendina(page, 'secaudit', 'model').locator('.sn-select-button').click();
  const pop = tendina(page, 'secaudit', 'model').locator('.sn-select-pop');
  await expect(pop).toBeVisible();
  await pop.scrollIntoViewIfNeeded();
  await expect(pop.locator('.sn-select-option')).toHaveCount(5);
  await page.screenshot({ path: 'tests/.shots/1193-tendina-aperta.png' });
});

test('due scelte di fila sulla stessa tendina: vince l\'ultima, sullo schermo e sul server', async ({ app, openTab }) => {
  await preparaServer(app);
  const page = await apri(openTab);
  await app.evaluate(() => { globalThis.__g1193.ritardi = [900, 0]; });

  await scegli(page, 'secaudit', 'model', 'Opus');
  await scegli(page, 'secaudit', 'model', 'Fable');
  // Mentre la prima risposta è per strada la tendina dice già Fable, e non torna indietro quando arriva.
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('Fable');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Controllo cieco: salvato.');
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('Fable');
  expect((await sulServer(app)).roleModels.secaudit).toEqual({ model: 'fable' });
});

test('impostazioni non lette: nessuna voce scelta, e la pagina lo dice; salvare si può e lo dice', async ({ app, openTab }) => {
  await preparaServer(app, { routines: { roleModels: { verifier: { model: 'haiku' } } }, getGiu: true });
  const page = await apri(openTab);

  await expect(page.locator('#mgRoleModelsMsg')).toContainText('Non ho potuto leggere dal server');
  // «Definizione dell'agente» sarebbe già una risposta, e non l'abbiamo.
  for (const sel of await page.locator('#mgRoleModels select').all()) {
    expect(await sel.evaluate((s) => s.selectedIndex)).toBe(-1);
  }
  await expect(tendina(page, 'verifier', 'model').locator('.sn-select-value')).toHaveText('');

  await scegli(page, 'verifier', 'effort', 'medium');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Verifica: salvato. Il resto non l\'ho potuto rileggere dal server.');
  await expect(tendina(page, 'verifier', 'effort').locator('.sn-select-value')).toHaveText('medium');
  await expect(tendina(page, 'verifier', 'model').locator('.sn-select-value')).toHaveText('');
  expect((await sulServer(app)).roleModels.verifier).toEqual({ model: 'haiku', effort: 'medium' });
});

test('un valore scritto a mano fuori elenco si vede com\'è', async ({ app, openTab }) => {
  await preparaServer(app, { routines: { roleModels: { secaudit: { model: 'claude-opus-4' } } } });
  const page = await apri(openTab);
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('claude-opus-4 (fuori elenco)');
  // Cambiarlo si può; dopo, la voce scritta a mano non resta fra le scelte.
  await scegli(page, 'secaudit', 'model', 'Sonnet');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Controllo cieco: salvato.');
  await expect(page.locator('select[data-ruolo="secaudit"][data-campo="model"] option')).toHaveCount(5);
});

test('chi non è owner vede le tendine spente, e non si aprono', async ({ app, openTab }) => {
  await preparaServer(app, { owner: false, routines: { roleModels: { verifier: { model: 'opus' } } } });
  const page = await apri(openTab);
  await expect(page.locator('select[data-ruolo="verifier"][data-campo="model"]')).toBeDisabled();
  const t = tendina(page, 'verifier', 'model');
  await t.locator('.sn-select-button').click({ force: true });
  await expect(t.locator('.sn-select-pop')).toBeHidden();
  expect(await app.evaluate(() => globalThis.__g1193.maschere)).toEqual([]);
});

test('prima che il server risponda nessun controllo delle automazioni dice un valore', async ({ app, openTab }) => {
  await preparaServer(app, { routines: { accountAOff: true, roleModels: { secaudit: { model: 'sonnet' } } }, ritardoGet: 3000 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await apriScheda(page, 'automation');
  await expect(page.locator('#panel-automation')).toHaveAttribute('aria-busy', 'true');
  // «Definizione dell'agente» e una levetta accesa sarebbero già risposte, e non le abbiamo ancora.
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('');
  const pallina = page.locator('#mgAccountA + .mg-switch-track .mg-switch-thumb');
  await expect(pallina).toBeHidden();
  await expect(page.locator('#mgRoutinesSwitch .mg-switch-state')).toBeHidden();
  await page.locator('.mg-auto-cols').screenshot({ path: 'tests/.shots/1193-in-lettura.png' });

  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('Sonnet', { timeout: 15000 });
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('#panel-automation')).not.toHaveAttribute('aria-busy', 'true');
  await expect(pallina).toBeVisible();
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
});
