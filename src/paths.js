import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const AUTH_FILE = path.join(ROOT, '.auth.json');
export const DATA_DIR = path.join(ROOT, 'data');
export const OUTPUT_DIR = path.join(ROOT, 'output');
export const SITE = 'https://xspy.sii.edu.cn';
export const COURSE_URL = `${SITE}/educationalStudent/courseManage/courseInformation`;
export const API_BASE = `${SITE}/educationalAdministrationBackend`;
export const ENDPOINTS = {
  panel: '/studentTimetable/getTimetableDayPanel',
  courses: '/studentTimetable/getTimetableDayDataList',
  dayChanges: '/studentTimetable/getTimetableDayAdjustmentClosedInfo',
  termChanges: '/studentTimetable/getTimetableWeekAdjustmentClosedInfo',
};

export function privateDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
export function writePrivate(file, value) {
  privateDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}
