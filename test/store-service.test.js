import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from '../test-support/fixture.js';
import { Store } from '../src/store.js';
import { sendDue } from '../src/service.js';
import { isOwnerEvent } from '../src/feishu.js';
import { post, AuthError } from '../src/api.js';
import { ENDPOINTS } from '../src/paths.js';

test('bad snapshot does not replace last successful schedule', () => {
  const db = new Store(':memory:');
  try {
    const raw = fixture(); db.save(raw, false); raw.courses[0].startSectionId = 'unknown';
    assert.throws(() => db.save(raw, false));
    assert.equal(db.get('schedule').events[0].room, '201');
  } finally { db.close(); }
});
test('failed delivery stays pending, successful delivery survives process restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sii-course-test-'));
  const file = path.join(dir, 'store.sqlite'); let db = new Store(file), calls = 0;
  const now = new Date('2026-09-14T08:25:00+08:00');
  try {
    db.save(fixture(), false);
    await assert.rejects(sendDue(db, { scope: 'test', send: async () => { throw new Error('network down'); } }, now));
    const sender = { scope: 'test', send: async () => { calls++; } };
    assert.equal(await sendDue(db, sender, now), 1);
    db.close(); db = new Store(file);
    assert.equal(await sendDue(db, sender, now), 0); assert.equal(calls, 1);
    assert.equal(await sendDue(db, { ...sender, scope: 'different-recipient' }, now), 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true }); }
});
test('cancellation received before delivery removes pending reminder', async () => {
  const db = new Store(':memory:');
  try {
    const raw = fixture(); db.save(raw, false); raw.courses[0].dataType = '3'; db.save(raw, false);
    assert.equal(await sendDue(db, { scope: 'test', send: async () => assert.fail('must not send') }, new Date('2026-09-14T08:25:00+08:00')), 0);
    assert.equal(db.get('pendingChanges').length, 1);
  } finally { db.close(); }
});
test('service lease prevents two live senders but recovers expired lease', () => {
  const db = new Store(':memory:');
  try {
    assert.ok(db.lease('first', 0)); assert.equal(db.lease('second', 1), false);
    assert.ok(db.lease('first', 2)); assert.ok(db.lease('second', 180_003));
    db.release('first'); assert.equal(db.lease('third', 180_004), false);
    db.release('second'); assert.ok(db.lease('third', 180_005));
  } finally { db.close(); }
});
test('a cancellation during another delivery is checked before the next message', async () => {
  const db = new Store(':memory:');
  try {
    const raw = fixture(); raw.courses.push({ ...raw.courses[0], className: '第二门测试课' });
    db.save(raw, false); let sent = 0;
    const sender = { scope: 'test', send: async () => {
      sent++; raw.courses.forEach(c => { c.dataType = '3'; }); db.save(raw, false);
    } };
    assert.equal(await sendDue(db, sender, new Date('2026-09-14T08:25:00+08:00')), 1);
    assert.equal(sent, 1);
  } finally { db.close(); }
});
test('bot ignores everyone except configured owner in private text chat', () => {
  const data = { sender: { sender_id: { open_id: 'ou_owner' } }, message: { chat_type: 'p2p', message_type: 'text' } };
  assert.ok(isOwnerEvent(data, 'ou_owner'));
  assert.equal(isOwnerEvent(data, ''), false); assert.equal(isOwnerEvent(data, 'ou_someone'), false);
  data.message.chat_type = 'group'; assert.equal(isOwnerEvent(data, 'ou_owner'), false);
});
test('API rejects authentication errors, HTML, bad codes and out-of-scope requests', async () => {
  const mock = (body, status = 200) => async () => new Response(body, { status });
  await assert.rejects(post(ENDPOINTS.panel, 'dummy', {}, mock('{"errorCode":"A0200"}')), AuthError);
  await assert.rejects(post(ENDPOINTS.panel, 'dummy', {}, mock('no', 403)), AuthError);
  await assert.rejects(post(ENDPOINTS.panel, 'dummy', {}, mock('<html>Login</html>')), /非 JSON/);
  await assert.rejects(post(ENDPOINTS.panel, 'dummy', {}, mock('{"errorCode":"500","data":{}}')));
  await assert.rejects(post('/not-a-timetable-endpoint', 'dummy', {}, mock('{}')), /不允许/);
  assert.deepEqual(await post(ENDPOINTS.panel, 'dummy', {}, mock('{"errorCode":"00000","data":{"ok":true}}')), { ok: true });
});
