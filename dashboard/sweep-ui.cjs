const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/tmp/dashboard-screenshots';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5200/dashboard';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  // 1. Login
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: OUT + '/01-login.png', fullPage: true });
  console.log('01-login done');

  // Try token login
  const tokenInput = await page.$('input[type="password"]');
  if (tokenInput) {
    await tokenInput.fill('daedalus-dev-token');
    const submit = await page.$('button[type="submit"]');
    if (submit) {
      await submit.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: OUT + '/02-token-login.png', fullPage: true });
      console.log('02 URL:', page.url());
    }
  }

  // Try OIDC
  if (!page.url().includes('overview')) {
    const btn = await page.$('button:has-text("Sign in")');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: OUT + '/03-oidc.png', fullPage: true });
      console.log('03 URL:', page.url());
    }
  }

  // Check auth
  const auth = await page.evaluate(async () => {
    const h = await fetch('/v1/health').then(r => r.json()).catch(e => ({err: e.message}));
    const s = await fetch('/v1/auth/session', {credentials:'include'}).then(r => ({status:r.status})).catch(e => ({err:e.message}));
    return {h, s};
  });
  console.log('Auth:', JSON.stringify(auth));

  const url = page.url();
  console.log('Final URL:', url);

  if (url.includes('overview') || url.includes('sessions')) {
    const pages = [
      '/overview', '/sessions', '/audit', '/analytics', '/cost',
      '/settings', '/auth/keys', '/templates', '/pipelines', '/metrics', '/activity', '/routines'
    ];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      try {
        await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: OUT + '/' + String(i+4).padStart(2,'0') + p.replace(/\//g, '-') + '.png', fullPage: true });
        console.log(String(i+4).padStart(2,'0') + p, 'OK');
      } catch(e) {
        console.log(String(i+4).padStart(2,'0') + p, 'ERR:', e.message.slice(0,80));
      }
    }

    // Session detail
    try {
      const sid = await page.evaluate(async () => {
        const r = await fetch('/v1/sessions?limit=1');
        if (!r.ok) return null;
        const d = await r.json();
        return d.sessions ? d.sessions[0]?.id : null;
      });
      if (sid) {
        await page.goto(BASE + '/sessions/' + sid, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: OUT + '/16-session-detail.png', fullPage: true });
        console.log('16 session OK');
      }
    } catch(e) { console.log('session ERR:', e.message.slice(0,80)); }
  }

  console.log('\n=== ERRORS ===');
  [...new Set(errors)].forEach(e => console.log(e));
  console.log('Total:', [...new Set(errors)].length);

  await browser.close();
})();
