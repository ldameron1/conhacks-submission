const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const lat = 43.6425637;
  const lng = -79.3870872;
  const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,0,0,0,0&output=svembed`;
  await page.setContent(`<iframe width="800" height="600" src="${src}"></iframe>`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'sv-free-test.png' });
  await browser.close();
})();
