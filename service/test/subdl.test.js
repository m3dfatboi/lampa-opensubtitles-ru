import assert from 'node:assert/strict';
import test from 'node:test';
import { convertAssToSrt } from '../src/subdl.js';

test('convertAssToSrt extracts timings and stripped text from ASS dialogue', () => {
  const ass = [
    '[Script Info]',
    'Title: Test',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.50,0:00:03.75,Default,,0,0,0,,{\\i1}Hello{\\i0} world',
    'Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Line 1\\NLine 2',
    'Dialogue: 0,0:00:09.00,0:00:11.00,Default,,0,0,0,,Hard\\hspace'
  ].join('\n');

  const srt = convertAssToSrt(ass);

  assert.match(srt, /00:00:01,500 --> 00:00:03,750/);
  assert.match(srt, /Hello world/);
  assert.match(srt, /Line 1\nLine 2/);
  assert.match(srt, /Hard space/);
  assert.doesNotMatch(srt, /\\i1|\\i0|\{|\}/);
});

test('convertAssToSrt sorts dialogues by start time', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Second',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,First'
  ].join('\n');

  const srt = convertAssToSrt(ass);
  const firstPos = srt.indexOf('First');
  const secondPos = srt.indexOf('Second');

  assert.ok(firstPos >= 0 && secondPos >= 0);
  assert.ok(firstPos < secondPos, 'first dialogue should appear before the later one');
});

test('convertAssToSrt skips dialogues with empty cleaned text', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\fad(300,300)}',
    'Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Real text'
  ].join('\n');

  const srt = convertAssToSrt(ass);

  assert.match(srt, /Real text/);
  assert.doesNotMatch(srt, /fad/);
  const blockCount = srt.trim().split(/\n\n/).length;
  assert.equal(blockCount, 1, 'only one cue should survive');
});
