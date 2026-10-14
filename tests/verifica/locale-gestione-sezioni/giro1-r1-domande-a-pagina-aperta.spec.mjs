// Verifica locale di Gestione a sezioni, giro 1, rilievo 1: una domanda bloccante che arriva con la Gestione
// già aperta deve vedersi nella barra delle sezioni senza dover aprire Domande, come un feedback nuovo nei Ricevuti.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './aiuto.mjs';

test('r1 una bloccante arrivata a pagina aperta accende il contatore delle Domande', async ({ app, openTab }) => {
  test.setTimeout(240000);
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(14, { priorita: 'quando_puoi' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  const sezione = page.locator('.mg-sezione[data-sezione="domande"]');
  await expect(sezione.locator('.mg-sezione-count')).toHaveText('(1)');
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'feedback');

  // Sul server nasce una domanda bloccante; l'owner resta sui Feedback, come fa quando tiene la pagina aperta.
  await mainFinto(app, {
    feedbacks: PRATICHE, riferimenti: RIFERIMENTI,
    domande: [domanda(14, { priorita: 'quando_puoi' }), domanda(20, { priorita: 'bloccante', titolo: 'Serve un sì per fondere' })],
  });

  // Il ritmo dei feedback dal vivo è un minuto: qui si concede il doppio, più margine.
  await expect(sezione.locator('.mg-sezione-count')).toHaveText('(2)', { timeout: 150000 });
  await expect(sezione).toHaveClass(/mg-sezione--urgente/);
});
