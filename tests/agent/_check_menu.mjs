import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://example.com');
  await d.sleep(3000);
  const view = await d.activeView(app, shell);
  if (view) {
    // Dispatch a contextmenu event
    const menuAppeared = await view.evaluate(() => {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 400, clientY: 300, button: 2,
      });
      document.body.dispatchEvent(evt);
      // Check if menu element appeared
      return new Promise(resolve => {
        setTimeout(() => {
          const menu = document.querySelector('.sn-menu');
          resolve({
            menuFound: !!menu,
            menuHTML: menu ? menu.outerHTML.slice(0, 500) : null,
            menuChildren: menu ? menu.children.length : 0,
          });
        }, 500);
      });
    });
    console.log('MENU RESULT:', JSON.stringify(menuAppeared, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
