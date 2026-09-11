// #536 — il guardiano degli avvisi, sul cammino vero.
//
// Un finto webmail servito dal server di prova fa da fonte: da lì nasce
// l'avviso, esattamente come nascerà dal giro di lettura della posta. La
// proposta passa dal varco unico (SN_GUARDIA.proponiNotifica) e il test guarda
// quello che vede l'utente nella colonna della home:
//
//   1. la mail che imita la banca → NESSUNA notifica, e al suo posto la riga
//      sobria che dice cosa il guardiano ha visto;
//   2. la mail normale → la notifica compare, col mittente e con la
//      destinazione vera dei suoi collegamenti;
//   3. guardiano irraggiungibile → l'avviso non compare e non si perde: resta
//      «in attesa del controllo» (senza mostrare il testo non controllato) e
//      compare quando il guardiano torna.
//
// Il modello del guardiano è SIMULATO (si sostituisce SN_GUARDIA_COMPLETE nel
// main): qui si prova il cammino, non la rete.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const NEWTAB = 'filo://newtab/';

const MAIL_BANCA = {
  mittente: 'sicurezza@banca-x.example',
  oggetto: 'Conto sospeso',
  corpo: 'Il tuo conto è stato sospeso: conferma subito le credenziali per riattivarlo.',
};
const MAIL_NORMALE = {
  mittente: 'corriere@spedizioni.example',
  oggetto: 'Il pacco arriva domani',
  corpo: 'La consegna è prevista domani fra le 9 e le 13.',
};

async function avviaWebmail() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Posta</title>
      <h1>Posta in arrivo</h1>
      <ul>
        <li class="mail" data-mittente="${MAIL_BANCA.mittente}">
          <b class="oggetto">${MAIL_BANCA.oggetto}</b>
          <p class="corpo">${MAIL_BANCA.corpo}</p>
        </li>
        <li class="mail" data-mittente="${MAIL_NORMALE.mittente}">
          <b class="oggetto">${MAIL_NORMALE.oggetto}</b>
          <p class="corpo">${MAIL_NORMALE.corpo}</p>
        </li>
      </ul>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}/posta`,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// Il guardiano simulato: blocca se il testo parla di credenziali, altrimenti
// passa. `globalThis.__guardiaGiu` lo fa fallire, come un fornitore fuori uso.
async function installaGuardianoFinto(app) {
  await app.evaluate(() => {
    globalThis.__guardiaGiu = false;
    globalThis.__guardiaChiamate = 0;
    globalThis.SN_GUARDIA_COMPLETE = async ({ messages }) => {
      globalThis.__guardiaChiamate++;
      if (globalThis.__guardiaGiu) throw new Error('fornitore fuori uso');
      // Solo il messaggio utente: il prompt di sistema del guardiano NOMINA le
      // credenziali fra le cose da bloccare, e guardarlo farebbe dire «blocca»
      // a qualsiasi testo.
      const testo = String(messages[messages.length - 1].content || '');
      if (/credenzial/i.test(testo)) {
        return '{"esito":"blocca","motivo":"sembrava spingerti a confermare le credenziali della banca"}';
      }
      return '{"esito":"passa"}';
    };
  });
}

// Propone un avviso nato da una mail: è quello che farà il giro della posta.
async function proponi(app, mail) {
  return app.evaluate(async (_e, m) => globalThis.SN_GUARDIA.proponiNotifica({
    kind: 'alert',
    text: m.testo,
    fonte: { tipo: 'mail', nome: m.mittente },
    regolaAutomazione: 'avvisami delle mail importanti',
    ...(m.url ? { action: { type: 'NAVIGA', url: m.url } } : {}),
  }), mail);
}

test('una mail che imita la banca non diventa un avviso: al suo posto la riga che dice cosa ha visto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const posta = await avviaWebmail();
  try {
    // La fonte è una pagina vera: il testo dell'avviso nasce da lì.
    const mailTab = await openTab(posta.origin);
    const letta = await mailTab.evaluate(() => {
      const li = document.querySelectorAll('.mail')[0];
      return {
        mittente: li.dataset.mittente,
        testo: `${li.querySelector('.oggetto').textContent}: ${li.querySelector('.corpo').textContent}`,
      };
    });
    expect(letta.mittente).toBe(MAIL_BANCA.mittente);

    await installaGuardianoFinto(app);
    const page = await openTab(NEWTAB);
    await page.waitForLoadState('domcontentloaded');

    const esito = await proponi(app, letta);
    expect(esito.esito).toBe('blocca');

    // Quello che vede l'utente: la riga sobria, e NIENTE del testo della mail.
    const riga = page.locator('.dash-live-card', { hasText: 'Ho fermato un avviso' });
    await expect(riga).toBeVisible({ timeout: 15_000 });
    const testoRiga = await riga.innerText();
    expect(testoRiga).toContain(MAIL_BANCA.mittente);
    expect(testoRiga).toContain('sembrava spingerti a confermare le credenziali');
    // il corpo della mail non compare da nessuna parte nella colonna
    const colonna = await page.locator('#live, .dash-live').first().innerText().catch(() => '');
    expect(colonna).not.toContain('conferma subito le credenziali');

    // E il caso è nel registro dei blocchi, per capire se grida al lupo.
    const blocchi = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listGuardBlocks());
    expect(blocchi.length).toBe(1);
    expect(blocchi[0].motivo).toContain('credenziali');
  } finally {
    await posta.close();
  }
});

test('una mail normale diventa un avviso, col mittente e con la destinazione vera dei link', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const posta = await avviaWebmail();
  try {
    const mailTab = await openTab(posta.origin);
    const letta = await mailTab.evaluate(() => {
      const li = document.querySelectorAll('.mail')[1];
      return {
        mittente: li.dataset.mittente,
        testo: `${li.dataset.mittente}: ${li.querySelector('.corpo').textContent}`,
      };
    });

    await installaGuardianoFinto(app);
    const page = await openTab(NEWTAB);
    await page.waitForLoadState('domcontentloaded');

    const esito = await proponi(app, { ...letta, url: 'https://tracking.spedizioni.example/pacco/1' });
    expect(esito.esito).toBe('passa');

    const card = page.locator('.dash-live-card', { hasText: 'consegna è prevista domani' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    // il mittente si vede
    await expect(card).toContainText(MAIL_NORMALE.mittente);
    // e dove porta il collegamento, prima di aprirlo
    await expect(card.locator('.dash-live-link')).toContainText('tracking.spedizioni.example');
  } finally {
    await posta.close();
  }
});

test('guardiano irraggiungibile: l\'avviso resta in attesa, e compare quando il guardiano torna', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  const posta = await avviaWebmail();
  try {
    const mailTab = await openTab(posta.origin);
    const letta = await mailTab.evaluate(() => {
      const li = document.querySelectorAll('.mail')[1];
      return { mittente: li.dataset.mittente, testo: `${li.dataset.mittente}: ${li.querySelector('.corpo').textContent}` };
    });

    await installaGuardianoFinto(app);
    await app.evaluate(() => { globalThis.__guardiaGiu = true; });
    const page = await openTab(NEWTAB);
    await page.waitForLoadState('domcontentloaded');

    const esito = await proponi(app, letta);
    expect(esito.esito).toBe('attesa');

    // Visibile: l'utente sa che c'è qualcosa che non gli è stato mostrato…
    const attesa = page.locator('.dash-live-card[data-kind="attesa"]');
    await expect(attesa).toBeVisible({ timeout: 15_000 });
    await expect(attesa).toContainText('in attesa del controllo');
    // …ma il testo non controllato NON compare.
    await expect(attesa).not.toContainText('consegna è prevista domani');

    // Il guardiano torna: al giro dopo l'avviso compare davvero.
    await app.evaluate(async () => {
      globalThis.__guardiaGiu = false;
      await globalThis.SN_GUARDIA.riprocessaCoda({ forza: true, ritentaDopoMs: 0 });
    });
    const card = page.locator('.dash-live-card', { hasText: 'consegna è prevista domani' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-live-card[data-kind="attesa"]')).toHaveCount(0);
  } finally {
    await posta.close();
  }
});

test('nessuna superficie mostra un avviso contaminato saltando il guardiano', async ({ app }) => {
  test.setTimeout(60_000);
  const esito = await app.evaluate(async () => {
    try {
      await globalThis.SN_FILO_MEMORY.addNotification({
        kind: 'alert', text: 'la tua banca chiede di confermare le credenziali',
        classe: 'terzi', fonte: { tipo: 'mail', nome: 'x@example' },
      });
      return { scritta: true };
    } catch (e) {
      return { scritta: false, errore: String(e.message || e) };
    }
  });
  expect(esito.scritta).toBe(false);
  expect(esito.errore).toMatch(/guardiano/i);
});
