const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const lat = 43.6425637;
  const lng = -79.3870872;
  const src = `https://www.google.com/maps/embed?pb=!4v0!6m8!2m2!1d${lat}!2d${lng}!3f0!4f0!5f0.7820865974627469!9i3000!10b1!12b1!20b1!27b1!28i3000!30i3000!31i3000!32i3000!33i3000!37i3000`;
  await page.setContent(`<iframe width="800" height="600" src="${src}"></iframe>`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'sv-test.png' });
  await browser.close();
  console.log("Screenshot saved to sv-test.png");
})();
