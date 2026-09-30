import { createHash } from 'node:crypto';

export const ZONE = 'Asia/Shanghai';
const DAY_MS = 86_400_000;
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
export function addDays(day, count) { return new Date(Date.parse(`${day}T12:00:00+08:00`) + count * DAY_MS).toISOString().slice(0, 10); }
export function localTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(new Date(`${s}T12:00:00+08:00`)) === s; }
function clock(s) {
  if (typeof s !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s)) throw new Error('节次时间格式变化，停止同步。');
  return s.length === 5 ? `${s}:00` : s;
}
function assert(condition, message) { if (!condition) throw new Error(`${message}，停止同步并保留原课表。`); }

export function normalizeSnapshot(raw) {
  const { panel, courses } = raw;
  assert(panel && typeof panel.schoolYear === 'string' && panel.schoolYear.trim(), '缺少学年信息');
  assert(Array.isArray(panel.sectionList) && panel.sectionList.length > 0, '缺少节次表');
  assert(Array.isArray(courses), '课程列表格式变化');
  assert(panel.timetableDateMap && typeof panel.timetableDateMap === 'object', '缺少学期日期表');
  assert(Number.isFinite(Date.parse(raw.fetchedAt)), '缺少同步时间');
  const sections = panel.sectionList.map(s => ({ id: String(s.id), sequence: Number(s.sectionSequence), start: clock(s.startTime), end: clock(s.endTime) }));
  assert(new Set(sections.map(s => s.id)).size === sections.length, '节次 ID 重复');
  sections.forEach((s, i) => {
    assert(s.id !== 'undefined' && Number.isInteger(s.sequence) && s.sequence > 0 && s.start < s.end, '节次信息无效');
    if (i) assert(s.sequence === sections[i - 1].sequence + 1 && s.start >= sections[i - 1].end, '节次顺序变化');
  });
  const weeks = Object.entries(panel.timetableDateMap).map(([number, days]) => {
    assert(Number.isInteger(Number(number)) && Array.isArray(days) && days.length === 7, '教学周格式变化');
    const dates = days.map(x => x.timetableDate);
    assert(dates.every(validDate), '学期日期格式变化');
    assert(dates.every((d, i) => i === 0 || addDays(dates[i - 1], 1) === d), '教学周日期不连续');
    return { number: Number(number), dates };
  }).sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  assert(weeks.length === Number(panel.totalWeekNumber) && weeks.length > 0, '学期周数与日期表不一致');
  const dates = weeks.flatMap(w => w.dates);
  assert(new Set(dates).size === dates.length, '教学周日期重复');
  assert(dates.every((d, i) => i === 0 || addDays(dates[i - 1], 1) === d), '学期日期不连续');
  const events = courses.map(c => {
    assert(validDate(c.timetableDate) && dates.includes(c.timetableDate), '课程日期不在学期日期表中');
    assert(typeof c.className === 'string' && c.className.trim(), '课程名称缺失');
    const status = ({ 1: 'scheduled', 2: 'adjusted', 3: 'cancelled' })[String(c.dataType)];
    assert(Boolean(status), '出现未知课程状态');
    const i = sections.findIndex(s => s.id === String(c.startSectionId));
    const n = Number(c.sectionNumber);
    assert(i >= 0 && Number.isInteger(n) && n > 0 && i + n <= sections.length, '课程节次无法映射');
    const first = sections[i], last = sections[i + n - 1];
    if (c.endSectionId != null) assert(String(c.endSectionId) === last.id, '课程结束节次不一致');
    const event = {
      date: c.timetableDate, title: c.className.trim(), room: String(c.classroomName ?? ''), teacher: String(c.courseTeacherName ?? ''),
      start: `${c.timetableDate}T${first.start}+08:00`, end: `${c.timetableDate}T${last.end}+08:00`,
      firstSection: first.sequence, lastSection: last.sequence, status,
      week: weeks.find(w => w.dates.includes(c.timetableDate)).number,
    };
    event.id = digest([panel.schoolYear, event.date, event.title, event.start, event.end]);
    return event;
  });
  const unique = new Map();
  for (const e of events) {
    const prev = unique.get(e.id);
    assert(!prev || JSON.stringify(prev) === JSON.stringify(e), '同一课程时段出现冲突记录');
    unique.set(e.id, e);
  }
  return {
    schema: 1, fetchedAt: raw.fetchedAt, source: raw.source, schoolYear: panel.schoolYear,
    weeks, sections, from: dates[0], to: dates.at(-1),
    events: [...unique.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)),
    changes: { day: raw.dayChanges, term: raw.termChanges },
  };
}

export function querySchedule(schedule, command = '今天', now = new Date()) {
  const day = dateKey(now);
  const text = command.trim();
  let from = day, to = day, title = text, events;
  if (['下一节', '下一节课'].includes(text)) {
    events = schedule.events.filter(e => e.status !== 'cancelled' && Date.parse(e.start) >= +now);
    events = events.filter(e => e.start === events[0]?.start);
    if (!events.length) return { title: '下一节课', events: [], note: '已同步学期内没有后续课程。' };
    return { title: '下一节课', events, note: '' };
  }
  if (['今天', '今天课表', '今日课表', '今天有什么课'].includes(text)) title = '今天课表';
  else if (['明天', '明天课表', '明天有什么课'].includes(text)) { from = to = addDays(day, 1); title = '明天课表'; }
  else if (['本周', '本周课表', '下周', '下周课表'].includes(text) || /^第?\d+周$/.test(text)) {
    let week;
    if (/^第?\d+周$/.test(text)) week = schedule.weeks.find(w => w.number === Number(text.match(/\d+/)[0]));
    else {
      const target = text.startsWith('下') ? addDays(day, 7) : day;
      week = schedule.weeks.find(w => w.dates.includes(target));
    }
    if (!week) return { title: text, events: [], note: '该周不在已同步学期范围内。' };
    from = week.dates[0]; to = week.dates.at(-1); title = `第 ${week.number} 周课表`;
  } else if (validDate(text)) { from = to = text; title = `${text} 课表`; }
  else throw new Error('支持：今天、明天、下一节、本周、下周、第1周、YYYY-MM-DD、状态、刷新课表。');
  if (from < schedule.from || to > schedule.to) return { title, events: [], note: `日期不在已同步学期范围（${schedule.from} 至 ${schedule.to}）内。` };
  events = schedule.events.filter(e => e.date >= from && e.date <= to);
  return { title, events, from, to, note: events.length ? '' : '这段时间没有课程。' };
}

export function formatQuery(schedule, query, now = new Date(), maxAgeHours = 48) {
  const lines = [`${query.title}${query.from ? `（${query.from}${query.from !== query.to ? ` — ${query.to}` : ''}）` : ''}`];
  if (query.note) lines.push(query.note);
  for (const e of query.events) {
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: ZONE }).format(new Date(e.start));
    lines.push(`${e.date} ${weekday} ${e.start.slice(11, 16)}–${e.end.slice(11, 16)}${e.status === 'cancelled' ? ' 【停课】' : e.status === 'adjusted' ? ' 【调课】' : ''}\n${e.title}\n教室：${e.room || '待定'} · 教师：${e.teacher || '待定'}`);
  }
  const stale = +now - Date.parse(schedule.fetchedAt) > maxAgeHours * 3_600_000;
  lines.push(`最后同步：${localTime(schedule.fetchedAt)}${stale ? '（数据已过期，请刷新课表）' : ''}`);
  return lines.join('\n\n');
}

export function diffSchedules(previous, next) {
  if (!previous) return { added: [], removed: [], updated: [] };
  const before = new Map(previous.events.map(e => [e.id, e]));
  const after = new Map(next.events.map(e => [e.id, e]));
  return {
    added: next.events.filter(e => !before.has(e.id)),
    removed: previous.events.filter(e => !after.has(e.id)),
    updated: next.events.filter(e => before.has(e.id) && JSON.stringify(before.get(e.id)) !== JSON.stringify(e)),
  };
}

export function dueReminders(schedule, now, minutes = 30, maxAgeHours = 48) {
  if (+now - Date.parse(schedule.fetchedAt) > maxAgeHours * 3_600_000) return [];
  return schedule.events.filter(e => e.status !== 'cancelled' && +now >= Date.parse(e.start) - minutes * 60_000 && +now < Date.parse(e.start))
    .map(event => ({ key: `class:${event.id}:${minutes}`, event, minutesLeft: Math.ceil((Date.parse(event.start) - +now) / 60_000) }));
}
