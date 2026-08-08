// VERIFICA (verifier #403) — temporanea, black-box dal sintomo utente.
// L'AI è stubbata come in editor-summary.spec.mjs: nessuna chiave richiesta.

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const AUTO = 'Titolo Generato Auto';

async function stubAI(page) {
  await page.evaluate((auto) => {
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = 0;
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        if (msg.action === 'editor_title') { window.__aiCalls++; r = { ok: true, text: auto }; }
        else r = { ok: true, text: 'riassunto finto' };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) { if (typeof cb === 'function') { cb(r); return undefined; } return Promise.resolve(r); }
      return orig(msg, cb);
    };
  }, AUTO);
}

function longText(n) {
  const base = ['il', 'progetto', 'di', 'ricerca', 'analizza', 'i', 'dati', 'raccolti', 'sul', 'campo'];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out.join(' ');
}

// Scrive testo nel documento come farebbe l'utente (evento input reale).
async function writeWords(page, n) {
  await page.evaluate((txt) => {
    const el = document.getElementById('doc');
    el.focus();
    el.innerHTML = '<p>' + txt + '</p>';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, longText(n));
}

async function clearDoc(page) {
  await page.evaluate(() => {
    const el = document.getElementById('doc');
    el.innerHTML = '<p><br></p>';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

const title = (page) => page.locator('#docTitle').innerText();

// Rinomina dalla MATITA nel menu documenti sul documento attivo.
async function closeDocPop(page) {
  await page.evaluate(() => {
    const pop = document.getElementById('docPop');
    if (pop && !pop.hidden) {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  });
  await expect(page.locator('#docPop')).toBeHidden();
}

async function renameViaPencil(page, value, how = 'enter') {
  await closeDocPop(page);
  await page.locator('#docSwitch').click();
  await expect(page.locator('#docPop')).toBeVisible();
  await page.locator('.ed-doc-item.active .ed-doc-act[title="Rinomina"]').click();
  const input = page.locator('.ed-doc-item-input');
  await expect(input).toBeVisible();
  await input.fill(value);
  if (how === 'enter') await input.press('Enter');
  else await page.locator('#doc').click();          // blur → conferma
  await closeDocPop(page);
}

// Rinomina dal tasto destro sul titolo (docbar).
async function renameViaCtxMenu(page, value, how = 'enter') {
  await closeDocPop(page);
  await page.locator('#docbar').click({ button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  const input = page.locator('.ed-doc-title-input');
  await expect(input).toBeVisible();
  await input.fill(value);
  if (how === 'enter') await input.press('Enter');
  else await page.locator('#doc').click();
}

// Documento nuovo pulito (l'editor condivide localStorage fra le tab).
async function freshEditor(openTab) {
  const page = await openTab(EDITOR);
  await page.evaluate(() => {
    localStorage.removeItem('filo.editor.collection');
    localStorage.removeItem('filo.editor.doc');
  });
  await page.reload();
  await page.waitForSelector('#doc');
  await stubAI(page);
  return page;
}

test('sintomo: rinomina confermata a vuoto (matita) NON spegne il titolo automatico', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  expect(await title(page)).toBe('Documento senza titolo');

  await renameViaPencil(page, '', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');

  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});

test('sintomo: rinomina a vuoto confermata col CLICK ALTROVE (blur) NON spegne il titolo automatico', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  await renameViaPencil(page, '', 'blur');
  expect(await title(page)).toBe('Documento senza titolo');
  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});

test('sintomo: rinomina a vuoto dal tasto destro sul titolo NON spegne il titolo automatico', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  await renameViaCtxMenu(page, '', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');
  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});

test('stress: soli spazi / conferma del titolo di default / aperture ripetute', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  // soli spazi
  await renameViaPencil(page, '     ', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');
  // conferma esplicita del titolo di default
  await renameViaCtxMenu(page, 'Documento senza titolo', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');
  // apri/chiudi la rinomina 5 volte di fila
  for (let i = 0; i < 5; i++) await renameViaPencil(page, '', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');

  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});

test('controllo: un nome vero resta dell\'utente e l\'automatico non lo tocca', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  await renameViaPencil(page, 'Le mie note', 'enter');
  expect(await title(page)).toBe('Le mie note');
  await writeWords(page, 200);
  await page.waitForTimeout(2500);
  expect(await title(page)).toBe('Le mie note');
  expect(await page.evaluate(() => window.__aiCalls)).toBe(0);
});

test('nome dato e poi cancellato: torna senza nome e l\'automatico ridiventa possibile', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  await renameViaPencil(page, 'Bozza', 'enter');
  expect(await title(page)).toBe('Bozza');
  await renameViaPencil(page, '', 'enter');
  expect(await title(page)).toBe('Documento senza titolo');
  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});

test('stress: caratteri speciali, HTML, emoji, nome lunghissimo', async ({ openTab }) => {
  const page = await freshEditor(openTab);

  await renameViaPencil(page, '<script>window.__xss=1</script>', 'enter');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await title(page)).toBe('<script>window.__xss=1</script>');
  expect(await page.evaluate(() => document.querySelectorAll('#docTitle script').length)).toBe(0);

  await renameViaPencil(page, '🙂🎉 émoji ✅', 'enter');
  expect(await title(page)).toBe('🙂🎉 émoji ✅');

  const long = 'x'.repeat(10000);
  await renameViaPencil(page, long, 'enter');
  const t = await title(page);
  expect(t.length).toBeGreaterThan(0);
  // non deve sfondare la docbar
  const overflow = await page.evaluate(() => {
    const b = document.getElementById('docbar');
    return b.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(4);
  await page.screenshot({ path: 'tests/.shots/verify403-titolo-lungo.png' });

  // e resta comunque "manuale": nessun auto-titolo lo sovrascrive
  await writeWords(page, 200);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__aiCalls)).toBe(0);
});

test('persistenza: dopo un ricaricamento della pagina il documento senza nome riceve ancora il titolo', async ({ openTab }) => {
  const page = await freshEditor(openTab);
  await renameViaPencil(page, '', 'enter');
  await page.reload();
  await page.waitForSelector('#doc');
  await stubAI(page);
  expect(await title(page)).toBe('Documento senza titolo');
  await writeWords(page, 130);
  await expect(page.locator('#docTitle')).toHaveText(AUTO, { timeout: 10_000 });
});
