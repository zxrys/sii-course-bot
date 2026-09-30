import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-support/fixture.js';
import { normalizeSnapshot, querySchedule, dueReminders, diffSchedules, dateKey, addDays, formatQuery } from '../src/schedule.js';
import { escapeHtml, weekHtml } from '../src/render.js';

test('maps section IDs to exact start/end times including breaks', () => {
  const schedule = normalizeSnapshot(fixture());
  assert.equal(schedule.events[0].start, '2026-09-14T08:55:00+08:00');
  assert.equal(schedule.events[0].end, '2026-09-14T11:30:00+08:00');
  assert.equal(schedule.events[0].week, 1);
});
test('Shanghai date boundaries and Sunday-based school weeks', () => {
  assert.equal(dateKey(new Date('2026-09-13T16:01:00Z')), '2026-09-14');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  const s = normalizeSnapshot(fixture());
  assert.equal(querySchedule(s, '本周', new Date('2026-09-19T23:59:00+08:00')).from, '2026-09-13');
  assert.equal(querySchedule(s, '本周', new Date('2026-09-20T00:00:00+08:00')).from, '2026-09-20');
  assert.equal(querySchedule(s, '明天', new Date('2026-09-13T10:00:00Z')).events.length, 1);
  assert.match(querySchedule(s, '2026-10-01').note, /不在/);
});
test('reminders only within lead window, never after start, and exclude cancellations', () => {
  const s = normalizeSnapshot(fixture());
  const due = t => dueReminders(s, new Date(`2026-09-14T${t}+08:00`));
  assert.equal(due('08:24:59').length, 0);
  assert.equal(due('08:25:00').length, 1);
  assert.equal(due('08:54:59')[0].minutesLeft, 1);
  assert.equal(due('08:55:00').length, 0);
  s.events[0].status = 'cancelled';
  assert.equal(due('08:25:00').length, 0);
  assert.equal(querySchedule(s, '下一节', new Date('2026-09-13')).events.length, 0);
});
test('stale data is labelled and cannot produce reminders', () => {
  const s = normalizeSnapshot(fixture()); s.fetchedAt = '2026-09-01T00:00:00Z';
  const now = new Date('2026-09-14T08:25:00+08:00');
  assert.equal(dueReminders(s, now).length, 0);
  assert.match(formatQuery(s, querySchedule(s, '今天', now), now), /已过期/);
});
test('unknown status, out-of-term dates, partial weeks, section mismatches fail closed', () => {
  const mutations = [
    r => { r.courses[0].dataType = 'future-state'; },
    r => { r.courses[0].timetableDate = '2026-12-01'; },
    r => { r.courses[0].timetableDate = '2026-09-31'; },
    r => { r.courses[0].sectionNumber = 20; },
    r => { r.courses[0].endSectionId = 's3'; },
    r => { r.panel.totalWeekNumber = 19; },
    r => { r.panel.timetableDateMap[1].pop(); },
    r => { r.panel.sectionList[1].startTime = '25:00:00'; },
  ];
  for (const mutate of mutations) { const raw = fixture(); mutate(raw); assert.throws(() => normalizeSnapshot(raw)); }
});
test('duplicates collapse; conflicting duplicates reject snapshot', () => {
  const raw = fixture(); raw.courses.push({ ...raw.courses[0] });
  assert.equal(normalizeSnapshot(raw).events.length, 1);
  raw.courses[1].classroomName = '401';
  assert.throws(() => normalizeSnapshot(raw), /冲突/);
});
test('rescheduling changes reminder identity, room changes keep it, cancellation is visible', () => {
  const raw = fixture(), before = normalizeSnapshot(raw);
  raw.courses[0].classroomName = '401';
  const room = normalizeSnapshot(raw);
  assert.equal(room.events[0].id, before.events[0].id);
  assert.equal(diffSchedules(before, room).updated.length, 1);
  raw.courses[0].timetableDate = '2026-09-15'; raw.courses[0].dataType = '2';
  const moved = normalizeSnapshot(raw), diff = diffSchedules(before, moved);
  assert.equal(diff.added.length, 1); assert.equal(diff.removed.length, 1);
  raw.courses[0].dataType = '3';
  const cancelled = normalizeSnapshot(raw);
  assert.match(formatQuery(cancelled, querySchedule(cancelled, '第1周')), /停课/);
});
test('course content is escaped before rendering HTML', () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  const raw = fixture(); raw.courses[0].className = '<img src=x onerror=alert(1)>';
  const html = weekHtml(normalizeSnapshot(raw), 1);
  assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img'));
});
