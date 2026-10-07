// Verifica #760 giro 2. r1: un contenuto incorporato che non c'è più (post cancellato o privato, video o brano non
// disponibile) non è rotto dai cookie: riattivarli non lo riporta, quindi la proposta non deve comparire.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('r1 un post cancellato, un video o un brano non più disponibile non ricevono la proposta di riattivare i cookie', () => {
  const R = require('../../../src/main/services/riquadriRottiRegole.js');
  const casi = [
    ['www.tiktok.com', '/embed/v2/7212345678901234567', 'Video currently unavailable'],
    ['www.facebook.com', '/plugins/post.php', 'This content isn\'t available right now'],
    ['www.facebook.com', '/plugins/video.php', 'Questo contenuto non è disponibile al momento'],
    ['w.soundcloud.com', '/player/', 'This track is not available.'],
  ];
  for (const [host, percorso, testo] of casi) {
    expect(R.riconosci({ host, percorso, testo }), `${host}: «${testo}»`).toBeNull();
  }
});
