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

    const languages = (params.languages || [])
      .map(toIso639_1Upper)
      .filter(Boolean);

    let subs = [];
    let resolvedImdb = '';

    // 1) Пробуем то, что нам дали (imdb_id → tmdb_id), и заодно запоминаем, удалось ли
    //    кому-то ответить непустым списком.
    if (params.imdb_id) {
      const res = await this.fetchOnce('imdb_id', params.imdb_id, params, languages);
      if (res.subtitles.length) subs = res.subtitles;
    }
    if (!subs.length && params.tmdb_id) {
      const res = await this.fetchOnce('tmdb_id', params.tmdb_id, params, languages);
      if (res.subtitles.length) subs = res.subtitles;
    }

    // 2) Если до сих пор пусто, но есть название — делаем title-поиск без фильтров,
    //    чтобы получить sd_id/imdb_id шоу, и повторяем запрос по этому imdb_id.
    //    Это особенно важно для аниме: SubDL заводит каждый сезон под своим imdb,
    //    а Lampa/TMDB иногда отдают совсем другой id.
    if (!subs.length && params.query) {
      const res = await this.fetchOnce('film_name', params.query, { season: '', episode: '' }, languages);
      const candidates = (res.results || []).filter((r) => r && r.imdb_id);
      const tvOnly = candidates.filter((r) => r.type === 'tv');
      const byTmdb = params.tmdb_id ? candidates.find((r) => String(r.tmdb_id || '') === String(params.tmdb_id)) : null;
      const best = byTmdb || tvOnly[0] || candidates[0];

      if (best && best.imdb_id && best.imdb_id !== params.imdb_id) {
        resolvedImdb = best.imdb_id;
        const retry = await this.fetchOnce('imdb_id', best.imdb_id, params, languages);
        if (retry.subtitles.length) subs = retry.subtitles;
      }
      // Если показ не нашёлся, отдаём хоть что-то из title-поиска.
      if (!subs.length) subs = res.subtitles;
    }

    if (params.episode && subs.length) {
      const wantEp = Number(params.episode);
      const wantSe = Number(params.season || 0);
      const filtered = subs.filter((s) => {
        const ep = s.episode;
        const se = s.season;
        if (wantSe && se != null && se !== '' && Number(se) !== wantSe) return false;
        if (ep == null || ep === '') return true;
        return Number(ep) === wantEp;
      });
      // На аниме нумерация сезонов часто странная; если фильтр всё убил — отдаём raw.
      subs = filtered.length ? filtered : subs;
    }

    if (resolvedImdb) {
      // Полезно для дебага: видно, что мы дотащились до правильного шоу не сразу.
      subs.forEach((s) => { if (s && !s._resolved_imdb) s._resolved_imdb = resolvedImdb; });
    }

    return subs;
  }

  async fetchOnce(identifierKey, identifierValue, params, languages) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('subs_per_page', '30');
    url.searchParams.set(identifierKey, String(identifierValue));

    if (params.season) url.searchParams.set('season_number', String(params.season));
    if (params.episode) url.searchParams.set('episode_number', String(params.episode));
    // SubDL принимает `year` как мягкую подсказку (не строгий фильтр) — улучшает релевантность.
    if (params.year) url.searchParams.set('year', String(params.year));
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

    if (!json || json.status !== true) return { subtitles: [], results: [] };
    return {
      subtitles: Array.isArray(json.subtitles) ? json.subtitles : [],
      results: Array.isArray(json.results) ? json.results : []
    };
  }

  toOpenSubtitlesShape(items, context) {
    const ctx = context || {};
    return (items || []).map((item, index) => {
      const path = String(item.url || '').trim();
      if (!path) return null;

      const id = 'subdl-' + (item.sd_id || item.subtitlePage || (path + '#' + index));
      const lang = toIso639_2(item.lang || item.language);
      const params = new URLSearchParams();
      params.set('path', path);
      if (ctx.episode) params.set('episode', String(ctx.episode));
      if (ctx.season) params.set('season', String(ctx.season));
      const downloadProxy = this.publicBaseUrl + '/v1/external/subtitles/file?' + params.toString();

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
        _source: 'subdl',
        // Если сервер достал имя шоу через title-резолв — пробрасываем правильный IMDb
        // обратно в плагин, чтобы он мог дёрнуть им REST OpenSubtitles.
        _resolved_imdb: item._resolved_imdb || ''
      };
    }).filter(Boolean);
  }

  async fetchSrt(zipPath, context) {
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
    const ctx = context || {};

    const srtEntries = entries.filter((e) => /\.srt$/i.test(e.entryName));
    if (srtEntries.length) {
      const pick = pickEpisodeEntry(srtEntries, ctx.season, ctx.episode);
      return pick.getData().toString('utf8');
    }

    const vttEntries = entries.filter((e) => /\.vtt$/i.test(e.entryName));
    if (vttEntries.length) {
      const pick = pickEpisodeEntry(vttEntries, ctx.season, ctx.episode);
      return pick.getData().toString('utf8');
    }

    const assEntries = entries.filter((e) => /\.(ass|ssa)$/i.test(e.entryName));
    if (assEntries.length) {
      const pick = pickEpisodeEntry(assEntries, ctx.season, ctx.episode);
      return convertAssToSrt(pick.getData().toString('utf8'));
    }

    throw new HttpError(502, 'No supported subtitle file inside SubDL archive');
  }
}

function pickEpisodeEntry(entries, season, episode) {
  if (!entries || !entries.length) return null;
  if (entries.length === 1 || !episode) return entries[0];

  const ep = String(episode).padStart(2, '0');
  const se = season ? String(season).padStart(2, '0') : null;

  const exactSe = entries.find((e) => se && new RegExp(`s${se}\\s*e${ep}\\b`, 'i').test(e.entryName));
  if (exactSe) return exactSe;

  const exactEp = entries.find((e) => new RegExp(`(?:^|[^\\d])(?:s\\d{1,2}\\s*)?e${ep}(?!\\d)`, 'i').test(e.entryName));
  if (exactEp) return exactEp;

  const seriesPattern = entries.find((e) => new RegExp(`\\b\\d{1,2}x${ep}\\b`, 'i').test(e.entryName));
  if (seriesPattern) return seriesPattern;

  const numberOnly = entries.find((e) => {
    const match = e.entryName.match(/(?:^|[^\d])(\d{2,3})(?:[^\d]|$)/);
    return match && Number(match[1]) === Number(episode);
  });
  if (numberOnly) return numberOnly;

  return entries[0];
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
