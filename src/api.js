import fs from 'node:fs';
import { AUTH_FILE, API_BASE, ENDPOINTS } from './paths.js';

export class AuthError extends Error {
  constructor() { super('教务登录已失效或尚未登录，请运行 npm run login。'); this.name = 'AuthError'; }
}
export function readToken() {
  if (!fs.existsSync(AUTH_FILE)) throw new AuthError();
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (typeof auth.token !== 'string' || !auth.token.trim()) throw new AuthError();
  return auth.token;
}
export async function post(endpoint, token, body = {}, fetcher = fetch) {
  if (!Object.values(ENDPOINTS).includes(endpoint)) throw new Error('不允许请求课表以外的接口。');
  let response;
  try {
    response = await fetcher(API_BASE + endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: token, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body),
    });
  } catch { throw new Error('教务接口连接失败或超时，原课表已保留。'); }
  if ([401, 403].includes(response.status)) throw new AuthError();
  if (!response.ok) throw new Error(`教务接口返回 HTTP ${response.status}，原课表已保留。`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('教务返回了非 JSON 数据，原课表已保留。'); }
  if (payload.errorCode === 'A0200') throw new AuthError();
  if (payload.errorCode !== '00000' || payload.data == null) {
    throw new Error('教务接口未返回成功数据，原课表已保留。');
  }
  return payload.data;
}
export async function fetchSnapshot(token = readToken()) {
  const panel = await post(ENDPOINTS.panel, token);
  const courses = await post(ENDPOINTS.courses, token);
  const days = Object.values(panel.timetableDateMap || {}).flat().map(x => x.timetableDate).sort();
  if (!days.length) throw new Error('学期日期表为空，停止同步。');
  const dayChanges = await post(ENDPOINTS.dayChanges, token, {
    timetableStartDate: days[0], timetableEndDate: days.at(-1),
  });
  const termChanges = await post(ENDPOINTS.termChanges, token);
  return { fetchedAt: new Date().toISOString(), source: API_BASE, panel, courses, dayChanges, termChanges };
}
