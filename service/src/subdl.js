import AdmZip from 'adm-zip';
import { HttpError } from './utils.js';

const SEARCH_URL = 'https://api.subdl.com/api/v1/subtitles';
const DOWNLOAD_HOST = 'https://dl.subdl.com';

const LANG_ISO1_TO_ISO2 = {
  en: 'eng', ru: 'rus', es: 'spa', fr: 'fre', de: 'ger', it: 'ita',
  pt: 'por', pl: 'pol', uk: 'ukr', tr: 'tur', ja: 'jpn', zh: 'chi',
  ko: 'kor', ar: 'ara', hi: 'hin', nl: 'dut', sv: 'swe', no: 'nor',
  da: 'dan', fi: 'fin', ro: 'rum', cs: 'cze', hu: 'hun', el: 'gre',
  he: 'heb', vi: 'vie', th: 'tha', id: 'ind', ms: 'may'
};

const LANG_ISO2_TO_ISO1 = Object.keys(LANG_ISO1_TO_ISO2).reduce((acc, k) => {
  acc[LANG_ISO1_TO_ISO2[k]] = k.toUpperCase();
  return acc;
}, {});

function toIso639_2(code) {
  const lower = String(code || '').toLowerCase();
  if (LANG_ISO1_TO_ISO2[lower]) return LANG_ISO1_TO_ISO2[lower];
  if (lower.length === 3) return lower;
  return lower;
}

function toIso639_1Upper(code) {
  const lower = String(code || '').toLowerCase();
  if (LANG_ISO2_TO_ISO1[lower]) return LANG_ISO2_TO_ISO1[lower];
  if (lower.length === 2) return lower.toUpperCase();
  return '';
}

export class Subdl {
  constructor(config) {
    this.apiKey = config.subdl.apiKey;
    this.timeoutMs = config.subdl.timeoutMs;
    this.publicBaseUrl = config.publicBaseUrl;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async search(params) {
    if (!this.isConfigured()) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('subs_per_page', '30');

    if (params.imdb_id) url.searchParams.set('imdb_id', String(params.imdb_id));
    else if (params.tmdb_id) url.searchParams.set('tmdb_id', String(params.tmdb_id));
    else if (params.query) url.searchParams.set('film_name', String(params.query));
    else return [];

    if (params.season) url.searchParams.set('season_number', String(params.season));
    if (params.episode) url.searchParams.set('episode_number', String(params.episode));

    const languages = (params.languages || [])
      .map(toIso639_1Upper)
      .filter(Boolean);
    if (languages.length) url.searchParams.set('languages', languages.join(','));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let json;
    try {
      const response = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
      if (!response.ok) throw new HttpError(response.status, `SubDL HTTP ${response.status}`);
      json = await response.json();
    }
    finally {
      clearTimeout(timer);
    }

    if (!json || json.status !== true) return [];
    return Array.isArray(json.subtitles) ? json.subtitles : [];
  }

  toOpenSubtitlesShape(items) {
    return (items || []).map((item, index) => {
      const path = String(item.url || '').trim();
      if (!path) return null;

      const id = 'subdl-' + (item.sd_id || item.subtitlePage || (path + '#' + index));
      const lang = toIso639_2(item.lang || item.language);
      const downloadProxy = this.publicBaseUrl + '/v1/external/subtitles/file?path=' + encodeURIComponent(path);

      return {
        IDSubtitle: id,
        IDSubtitleFile: id,
        MovieName: String(item.name || item.full_season || '').trim(),
        MovieYear: String(item.year || ''),
        MovieReleaseName: String(item.release_name || '').trim(),
        SubLanguageID: lang,
        SubDownloadsCnt: String(item.subtitle_downloads || 0),
        SubFormat: 'srt',
        SubDownloadLink: downloadProxy,
        _source: 'subdl'
      };
    }).filter(Boolean);
  }

  async fetchSrt(zipPath) {
    if (!zipPath) throw new HttpError(400, 'Empty SubDL path');
    const url = /^https?:\/\//i.test(zipPath) ? zipPath : DOWNLOAD_HOST + (zipPath.startsWith('/') ? '' : '/') + zipPath;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let buffer;
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!response.ok) throw new HttpError(response.status, `SubDL download HTTP ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
    }
    finally {
      clearTimeout(timer);
    }

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    const srt = entries.find((e) => /\.srt$/i.test(e.entryName));
    if (srt) return srt.getData().toString('utf8');

    const vtt = entries.find((e) => /\.vtt$/i.test(e.entryName));
    if (vtt) return vtt.getData().toString('utf8');

    const ass = entries.find((e) => /\.(ass|ssa)$/i.test(e.entryName));
    if (ass) return convertAssToSrt(ass.getData().toString('utf8'));

    throw new HttpError(502, 'No supported subtitle file inside SubDL archive');
  }
}

function assTimeToSrt(t) {
  const match = String(t || '').trim().match(/^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,3})$/);
  if (!match) return '00:00:00,000';
  const h = match[1].padStart(2, '0');
  const m = match[2].padStart(2, '0');
  const s = match[3].padStart(2, '0');
  const ms = (match[4] + '000').slice(0, 3);
  return `${h}:${m}:${s},${ms}`;
}

function cleanAssText(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/gi, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

export function convertAssToSrt(assText) {
  const lines = String(assText || '').split(/\r?\n/);
  const dialogues = [];
  let format = null;
  let startIdx = 1;
  let endIdx = 2;
  let textIdx = 9;

  for (const line of lines) {
    if (line.startsWith('Format:') && format === null) {
      const fields = line.substring(7).split(',').map((s) => s.trim().toLowerCase());
      const fmtStart = fields.indexOf('start');
      const fmtEnd = fields.indexOf('end');
      const fmtText = fields.indexOf('text');
      if (fmtStart >= 0) startIdx = fmtStart;
      if (fmtEnd >= 0) endIdx = fmtEnd;
      if (fmtText >= 0) textIdx = fmtText;
      format = fields;
      continue;
    }
    if (!line.startsWith('Dialogue:')) continue;

    const parts = line.substring(9).split(',');
    if (parts.length < Math.max(startIdx, endIdx, textIdx) + 1) continue;

    const start = parts[startIdx];
    const end = parts[endIdx];
    const text = cleanAssText(parts.slice(textIdx).join(','));
    if (!text) continue;

    dialogues.push({
      startMs: assTimeToMs(start),
      start: assTimeToSrt(start),
      end: assTimeToSrt(end),
      text
    });
  }

  dialogues.sort((a, b) => a.startMs - b.startMs);

  const out = [];
  for (let i = 0; i < dialogues.length; i++) {
    out.push(String(i + 1));
    out.push(`${dialogues[i].start} --> ${dialogues[i].end}`);
    out.push(dialogues[i].text);
    out.push('');
  }
  return out.join('\n');
}

function assTimeToMs(t) {
  const match = String(t || '').trim().match(/^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,3})$/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const cs = Number((match[4] + '00').slice(0, 3));
  return ((h * 3600) + (m * 60) + s) * 1000 + cs;
}
