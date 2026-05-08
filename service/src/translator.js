import { cleanText, HttpError, sha256, sleep } from './utils.js';

function cuePlainText(cue) {
  return cleanText(cue.text || cue.value || '');
}

export function normalizeCues(cues) {
  if (!Array.isArray(cues)) return [];

  return cues.map((cue) => {
    const start = Number(cue.start_ms ?? cue.start ?? 0);
    const end = Number(cue.end_ms ?? cue.end ?? 0);
    const text = cuePlainText(cue);

    return { start, end, text };
  }).filter((cue) => cue.end > cue.start && cue.text);
}

export function sourceCharacters(cues, rawText = '') {
  const fromCues = normalizeCues(cues).reduce((sum, cue) => sum + cue.text.length, 0);
  if (fromCues > 0) return fromCues;
  return cleanText(rawText).length;
}

export function subtitleHash(cues, rawText = '') {
  const normalized = normalizeCues(cues);
  if (!normalized.length) return sha256(rawText);
  return sha256(normalized.map((cue) => `${cue.start}|${cue.end}|${cue.text}`).join('\n'));
}

function promptLanguageName(code) {
  const map = {
    eng: 'English',
    rus: 'Russian',
    spa: 'Spanish',
    fre: 'French',
    fra: 'French',
    ger: 'German',
    deu: 'German',
    ita: 'Italian',
    por: 'Portuguese',
    pol: 'Polish',
    ukr: 'Ukrainian',
    tur: 'Turkish',
    jpn: 'Japanese',
    chi: 'Chinese',
    zho: 'Chinese',
    kor: 'Korean',
    ara: 'Arabic',
    hin: 'Hindi',
    dut: 'Dutch',
    nld: 'Dutch',
    swe: 'Swedish',
    nor: 'Norwegian',
    dan: 'Danish',
    fin: 'Finnish',
    rum: 'Romanian',
    ron: 'Romanian',
    cze: 'Czech',
    ces: 'Czech',
    hun: 'Hungarian',
    gre: 'Greek',
    ell: 'Greek',
    heb: 'Hebrew',
    vie: 'Vietnamese',
    tha: 'Thai',
    ind: 'Indonesian',
    may: 'Malay',
    msa: 'Malay'
  };
  return map[String(code || '').toLowerCase()] || String(code || 'Unknown');
}

function translationItems(cues) {
  return normalizeCues(cues).map((cue, index) => ({ id: index, text: cue.text }));
}

function buildChunks(cues, config) {
  const chunks = [];
  let current = [];
  let chars = 0;

  for (const item of translationItems(cues)) {
    const itemChars = (item.text || '').length;
    if (current.length && (current.length >= config.product.chunkMaxCues || chars + itemChars > config.product.chunkMaxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += itemChars;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function maxTokens(items, config) {
  const chars = items.reduce((sum, item) => sum + (item.text || '').length, 0);
  return Math.min(config.product.chunkMaxTokens, Math.max(2048, Math.ceil(chars / 1.25) + 2200));
}

function openRouterReasoning(config) {
  const effort = String(config.openRouter.reasoningEffort || '').trim().toLowerCase();
  const payload = {};

  if (config.openRouter.reasoningExclude !== false) payload.exclude = true;
  if (effort && !['none', 'off', 'false', '0'].includes(effort)) payload.effort = effort;

  return Object.keys(payload).length ? payload : null;
}

function parseJsonFromText(text) {
  let content = String(text || '').trim();
  if (!content) throw new Error('empty response');

  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(content);
  }
  catch (error) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw error;
  }
}

function openRouterContent(json) {
  const message = json?.choices?.[0]?.message;
  const content = message?.content;

  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || '').join('');
  }

  return content || '';
}

function normalizeTranslatedItems(parsed) {
  let items = parsed?.items || parsed?.translations || parsed?.result || parsed;
  const mapped = [];

  if (!Array.isArray(items) && items && typeof items === 'object') {
    for (const key of Object.keys(items)) mapped.push({ id: key, text: items[key] });
    items = mapped;
  }

  if (!Array.isArray(items)) throw new Error('bad translation format');
  return items;
}

function translatedIdFromItem(item, fallback) {
  if (!item || typeof item === 'string') return fallback;
  if (typeof item.id !== 'undefined') return item.id;
  if (typeof item.index !== 'undefined') return item.index;
  if (typeof item.n !== 'undefined') return item.n;
  return fallback;
}

function translatedTextFromItem(item) {
  if (typeof item === 'string') return item;
  if (!item) return '';
  return item.text || item.translation || item.value || item.content || '';
}

function cloneTranslatedItems(items) {
  return (items || []).map((item, index) => ({
    id: translatedIdFromItem(item, index),
    text: translatedTextFromItem(item)
  }));
}

function chunkCacheKey(chunk) {
  return (chunk || []).map((item) => String(item?.id)).join(',');
}

function normalizeChunkItems(chunk, items) {
  const expected = new Set(chunk.map((item) => String(item.id)));

  return (items || []).map((item, index) => {
    const fallbackId = chunk[index]?.id;
    if (typeof item === 'string') return { id: fallbackId, text: item };
    if (!item || typeof item !== 'object') return item;

    const rawId = typeof item.id !== 'undefined' ? item.id : (typeof item.index !== 'undefined' ? item.index : item.n);
    const numericId = Number(rawId);

    if (expected.has(String(rawId))) return { ...item, id: rawId };
    if (Number.isFinite(numericId) && numericId >= 0 && numericId < chunk.length && chunk[numericId]) return { ...item, id: chunk[numericId].id };

    return { ...item, id: fallbackId };
  });
}

function translatedCountForChunk(chunk, items) {
  const expected = new Set(chunk.map((item) => String(item.id)));
  let count = 0;

  (items || []).forEach((item, index) => {
    const id = translatedIdFromItem(item, chunk[index]?.id);
    const text = translatedTextFromItem(item);
    if (expected.has(String(id)) && typeof text === 'string' && text.trim()) count++;
  });

  return count;
}

function applyTranslatedItems(cues, items) {
  const source = normalizeCues(cues);
  const translated = source.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }));
  const byId = new Map();
  let translatedCount = 0;

  items.forEach((item, index) => {
    const id = translatedIdFromItem(item, index);
    const text = translatedTextFromItem(item);
    if (typeof id !== 'undefined' && typeof text === 'string') byId.set(String(id), cleanText(text));
  });

  translated.forEach((cue, index) => {
    const text = byId.get(String(index));
    if (typeof text === 'string' && text.trim()) {
      cue.text = text;
      translatedCount++;
    }
  });

  if (!translatedCount) throw new Error('empty translation');
  if (translatedCount < source.length) throw new Error('partial translation');

  return translated;
}

function isSplittableTranslationError(error) {
  return /обрезал ответ|не удалось разобрать|неполный перевод|bad translation format|empty response/i.test(error?.message || '');
}

function splitChunk(chunk) {
  const middle = Math.max(1, Math.floor(chunk.length / 2));
  return [chunk.slice(0, middle), chunk.slice(middle)].filter((part) => part.length);
}

async function getCachedChunk(chunkCache, chunk) {
  if (!chunkCache?.get) return null;

  const items = await chunkCache.get(chunkCacheKey(chunk), chunk);
  if (!items?.length) return null;

  const normalized = normalizeChunkItems(chunk, items);
  if (translatedCountForChunk(chunk, normalized) >= chunk.length) {
    return cloneTranslatedItems(normalized);
  }

  return null;
}

async function saveCachedChunk(chunkCache, chunk, items) {
  if (!chunkCache?.set || !chunk?.length) return;

  const normalized = normalizeChunkItems(chunk, items);
  if (translatedCountForChunk(chunk, normalized) < chunk.length) return;

  await chunkCache.set(chunkCacheKey(chunk), cloneTranslatedItems(normalized), chunk);
}

export class Translator {
  constructor(config) {
    this.config = config;
  }

  cacheKey({ cues, rawText, sourceLanguage, targetLanguage }) {
    const sourceHash = subtitleHash(cues, rawText);
    return `v1:${this.config.openRouter.model}:${sourceLanguage}:${targetLanguage}:${sourceHash}`;
  }

  async translate({ cues, sourceLanguage, targetLanguage, onProgress, chunkCache }) {
    if (!this.config.openRouter.apiKey) throw new HttpError(500, 'OpenRouter API key is not configured');

    const chunks = buildChunks(cues, this.config);
    const translatedItems = [];

    if (!chunks.length) throw new Error('empty subtitles');
    if (onProgress) onProgress(`0/${chunks.length}`);

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const items = await this.translateChunkResilient(chunk, sourceLanguage, targetLanguage, index + 1, chunks.length, chunkCache);
      translatedItems.push(...items);
      if (onProgress) onProgress(`${index + 1}/${chunks.length}`);
      await sleep(50);
    }

    return applyTranslatedItems(cues, translatedItems);
  }

  async translateChunkResilient(chunk, sourceLanguage, targetLanguage, chunkIndex, chunkTotal, chunkCache) {
    const cached = await getCachedChunk(chunkCache, chunk);
    if (cached) return cached;

    try {
      const items = await this.translateChunkWithFallback(chunk, sourceLanguage, targetLanguage, chunkIndex, chunkTotal);
      await saveCachedChunk(chunkCache, chunk, items);
      return items;
    }
    catch (error) {
      if (chunk.length <= 1 || !isSplittableTranslationError(error)) throw error;

      const parts = splitChunk(chunk);
      const result = [];

      for (let index = 0; index < parts.length; index++) {
        const partItems = await this.translateChunkResilient(parts[index], sourceLanguage, targetLanguage, `${chunkIndex}.${index + 1}`, chunkTotal, chunkCache);
        result.push(...partItems);
      }

      await saveCachedChunk(chunkCache, chunk, result);
      return result;
    }
  }

  async translateChunkWithFallback(chunk, sourceLanguage, targetLanguage, chunkIndex, chunkTotal) {
    const models = [this.config.openRouter.model];
    if (this.config.openRouter.enableFallback && this.config.openRouter.fallbackModel && this.config.openRouter.fallbackModel !== this.config.openRouter.model) {
      models.push(this.config.openRouter.fallbackModel);
    }

    let lastError = null;
    for (const model of models) {
      try {
        return await this.translateChunk(chunk, sourceLanguage, targetLanguage, chunkIndex, chunkTotal, model);
      }
      catch (error) {
        lastError = error;
        if (/обрезал ответ/i.test(error.message || '')) break;
      }
    }

    throw lastError || new Error('translation failed');
  }

  async translateChunk(chunk, sourceLanguage, targetLanguage, chunkIndex, chunkTotal, model) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.openRouter.timeoutMs);
    const reasoning = openRouterReasoning(this.config);
    const body = {
      model,
      temperature: this.config.openRouter.temperature,
      max_tokens: maxTokens(chunk, this.config),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'subtitle_translation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      anyOf: [
                        { type: 'integer' },
                        { type: 'string' }
                      ]
                    },
                    text: { type: 'string' }
                  },
                  required: ['id', 'text'],
                  additionalProperties: false
                }
              }
            },
            required: ['items'],
            additionalProperties: false
          }
        }
      },
      messages: [
        {
          role: 'system',
          content: 'You translate one sequential chunk from a subtitle file. Preserve cue order, count, line breaks, punctuation, names, tone, and meaning. Return only valid JSON.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            source_language: promptLanguageName(sourceLanguage),
            target_language: promptLanguageName(targetLanguage),
            chunk: chunkIndex,
            total_chunks: chunkTotal,
            instructions: 'Translate every item.text in this chunk. Keep the same numeric id for every item. Do not merge, split, skip, summarize, add commentary, or wrap in Markdown. Output exactly {"items":[{"id":number,"text":"translated text"}]}.',
            items: chunk
          })
        }
      ]
    };

    if (reasoning) body.reasoning = reasoning;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.config.openRouter.referer,
          'X-OpenRouter-Title': this.config.openRouter.title
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const message = json?.error?.message || json?.message || `OpenRouter HTTP ${response.status}`;
        throw new Error(message);
      }

      if (json?.choices?.[0]?.finish_reason === 'length') {
        throw new Error(`OpenRouter обрезал ответ на части ${chunkIndex} из ${chunkTotal}`);
      }

      let items = normalizeTranslatedItems(parseJsonFromText(openRouterContent(json)));
      items = normalizeChunkItems(chunk, items);

      if (translatedCountForChunk(chunk, items) < chunk.length) {
        throw new Error(`OpenRouter вернул неполный перевод на части ${chunkIndex} из ${chunkTotal}`);
      }

      return items;
    }
    finally {
      clearTimeout(timeout);
    }
  }
}
