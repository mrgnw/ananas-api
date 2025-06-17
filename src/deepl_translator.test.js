import { describe, it, expect } from 'vitest';
import { translate_with_deepl } from './deepl_translator';

// Mock env with a fake DeepL API key and endpoint
const env = {
  DEEPL_API_KEY: 'test-key',
  DEEPL_API_ENDPOINT: 'http://localhost:9999/v2/translate', // You can mock fetch for this endpoint
};

// Helper to mock fetch responses
function mockFetch(response, ok = true) {
  globalThis.fetch = async () => ({
    ok,
    json: async () => response,
    text: async () => JSON.stringify(response),
    status: ok ? 200 : 400,
  });
}

describe('translate_with_deepl', () => {
  it('returns translations for supported languages', async () => {
    mockFetch({ translations: [{ text: 'Hallo', detected_source_language: 'EN' }] });
    const req = { json: async () => ({ text: 'hello', tgt_langs: ['deu'] }) };
    const res = await translate_with_deepl(req, env, () => 'de');
    const body = await res.json();
    expect(body.deu).toBe('Hallo');
    expect(body.errors).toBeUndefined();
  });

  it('maps 3-letter code to regional DeepL code', async () => {
    mockFetch({ translations: [{ text: 'Olá', detected_source_language: 'EN' }] });
    const req = { json: async () => ({ text: 'hello', tgt_langs: ['por'] }) };
    const res = await translate_with_deepl(req, env, () => 'pt');
    const body = await res.json();
    expect(body.por).toBe('Olá');
    expect(body.errors).toBeUndefined();
  });

  it('returns error for unsupported target language', async () => {
    const req = { json: async () => ({ text: 'hello', tgt_langs: ['zzz'] }) };
    const res = await translate_with_deepl(req, env, () => null);
    const body = await res.json();
    expect(body.errors.unsupported_target_langs).toContain('zzz');
  });

  it('returns translations and error for mixed supported/unsupported', async () => {
    mockFetch({ translations: [{ text: 'Hallo', detected_source_language: 'EN' }] });
    const req = { json: async () => ({ text: 'hello', tgt_langs: ['deu', 'zzz'] }) };
    const res = await translate_with_deepl(req, env, (code) => code === 'deu' ? 'de' : null);
    const body = await res.json();
    expect(body.deu).toBe('Hallo');
    expect(body.errors.unsupported_target_langs).toContain('zzz');
  });

  it('returns error if no target languages provided', async () => {
    const req = { json: async () => ({ text: 'hello' }) };
    const res = await translate_with_deepl(req, env, () => null);
    const body = await res.json();
    expect(body.error).toMatch(/no target languages provided/i);
  });

  it('returns error if no text provided', async () => {
    const req = { json: async () => ({ tgt_langs: ['deu'] }) };
    const res = await translate_with_deepl(req, env, () => 'de');
    const body = await res.json();
    expect(body.error).toMatch(/missing 'text'/i);
  });

  it('returns translation and correct metadata for provided src_lang', async () => {
    mockFetch({ translations: [{ text: 'Hallo', detected_source_language: 'EN' }] });
    const req = { json: async () => ({ text: 'hello', src_lang: 'eng', tgt_langs: ['deu'] }) };
    const res = await translate_with_deepl(req, env, () => 'de');
    const body = await res.json();
    expect(body.deu).toBe('Hallo');
    expect(body.metadata.src_lang).toBe('eng');
  });

  it('returns error for unsupported src_lang', async () => {
    const req = { json: async () => ({ text: 'hello', src_lang: 'zzz', tgt_langs: ['deu'] }) };
    const res = await translate_with_deepl(req, env, () => null);
    const body = await res.json();
    expect(body.errors.unsupported_source_lang).toBeDefined();
  });
});
