import { describe, it, expect } from 'vitest';
import { translate_with_m2m } from './m2m_translator';

// Mock environment and helper
const mapping = {
  eng: 'en',
  spa: 'es',
  jpn: 'ja',
  rus: 'ru',
};
const getISO2 = (code3) => mapping[code3] || null;

// Mock AI.run behavior
function mockAI(runImpl) {
  return { AI: { run: runImpl } };
}

// Helper to mock fetch for detect_language
function mockFetch(response) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ translations: [{ detected_source_language: response }] }),
    text: async () => JSON.stringify(response),
  });
}

describe('translate_with_m2m', () => {
  it('returns translations for supported target languages', async () => {
    const req = { json: async () => ({ text: 'hello', src_lang: 'eng', tgt_langs: ['spa'] }) };
    const env = mockAI((model, opts) => Promise.resolve({ translated_text: 'Hola' }));
    const res = await translate_with_m2m(req, env, getISO2);
    const body = await res.json();
    expect(body.spa).toBe('Hola');
    expect(body.metadata.src_lang).toBe('eng');
    expect(body.errors).toBeUndefined();
  });

  it('returns error for unsupported target language', async () => {
    const req = { json: async () => ({ text: 'hello', src_lang: 'eng', tgt_langs: ['zzz'] }) };
    const env = mockAI(() => Promise.resolve({ translated_text: 'n/a' }));
    const res = await translate_with_m2m(req, env, getISO2);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no valid target languages/i);
    expect(body.errors.unsupported_target_langs).toContain('zzz');
  });

  it('returns translations and error for mixed supported/unsupported targets', async () => {
    const req = { json: async () => ({ text: 'hello', src_lang: 'eng', tgt_langs: ['spa', 'zzz'] }) };
    const env = mockAI((model, opts) => Promise.resolve({ translated_text: 'Hola' }));
    const res = await translate_with_m2m(req, env, getISO2);
    const body = await res.json();
    expect(body.spa).toBe('Hola');
    expect(body.errors.unsupported_target_langs).toContain('zzz');
  });

  it('returns default translations when no tgt_langs provided', async () => {
    // Stub detection to return English
    mockFetch('EN');
    const req = { json: async () => ({ text: 'hello' }) };
    // AI returns texts keyed by each lang code
    const env = mockAI((model, opts) => Promise.resolve({ translated_text: opts.target_lang === 'es' ? 'Hola' : opts.target_lang === 'ja' ? 'こんにちは' : 'Привет' }));
    const res = await translate_with_m2m(req, env, getISO2);
    const body = await res.json();
    expect(body.spa).toBe('Hola');
    expect(body.jpn).toBe('こんにちは');
    expect(body.rus).toBe('Привет');
    expect(body.errors).toBeUndefined();
  });

  it('returns error when detected language cannot be mapped', async () => {
    const req = { json: async () => ({ text: 'hello' }) };
    // stub async fetch to return unknown detection
    mockFetch('XX');
    const env = { DEEPL_API_KEY: 'key', DEEPL_API_ENDPOINT: '', AI: {} };
    const res = await translate_with_m2m(req, env, getISO2);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/could not map detected source language/i);
    expect(body.detected_source_language_deepl).toBe('XX');
  });
});