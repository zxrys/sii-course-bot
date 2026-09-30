import { randomUUID } from 'node:crypto';
import { fetchSnapshot } from './api.js';
import { dueReminders, digest, localTime } from './schedule.js';

export function settings(env = process.env) {
  function positive(name, fallback, maximum) {
    const value = Number(env[name] || fallback);
    if (!Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`${name} 必须大于 0 且不超过 ${maximum}。`);
    return value;
  }
  return {
    minutes: positive('REMINDER_MINUTES', 30, 1440),
    syncHours: positive('SYNC_INTERVAL_HOURS', 24, 168),
    maxAgeHours: positive('MAX_SCHEDULE_AGE_HOURS', 48, 720),
  };
}
export async function sync(store) {
  try {
    const result = store.save(await fetchSnapshot());
    return result;
  } catch (error) {
    store.set('syncError', { at: new Date().toISOString(), message: error.message });
    throw error;
  }
}
export function statusText(store, now = new Date()) {
  const s = store.get('schedule'), error = store.get('syncError');
  const lines = s ? [
    `${s.schoolYear} 学年 · ${s.weeks.length} 周 · ${s.events.filter(e => e.status !== 'cancelled').length} 次有效课程`,
    `覆盖 ${s.from} 至 ${s.to}`, `最后成功同步：${localTime(s.fetchedAt)}`,
  ] : ['尚未同步课表，请先运行 npm run login 和 npm run sync。'];
  if (s && +now - Date.parse(s.fetchedAt) > settings().maxAgeHours * 3_600_000) lines.push('数据已过期，课程提醒已暂停，等待同步成功。');
  if (error) lines.push(`最近同步失败：${localTime(error.at)} · ${error.message}`);
  lines.push(`提醒：课前 ${settings().minutes} 分钟；过了上课时间不补发。`);
  return lines.join('\n');
}
export function reminderText(item) {
  const { event: e, minutesLeft } = item;
  return `🔔 ${minutesLeft} 分钟后上课\n\n${e.title}\n${e.date} ${e.start.slice(11, 16)}–${e.end.slice(11, 16)}\n教室：${e.room || '待定'} · 教师：${e.teacher || '待定'}${e.status === 'adjusted' ? '\n本次课程已调课，请留意时间和教室。' : ''}`;
}

// A successful send is the only path that marks delivery. Each recipient/channel has its own ledger.
export async function sendDue(store, sender, now = new Date(), config = settings()) {
  const schedule = store.get('schedule');
  if (!schedule) return 0;
  const began = Date.now();
  let count = 0;
  for (const candidate of dueReminders(schedule, now, config.minutes, config.maxAgeHours)) {
    // Re-check after each network await: a refresh may cancel/move a remaining
    // class, or the class may have started while a previous send was in flight.
    const checkedAt = new Date(+now + Date.now() - began);
    const current = store.get('schedule');
    const item = current && dueReminders(current, checkedAt, config.minutes, config.maxAgeHours).find(x => x.key === candidate.key);
    if (!item) continue;
    const key = `${sender.scope}:${item.key}`;
    if (store.hasSent(key)) continue;
    await sender.send(reminderText(item), key);
    store.markSent(key, checkedAt); count++;
  }
  return count;
}
export function changeText(notices) {
  const lines = ['📚 课表有更新'];
  for (const { diff } of notices) {
    for (const [key, label] of [['added', '新增'], ['removed', '移除'], ['updated', '变更']]) {
      for (const e of diff[key]) lines.push(`${label}：${e.date} ${e.start.slice(11, 16)} ${e.title} · ${e.room || '教室待定'}${e.status === 'cancelled' ? '（停课）' : ''}`);
    }
  }
  return lines.slice(0, 25).join('\n') + (lines.length > 25 ? '\n更多变化请查询课表。' : '');
}

export async function runService(store, sender, { signal, syncFn = sync, once = false } = {}) {
  const owner = randomUUID();
  const config = settings();
  if (!store.lease(owner)) throw new Error('另一个提醒进程正在运行；请先停止它。');
  let nextSync = 0;
  let syncing;
  const refresh = () => syncing ||= syncFn(store).finally(() => { syncing = null; });
  const heartbeat = setInterval(() => store.lease(owner), 30_000);
  try {
    await sender.listen?.({ store, refresh });
    console.log(`提醒服务已启动（${sender.scope}），Ctrl+C 停止；Mac 休眠期间不能运行。`);
    while (!signal?.aborted) {
      sender.assertHealthy?.();
      if (!store.lease(owner)) throw new Error('提醒服务锁已失效，请重启。');
      const now = new Date();
      if (+now >= nextSync) {
        try {
          const { schedule } = await refresh();
          console.log(`同步成功：${schedule.events.length} 条课程记录，${schedule.weeks.length} 周。`);
          nextSync = Date.now() + config.syncHours * 3_600_000;
        } catch (e) { console.error(e.message); nextSync = Date.now() + 15 * 60_000; }
      }
      try {
        const error = store.get('syncError');
        const schedule = store.get('schedule');
        const stale = schedule && Date.now() - Date.parse(schedule.fetchedAt) > config.maxAgeHours * 3_600_000;
        if (error || stale) {
          const key = `${sender.scope}:sync-error:${digest([error?.message, new Date().toISOString().slice(0, 10)])}`;
          if (!store.hasSent(key)) {
            await sender.send(`⚠️ 课表同步需要处理\n${error?.message || '课表已过期，请刷新。'}\n${statusText(store)}`, key);
            store.markSent(key);
          }
        }
        const pending = store.get('pendingChanges') || [];
        if (pending.length) {
          const key = `${sender.scope}:changes:${digest(pending)}`;
          if (!store.hasSent(key)) { await sender.send(changeText(pending), key); store.markSent(key); }
          // Remove only the notices included in this send; concurrent refresh may append more.
          const sent = new Set(pending.map(x => x.at));
          store.set('pendingChanges', (store.get('pendingChanges') || []).filter(x => !sent.has(x.at)));
        }
        await sendDue(store, sender, new Date(), config);
      } catch { console.error('消息发送失败，未标记已发送，将在下一轮重试。'); }
      if (once) break;
      await new Promise(resolve => {
        if (signal?.aborted) return resolve();
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 20_000);
        signal?.addEventListener('abort', finish, { once: true });
      });
    }
  } finally { clearInterval(heartbeat); await sender.close?.(); store.release(owner); }
}

export function consoleSender() {
  return { scope: 'console', send: async text => console.log(`\n${text}\n`) };
}
