import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { successfulLogin, attachCourseNavigation } from '../src/login.js';
import { COURSE_URL, SITE } from '../src/paths.js';

test('login ignores the initial null-token request and authentication failures', () => {
  const success = { errorCode: '00000', data: { sectionList: [] } };
  for (const token of [null, undefined, '', ' ', 'null', 'undefined']) assert.equal(successfulLogin(success, token), false);
  assert.equal(successfulLogin({ errorCode: 'A0200' }, 'dummy-token'), false);
  assert.equal(successfulLogin(success, 'dummy-token'), true);
});
test('CAS landing on home automatically opens course page, including SPA navigation', async () => {
  const page = new EventEmitter();
  const frame = {}, navigations = [];
  let url = `${SITE}/educationalStudent/home`;
  page.url = () => url; page.mainFrame = () => frame;
  page.goto = async target => { navigations.push(target); url = target; };
  attachCourseNavigation(page);
  page.emit('framenavigated', {}); assert.equal(navigations.length, 0);
  page.emit('framenavigated', frame); page.emit('domcontentloaded');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(navigations, [COURSE_URL]);
});
