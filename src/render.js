import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { OUTPUT_DIR, privateDir } from './paths.js';
import { localTime } from './schedule.js';

export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
export function weekHtml(schedule, number) {
  const week = schedule.weeks.find(w => w.number === number);
  if (!week) throw new Error('该教学周不在已同步学期内。');
  const esc = escapeHtml;
  const colors = ['#ebe5ff', '#dcf2ef', '#ffedcf', '#f9e1e6', '#dfeafb', '#e9edce'];
  const allTitles = [...new Set(schedule.events.map(e => e.title))].sort();
  const events = schedule.events.filter(e => week.dates.includes(e.date));
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const head = week.dates.map(day => `<div class="day"><strong>星期${weekdays[new Date(day + 'T12:00:00+08:00').getUTCDay()]}</strong><span>${day.slice(5)}</span></div>`).join('');
  const rows = schedule.sections.map(s => `<div class="row"><div class="time"><b>${s.sequence}</b><span>${s.start.slice(0, 5)}<br>${s.end.slice(0, 5)}</span></div>${week.dates.map(() => '<div class="cell"></div>').join('')}</div>`).join('');
  const blocks = events.map(e => {
    const overlap = events.filter(other => other.date === e.date && Date.parse(other.start) < Date.parse(e.end) && Date.parse(other.end) > Date.parse(e.start));
    const index = overlap.findIndex(other => other.id === e.id);
    const col = week.dates.indexOf(e.date), row = schedule.sections.findIndex(s => s.sequence === e.firstSection);
    const n = e.lastSection - e.firstSection + 1;
    const color = colors[allTitles.indexOf(e.title) % colors.length];
    return `<div class="course ${e.status === 'cancelled' ? 'cancelled' : ''}" style="left:calc(92px + (100% - 92px) / 7 * ${col} + (100% - 92px) / 7 * ${index / overlap.length} + 3px);top:${row * 70 + 3}px;width:calc((100% - 92px) / 7 / ${overlap.length} - 6px);height:${n * 70 - 6}px;background:${color}"><strong>${esc(e.title)}</strong><span>${e.start.slice(11, 16)}–${e.end.slice(11, 16)}</span><span>教室 ${esc(e.room || '待定')}</span><span>${esc(e.teacher || '教师待定')}</span>${e.status === 'scheduled' ? '' : `<b class="badge">${e.status === 'cancelled' ? '停课' : '调课'}</b>`}</div>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#202938;font-family:"PingFang SC","Noto Sans CJK SC",sans-serif}.wrap{padding:36px;width:1480px}.eyebrow{color:#657387;letter-spacing:3px;font-size:15px}h1{font-size:32px;margin:8px 0 12px}.subtitle{color:#66748a;font-size:17px;margin-bottom:24px}.board{background:white;border-radius:16px;padding:16px;box-shadow:0 3px 18px #2038580b}.head,.row{display:grid;grid-template-columns:92px repeat(7,1fr)}.head{height:68px;background:#eef2f8;border-radius:10px}.day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-size:17px}.day span{font-size:14px;color:#718097}.body{position:relative}.row{height:70px}.row:nth-child(even){background:#f8fafc}.cell{border-left:1px solid #f0f3f7}.time{display:flex;align-items:center;justify-content:center;gap:12px;color:#778499;font-size:12px}.time b{font-size:16px}.course{position:absolute;border-radius:9px;padding:10px;font-size:14px;overflow:hidden;display:flex;flex-direction:column;gap:5px;border:1px solid #ffffff70}.course strong{font-size:16px;line-height:1.35}.course span{font-size:13px}.cancelled{opacity:.55}.cancelled strong{text-decoration:line-through}.badge{font-size:12px;color:#a52d36}.footer{margin-top:18px;color:#748195;font-size:13px;display:flex;justify-content:space-between}.empty{color:#8090a5}
  </style><div class="wrap"><div class="eyebrow">SII · COURSE ASSISTANT</div><h1>第 ${number} 周 · 我的课表</h1><div class="subtitle">${esc(schedule.schoolYear)} 学年 &nbsp; / &nbsp; ${week.dates[0]} — ${week.dates.at(-1)} &nbsp; / &nbsp; ${events.filter(e => e.status !== 'cancelled').length} 次课程</div><div class="board"><div class="head"><div class="day">节次</div>${head}</div><div class="body">${rows}${blocks}</div></div><div class="footer"><span>上海创智学院 · 教务课表${events.length ? '' : ' · 本周无课程'}</span><span>同步于 ${esc(localTime(schedule.fetchedAt))} · 时间均为北京时间</span></div></div></html>`;
}
export async function renderWeek(schedule, number, outputFile = path.join(OUTPUT_DIR, `week-${number}.png`)) {
  privateDir(path.dirname(outputFile));
  const html = weekHtml(schedule, number);
  fs.writeFileSync(outputFile.replace(/\.png$/, '.html'), html, { mode: 0o600 });
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1480, height: 1100 }, deviceScaleFactor: 1.5 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.wrap').screenshot({ path: outputFile });
    fs.chmodSync(outputFile, 0o600);
  } finally { await browser.close(); }
  return outputFile;
}
