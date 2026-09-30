import fs from 'node:fs';
import * as lark from '@larksuiteoapi/node-sdk';
import { digest, querySchedule, formatQuery } from './schedule.js';
import { statusText, settings } from './service.js';
import { renderWeek } from './render.js';

export function isOwnerEvent(data, owner) {
  return Boolean(owner) && data?.sender?.sender_id?.open_id === owner && data?.message?.chat_type === 'p2p' && data?.message?.message_type === 'text';
}
export function feishuSender(env = process.env) {
  const appId = env.FEISHU_APP_ID, appSecret = env.FEISHU_APP_SECRET, owner = env.FEISHU_OWNER_OPEN_ID;
  if (!appId || !appSecret || !owner) throw new Error('请先在 .env 配置 FEISHU_APP_ID、FEISHU_APP_SECRET 和 FEISHU_OWNER_OPEN_ID；本地运行可用 npm start -- --local。');
  if (!/^ou_[A-Za-z0-9]+$/.test(owner)) throw new Error('FEISHU_OWNER_OPEN_ID 格式应为 ou_...。');
  // Never let the SDK print request objects or authorization headers to logs.
  const quiet = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
  lark.defaultHttpInstance.defaults.timeout = 20_000;
  lark.defaultHttpInstance.defaults.maxRedirects = 0;
  const config = { appId, appSecret, domain: lark.Domain.Feishu, logger: quiet };
  const client = new lark.Client({ ...config, httpInstance: lark.defaultHttpInstance });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const ws = new lark.WSClient({
    ...config,
    onReady: () => { console.log('飞书长连接已建立。'); readyResolve(); },
    onError: () => { console.error('飞书长连接失败，请检查应用的长连接事件配置。'); readyReject(new Error('飞书长连接建立失败。')); },
    onReconnecting: () => console.warn('飞书长连接断开，正在重连。'),
    onReconnected: () => console.log('飞书长连接已恢复。'),
  });
  const inFlight = new Set();
  const running = new Set();
  async function sendContent(type, content, key) {
    const result = await client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: { receive_id: owner, msg_type: type, content: JSON.stringify(content), uuid: digest(key).slice(0, 40) },
    });
    if (result.code !== 0 || !result.data?.message_id) throw new Error('飞书消息发送失败。');
  }
  const send = async (text, key) => sendContent('text', { text }, key);
  return {
    scope: `feishu:${owner}`, send,
    async listen({ store, refresh }) {
      async function handle(data) {
        if (!isOwnerEvent(data, owner)) return;
        const key = `reply:${data.message.message_id}`;
        if (inFlight.has(key) || store.hasSent(key)) return;
        inFlight.add(key);
        try {
          let command;
          try { command = JSON.parse(data.message.content).text?.trim(); } catch { return; }
          if (!command) return;
          if (['刷新', '刷新课表'].includes(command)) {
            await send('正在同步课表…', `${key}:ack`);
            await refresh();
            await send(statusText(store), key);
          } else if (command === '状态') await send(statusText(store), key);
          else {
            const schedule = store.get('schedule');
            if (!schedule) { await send(statusText(store), key); return; }
            const query = querySchedule(schedule, command);
            await send(formatQuery(schedule, query, new Date(), settings().maxAgeHours), key);
            if (['本周', '本周课表', '下周', '下周课表'].includes(command) || /^第?\d+周$/.test(command)) {
              const week = schedule.weeks.find(w => w.dates[0] === query.from);
              if (week) {
                try {
                  const file = await renderWeek(schedule, week.number);
                  const upload = await client.im.image.create({ data: { image_type: 'message', image: fs.createReadStream(file) } });
                  // The generated image API returns its data directly; other
                  // SDK clients may keep the HTTP envelope.
                  const imageKey = upload.image_key ?? upload.data?.image_key;
                  if (!imageKey) throw new Error();
                  await sendContent('image', { image_key: imageKey }, `${key}:image`);
                } catch { console.error('周课表图片发送失败，文字课表已发送。'); }
              }
            }
          }
          store.markSent(key);
        } catch (error) {
          // Only our own messages are exposed; SDK failures never expose raw objects.
          const known = /^(支持：|教务|课程|学期|出现|节次|同一|缺少|未知|日期)/.test(error.message || '');
          try { await send(known ? error.message : '操作未完成，请稍后重试或在本地查看状态。', `${key}:error`); } catch { console.error('飞书回复失败。'); }
        } finally { inFlight.delete(key); }
      }
      try {
        await ws.start({ eventDispatcher: new lark.EventDispatcher({}).register({
          'im.message.receive_v1': data => {
            const task = handle(data);
            running.add(task);
            task.finally(() => running.delete(task)).catch(() => {});
            return {};
          },
        }) });
        await Promise.race([
          ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('飞书长连接建立超时。')), 30_000)),
        ]);
      } catch (error) { ws.close({ force: true }); throw error; }
    },
    assertHealthy() {
      if (ws.getConnectionStatus().state === 'failed') throw new Error('飞书长连接已失效，请重启服务。');
    },
    async close() { ws.close({ force: true }); await Promise.allSettled([...running]); },
  };
}
