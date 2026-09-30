import { chromium } from 'playwright';
import { COURSE_URL, SITE, ENDPOINTS, AUTH_FILE, writePrivate } from './paths.js';
import { post } from './api.js';

export function successfulLogin(payload, token) {
  return payload?.errorCode === '00000' && Array.isArray(payload.data?.sectionList) && typeof token === 'string' && Boolean(token.trim()) && !['null', 'undefined'].includes(token);
}
export function attachCourseNavigation(page) {
  let opening = false;
  const navigate = () => {
    if (page.url() !== `${SITE}/educationalStudent/home` || opening) return;
    opening = true;
    page.goto(COURSE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => console.log('请在网页左侧点击“课程管理 → 我的课表”。'))
      .finally(() => { opening = false; });
  };
  page.on('domcontentloaded', navigate);
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigate(); });
}

// 独立临时浏览器，不读取个人 Chrome 配置目录，不保存账号密码或 CAS cookies。
export async function login() {
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch({ headless: false, ...(channel === 'chromium' ? {} : { channel }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log('请在新打开的浏览器中登录上海创智学院教务系统，程序会自动进入“我的课表”。');
    console.log('成功后仅将教务 token 保存到项目 .auth.json（仅本人可读，已排除版本控制）。');
    // The SPA sends an initial request with Authorization: null before redirecting
    // to CAS. Wait for a SUCCESSFUL response, not just the first request header.
    const tokenPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('登录等待超时')), 600_000);
      const closed = () => { clearTimeout(timer); reject(new Error('登录窗口已关闭')); };
      browser.once('disconnected', closed);
      context.on('response', async response => {
        const url = new URL(response.url());
        if (url.origin !== SITE || !url.pathname.endsWith(ENDPOINTS.panel) || !response.ok()) return;
        try {
          const payload = await response.json();
          const token = (await response.request().allHeaders()).authorization;
          if (!successfulLogin(payload, token)) return;
          clearTimeout(timer); browser.removeListener('disconnected', closed); resolve(token);
        } catch { /* A navigation can cancel an earlier unauthenticated response. */ }
      });
    });
    tokenPromise.catch(() => {});
    attachCourseNavigation(page);
    try { await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
    catch { console.log('页面可能正在跳转，请在浏览器内继续完成登录。'); }
    const token = await tokenPromise;
    await post(ENDPOINTS.panel, token);
    writePrivate(AUTH_FILE, { token, savedAt: new Date().toISOString() });
    console.log('登录成功，教务凭证已保存。');
  } catch {
    throw new Error('尚未完成登录。请重试 npm run login，在浏览器中完成登录并打开“我的课表”。');
  } finally { await browser.close(); }
}
