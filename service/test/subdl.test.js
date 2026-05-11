import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { convertAssToSrt, Subdl } from '../src/subdl.js';

function makeZip(entries) {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

function srtBlock(line) {
  return [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    line,
    ''
  ].join('\n');
}

function testSubdl() {
  return new Subdl({
    subdl: { apiKey: 'test', timeoutMs: 1000 },
    publicBaseUrl: 'https://example.test'
  });
}

function withFetchStub(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return fn().finally(() => { globalThis.fetch = original; });
}

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

test('Subdl.fetchSrt picks the SxxExx entry from a season ZIP', async () => {
  const zip = makeZip([
    ['Kaiju.No.8.S01E01.srt', srtBlock('Episode 1 line')],
    ['Kaiju.No.8.S01E20.srt', srtBlock('Episode 20 line')],
    ['Kaiju.No.8.S01E23.srt', srtBlock('Episode 23 line')]
  ]);

  const subdl = testSubdl();
  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
  }), async () => {
    const out = await subdl.fetchSrt('/test.zip', { season: 1, episode: 20 });
    assert.match(out, /Episode 20 line/);
    assert.doesNotMatch(out, /Episode 1 line/);
    assert.doesNotMatch(out, /Episode 23 line/);
  });
});

test('Subdl.fetchSrt falls back to first entry when episode unknown', async () => {
  const zip = makeZip([
    ['Kaiju.No.8.E01.srt', srtBlock('A')],
    ['Kaiju.No.8.E02.srt', srtBlock('B')]
  ]);

  const subdl = testSubdl();
  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
  }), async () => {
    const out = await subdl.fetchSrt('/test.zip', {});
    assert.match(out, /A/);
  });
});

test('Subdl.search filters API results by requested episode', async () => {
  const subdl = testSubdl();
  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: true,
      subtitles: [
        { url: '/a.zip', episode: 14, season: 1, lang: 'ru' },
        { url: '/b.zip', episode: 20, season: 1, lang: 'ru' },
        { url: '/c.zip', episode: 20, season: 1, lang: 'ru' },
        { url: '/d.zip', episode: null, season: 1, lang: 'ru' },
        { url: '/e.zip', episode: 23, season: 1, lang: 'ru' }
      ]
    })
  }), async () => {
    const out = await subdl.search({ imdb_id: 'tt12345', season: 1, episode: 20, languages: ['rus'] });
    const eps = out.map((s) => s.episode);
    assert.deepEqual(eps.sort(), [20, 20, null]);
  });
});
