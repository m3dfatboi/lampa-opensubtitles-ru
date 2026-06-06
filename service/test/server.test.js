import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedSubtitleProxyHost } from '../src/server.js';

test('subtitle proxy allows only known subtitle providers', () => {
  assert.equal(isAllowedSubtitleProxyHost('subs5.strem.io'), true);
  assert.equal(isAllowedSubtitleProxyHost('opensubtitles-v3.strem.io'), true);
  assert.equal(isAllowedSubtitleProxyHost('rest.opensubtitles.org'), true);
  assert.equal(isAllowedSubtitleProxyHost('dl.subdl.com'), true);

  assert.equal(isAllowedSubtitleProxyHost('example.com'), false);
  assert.equal(isAllowedSubtitleProxyHost('subs5.strem.io.evil.test'), false);
  assert.equal(isAllowedSubtitleProxyHost('127.0.0.1'), false);
});
