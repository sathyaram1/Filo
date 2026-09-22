// Prove del giro 2 (verifica locale) sul lavoro «giri stretti»: le tre porte del
// giro 1 ri-provate da fuori. Il diff della chiusura si prova su un repo git vero,
// la lettura della config con la rete finta, l'interruttore nella pagina vera.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const carica = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href);

function repoFinto(nome) {
  const dir = join(cartellaTemporanea(nome), 'repo');
  mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const scrivi = (f, t, msg) => { writeFileSync(join(dir, f), t); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'prova@example.invalid');
  g('config', 'user.name', 'prova');
  g('config', 'commit.gpgsign', 'false');
  return { dir, g, scrivi };
}

test.describe('il diff della chiusura dopo che main si è mosso', () => {
  test('dopo il riallineamento il commit di partenza è il gemello, e il diff mostra solo la correzione', async () => {
    const v = await carica('scripts/verify-local.mjs');
    const { dir, g, scrivi } = repoFinto('giri-stretti-g2-rebase');
    scrivi('base.txt', 'base\n', 'base');
    g('checkout', '-q', '-b', 'claude/lavoro');
    scrivi('lavoro.txt', 'lavoro\n', 'il lavoro');
    const critica = scrivi('prova.spec.txt', 'prove del giro\n', 'verifica giro 1: prove'); // la punta alla critica
    scrivi('lavoro.txt', 'lavoro corretto\n', 'la correzione');
    // main avanza di tre commit su file suoi.
    g('checkout', '-q', 'main');
    for (const n of [1, 2, 3]) scrivi(`main${n}.txt`, `main ${n}\n`, `main ${n}`);
    g('checkout', '-q', 'claude/lavoro');

    // Prima del riallineamento il commit è ancora nel ramo: resta quello.
    expect(v.shaPrimaAllineato(critica, dir, 'main')).toBe(critica);

    g('rebase', '-q', 'main');
    const gemello = v.shaPrimaAllineato(critica, dir, 'main');
    expect(gemello).toMatch(/^[0-9a-f]{40}$/);
    expect(gemello).not.toBe(critica);
    expect(g('log', '-1', '--format=%s', gemello)).toBe('verifica giro 1: prove');
    // Quello che legge chi verifica: la sola correzione, niente di main.
    expect(g('diff', '--name-only', `${gemello}..HEAD`).split('\n')).toEqual(['lavoro.txt']);
    // Il vecchio commit avrebbe portato dentro main: è la porta del giro 1.
    expect(g('diff', '--name-only', `${critica}..HEAD`)).toContain('main1.txt');

    // Rilanciare l'avvio (secondo riallineamento, main avanza ancora) non perde il filo.
    g('checkout', '-q', 'main');
    scrivi('main4.txt', 'main 4\n', 'main 4');
    g('checkout', '-q', 'claude/lavoro');
    g('rebase', '-q', 'main');
    const gemello2 = v.shaPrimaAllineato(gemello, dir, 'main');
    expect(g('diff', '--name-only', `${gemello2}..HEAD`).split('\n')).toEqual(['lavoro.txt']);
  });

  test('un commit di partenza che non si ritrova non diventa un comando sbagliato: il compito lo dice', async () => {
    const v = await carica('scripts/verify-local.mjs');
    const { dir, g, scrivi } = repoFinto('giri-stretti-g2-perso');
    scrivi('base.txt', 'base\n', 'base');
    g('checkout', '-q', '-b', 'claude/lavoro');
    scrivi('lavoro.txt', 'lavoro\n', 'il lavoro');
    expect(v.shaPrimaAllineato('f'.repeat(40), dir, 'main')).toBe('');
    expect(v.shaPrimaAllineato('non-uno-sha; rm -rf /', dir, 'main')).toBe('');
    const brief = v.buildVerifierBrief({
      request: 'x', branch: 'claude/lavoro', recipe: v.readRecipe(ROOT, 'chiusura'), history: [], scope: 'chiusura',
      perimetro: { rilievi: [{ level: 2, text: 'Il pulsante non salva' }], shaPrima: '' },
    });
    const nota = brief.slice(brief.lastIndexOf('## Perimetro di questo giro'));
    expect(nota).toContain('non comunicato');
    expect(nota).not.toContain('git diff ..HEAD');
  });
});

test.describe('la config letta senza rete', () => {
  const D = createRequire(import.meta.url)(resolve(ROOT, 'src/main/services/defaultsStore.js'));
  const conFetch = async (finto, fn) => {
    const vero = globalThis.fetch;
    globalThis.fetch = finto;
    try { return await fn(); } finally { globalThis.fetch = vero; }
  };
  const risposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (corpo === undefined) throw new Error('non è JSON'); return corpo; }, text: async () => '' });

  test('rete giù, errore del server o risposta illeggibile: «non letto», mai «spento»', async () => {
    for (const finto of [async () => { throw new Error('offline'); }, async () => risposta(500, {}), async () => risposta(403, {}), async () => risposta(200, undefined)]) {
      await expect(conFetch(finto, () => D.getRoutineCaps('tok'))).rejects.toThrow(/non raggiungibili/);
    }
  });

  test('letto davvero: acceso solo con un vero esplicito', async () => {
    const doc = (fields) => async () => risposta(200, { fields });
    expect((await conFetch(doc({ giroStretto: { booleanValue: true }, cap2: { integerValue: '3' } }), () => D.getRoutineCaps('tok'))).giroStretto).toBe(true);
    for (const storto of [{ stringValue: 'true' }, { integerValue: '1' }, { booleanValue: false }]) {
      expect((await conFetch(doc({ giroStretto: storto }), () => D.getRoutineCaps('tok'))).giroStretto).toBe(false);
    }
    expect((await conFetch(doc({}), () => D.getRoutineCaps('tok'))).giroStretto).toBe(false);
  });

  test('salvato ma non riletto: torna quello che ho scritto, non «spento»', async () => {
    const finto = async (url, opt) => (opt && opt.method === 'PATCH' ? risposta(200, {}) : Promise.reject(new Error('offline')));
    const r = await conFetch(finto, () => D.setRoutineCaps({ giroStretto: true }, 'tok'));
    expect(r.giroStretto).toBe(true);
    // Non scritto e non riletto: è un fallimento, non un «salvato».
    const giu = async () => { throw new Error('offline'); };
    await expect(conFetch(giu, () => D.setRoutineCaps({ giroStretto: true }, 'tok'))).rejects.toThrow();
  });
});

test.describe('l’interruttore nella pagina, con la lettura che fallisce', () => {
  async function apri(openTab, { getFail }) {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
    await page.evaluate((fail) => {
      window.__cfg = { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: true };
      window.__getFail = fail;
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'automation_caps_get') return window.__getFail ? { ok: false, error: 'rete giù' } : { ok: true, ...window.__cfg };
        if (msg && msg.type === 'automation_caps_set') {
          if (window.__setFail) return { ok: false, error: 'rete giù' };
          if (typeof msg.giroStretto === 'boolean') window.__cfg.giroStretto = msg.giroStretto;
          // Salvato ma non riletto: il main risponde coi soli campi scritti.
          if (window.__getFail) return { ok: true, cap2: null, cap1: null, cap0: null, fixInstructions: '', giroStretto: msg.giroStretto === true };
          return { ok: true, ...window.__cfg };
        }
        return orig(msg);
      };
    }, getFail);
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.loadCaps());
    return page;
  }

  test('aperta senza rete dice che non ha letto; tornata la rete mostra lo stato vero e toglie l’avviso', async ({ openTab }) => {
    const page = await apri(openTab, { getFail: true });
    const giro = page.locator('#mgGiroStretto');
    const msg = page.locator('#mgGiroStrettoMsg');
    await expect(msg).toContainText('Non letto dal server');
    await expect(msg).toBeVisible();
    await page.locator('#mgGiroStrettoBlock').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/verifica-giri-stretti-g2-non-letto.png' });

    await page.evaluate(() => { window.__getFail = false; });
    await page.evaluate(() => window.__mgTest.loadCaps());
    await expect(giro).toBeChecked(); // sul server è acceso
    await expect(msg).toHaveText('');
  });

  test('salvataggio riuscito con rilettura fallita: resta acceso, con «Salvato.»', async ({ openTab }) => {
    const page = await apri(openTab, { getFail: false });
    const giro = page.locator('#mgGiroStretto');
    await expect(giro).toBeChecked();
    await page.locator('#mgGiroStrettoSwitch').click(); // spengo, tutto regolare
    await expect(giro).not.toBeChecked();
    await page.evaluate(() => { window.__getFail = true; });
    await page.locator('#mgGiroStrettoSwitch').click(); // riaccendo: scritto, non riletto
    await expect(page.locator('#mgGiroStrettoMsg')).toHaveText('Salvato.');
    await expect(giro).toBeChecked();
    expect(await page.evaluate(() => window.__cfg.giroStretto)).toBe(true);
  });

  test('salvare un bilancio mentre la rilettura fallisce non spegne l’interruttore', async ({ openTab }) => {
    const page = await apri(openTab, { getFail: false });
    const giro = page.locator('#mgGiroStretto');
    await expect(giro).toBeChecked();
    await page.evaluate(() => { window.__getFail = true; });
    await page.locator('#mgCap2').fill('4');
    await page.locator('#mgCap2Save').click();
    await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
    await expect(giro).toBeChecked();
  });
});

test.describe('fermarsi nella fase 2: chi corregge lo viene a sapere, su tutte le strade', () => {
  test('la risposta alla critica nomina la porta anche se il testo dell’owner tace o manca', async () => {
    const d = await carica('scripts/dispatch.mjs');
    for (const instructions of ['FASE 2 — adesso correggi tu. Consegna con --record-fixed.', '', undefined]) {
      const testo = d.verifierReplyText({ outcome: 'fix', phase2: { findings: [{ level: 2, decision: true, text: 'Serve una scelta' }], derived: [], instructions } });
      expect(testo).toContain('--segnala <file.md> --ferma');
      expect(testo).toMatch(/decisione dell'owner/);
      // Sta dopo i rilievi e prima del rilascio: chi legge fino in fondo la incontra.
      expect(testo.indexOf('--ferma')).toBeGreaterThan(testo.indexOf('Serve una scelta'));
    }
    // Dove non c'è niente da correggere non se ne parla.
    expect(d.verifierReplyText({ outcome: 'pass' })).not.toContain('--ferma');
  });

  test('in locale la coda dice che fermarsi così non si può, e cosa fare invece', async () => {
    const v = await carica('scripts/verify-local.mjs');
    const coda = v.codaDalServer('FASE 2 — adesso correggi tu. Se serve una decisione: --segnala <file.md> --ferma');
    const locale = coda.slice(coda.indexOf('IN LOCALE'));
    expect(locale).toContain('--ferma');
    expect(locale).toMatch(/non c'è nemmeno/);
    expect(locale).toMatch(/report/);
  });

  test('la strada gemella della consegna (canale diretto) ha la stessa regola', async () => {
    const dir = cartellaTemporanea('giri-stretti-g2-stop');
    const seg = join(dir, 'seg.md');
    writeFileSync(seg, '## Problema\nprova\n');
    const canale = (args) => {
      const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/routine-channel.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_ROUTINE_SECRET: '' } });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    // Senza segnalazione, con un valore, o su un'altra consegna: non parte.
    for (const args of [
      ['deliver', 'biglietto-finto', 'fixed', '--report', 'r', '--stop'],
      ['deliver', 'biglietto-finto', 'fixed', '--report', 'r', '--segnala', seg, '--stop', 'forse'],
      ['deliver', 'biglietto-finto', 'verdict', '--verdict', 'pass', '--segnala', seg, '--stop'],
      ['deliver', 'biglietto-finto', 'status', '--status', 'review', '--segnala', seg, '--stop'],
    ]) {
      const r = canale(args);
      expect(r.code, args.join(' ')).toBe(1);
      // Un valore dopo --stop viene respinto già come argomento di troppo: basta che non consegni.
      expect(r.out, args.join(' ')).toMatch(/--stop vale solo su deliver fixed|Argomento non capito/);
    }
  });
});
