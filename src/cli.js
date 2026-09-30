import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './paths.js';
import { Store } from './store.js';
import { login } from './login.js';
import { sync, statusText, settings, runService, consoleSender, reminderText } from './service.js';
import { querySchedule, formatQuery, dueReminders } from './schedule.js';
import { renderWeek } from './render.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
process.umask(0o077);
const args = process.argv.slice(2), command = args.shift() || 'help';
function option(name) { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1]) throw new Error(`${name} 缺少参数。`); return args.splice(i, 2)[1]; }
function flag(name) { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; }
function cliQuery(fallback = 'today') {
  const input = args.join(' ').trim() || fallback;
  const aliases = { today: '今天', tomorrow: '明天', next: '下一节', week: '本周', 'next-week': '下周' };
  if (aliases[input]) return aliases[input];
  const week = /^week\s+(\d+)$/.exec(input);
  if (week) return `第${Number(week[1])}周`;
  // Keep previously documented Chinese arguments working for existing users.
  return input;
}
let store;
try {
  const at = option('--at');
  if (at && !/(Z|[+-]\d{2}:\d{2})$/.test(at)) throw new Error('--at 请提供带时区的时间，例如 2026-09-14T08:25:00+08:00。');
  const now = at ? new Date(at) : new Date();
  if (!Number.isFinite(+now)) throw new Error('--at 时间无效。');
  if (command === 'login') { await login(); }
  else if (command === 'help') console.log(`上海创智学院课表助手\n\n  npm run login                登录并保存教务令牌\n  npm run sync                 同步整学期课表\n  npm run query -- next        下一节课程\n  npm run query -- today       今天（也支持 tomorrow）\n  npm run query -- week        本周（也支持 next-week）\n  npm run query -- week 1      第 1 教学周\n  npm run query -- 2026-09-14  指定日期\n  npm run query -- status      数据新鲜度和同步错误\n  npm run render -- week 1     输出周课表 PNG 和 HTML\n  npm run reminders -- --dry-run --at 2026-09-14T08:25:00+08:00\n  npm start -- --local          本机控制台提醒服务\n  npm start                    飞书私聊和提醒（需配置 .env）\n  npm test                     离线测试，不访问教务或飞书\n\n所有数据均保存于 ${ROOT}`);
  else {
    store = new Store();
    if (command === 'sync') {
      const { schedule, diff } = await sync(store);
      console.log(statusText(store));
      console.log(`本次差异：新增 ${diff.added.length}，移除 ${diff.removed.length}，变更 ${diff.updated.length}。`);
    } else if (command === 'start') {
      if (at) throw new Error('start 不支持模拟时间；请使用 reminders --dry-run。');
      const local = flag('--local');
      const once = flag('--once');
      if (once && !local) throw new Error('--once 只支持本地验收，请同时使用 --local。');
      const sender = local ? consoleSender() : (await import('./feishu.js')).feishuSender();
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
      await runService(store, sender, { signal: controller.signal, once });
    } else {
      if (command === 'query' && ['status', '状态'].includes(args.join(' '))) console.log(statusText(store, now));
      else {
        const schedule = store.get('schedule');
        if (!schedule) throw new Error('尚未同步课表。请先运行 npm run login，然后 npm run sync。');
        if (command === 'query') {
          let query;
          try { query = querySchedule(schedule, cliQuery(), now); }
          catch { throw new Error('支持：today、tomorrow、next、week、next-week、week N、YYYY-MM-DD、status。'); }
          console.log(formatQuery(schedule, query, now, settings().maxAgeHours));
        }
        else if (command === 'render') {
          let query;
          try { query = querySchedule(schedule, cliQuery('week'), now); }
          catch { throw new Error('支持：week、next-week、week N。'); }
          const week = schedule.weeks.find(w => w.dates[0] === query.from && w.dates.at(-1) === query.to);
          if (!week) throw new Error('请指定有效教学周，例如 npm run render -- week 1。');
          console.log(await renderWeek(schedule, week.number));
        } else if (command === 'reminders') {
          if (!flag('--dry-run')) throw new Error('此命令仅用于预览，请加 --dry-run；实际提醒请使用 npm start。');
          const config = settings();
          const items = dueReminders(schedule, now, config.minutes, config.maxAgeHours);
          console.log(`预览时间：${now.toISOString()}；不发送消息、不记录已发送。`);
          console.log(items.length ? items.map(reminderText).join('\n\n') : '此时没有应发送的提醒（请同时检查课表是否过期）。');
        } else throw new Error('未知命令；运行 node src/cli.js help 查看用法。');
      }
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
