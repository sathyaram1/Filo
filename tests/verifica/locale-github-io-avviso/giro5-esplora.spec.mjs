import { test, expect } from '../../fixtures/electron.mjs';

test('esplora verdetti', async ({ app }) => {
  const urls = [
    'https://google.github.io/styleguide/', 'https://googlechromelabs.github.io/chrome-for-testing/',
    'https://microsoft.github.io/monaco-editor/', 'https://facebook.github.io/react-native/',
    'https://github.github.io/fetch/', 'https://paypal.github.io/', 'https://shopify.github.io/',
    'https://netflix.github.io/', 'https://linkedin.github.io/', 'https://yahoo.github.io/', 'https://dropbox.github.io/',
    'https://facebookresearch.github.io/', 'https://krakenjs.github.io/', 'https://discord-bot-guide.github.io/',
    'https://pineapple.github.io/', 'https://otherwise.github.io/', 'https://sathyarampontillo.github.io/',
    'https://octocat.github.io/', 'https://paypal-login.github.io/', 'https://paypa1.github.io/',
    'https://fonts.googleapis.com/css2', 'https://www.googleapis.com/', 'https://microsoft.sharepoint.com/',
    'https://paypal.sharepoint.com/', 'https://contoso-my.sharepoint.com/personal/x',
    'https://google.gitlab.io/', 'https://gitlab-org.gitlab.io/', 'https://microsoft.netlify.app/',
    'https://GOOGLE.GITHUB.IO/styleguide/', 'https://google.github.io./',
    'https://cdn.jsdelivr.net/gh/x/y', 'https://raw.githubusercontent.com/google/x/main/a',
    'https://objects.githubusercontent.com/', 'https://user-images.githubusercontent.com/1/a.png',
    'https://avatars.githubusercontent.com/u/1', 'https://gist.githubusercontent.com/a/b/raw',
    'https://github-io.github.io/', 'https://github.io/', 'https://pages.github.com/',
  ];
  const v = await app.evaluate((_, us) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return us.map((u) => { const x = SB.checkSync(u, {}); return [u, x.level, x.whitelisted ? 'wl' : '', x.message && x.message.title]; });
  }, urls);
  console.log(JSON.stringify(v, null, 1));
  expect(v.length).toBeGreaterThan(0);
});
