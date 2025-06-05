import { describe, it, expect, beforeEach } from 'vitest';
import { handleMultiRequest } from './multi_translator.js';

// Mock environment with all translator APIs
const createMockEnv = (overrides = {}) => ({
  DEEPL_API_KEY: 'test-deepl-key',
  DEEPL_API_ENDPOINT: 'http://localhost:9999/v2/translate',
  GOOGLE_CLOUD_PROJECT_ID: 'test-project-123',
  GOOGLE_TRANSLATE_ACCESS_TOKEN: 'test-google-token',
  OPENAI_API_KEY: 'test-openai-key',
  AI: {
    run: async (model, params) => {
      // Mock M2M translator response
      return { translated_text: `M2M-${params.target_lang}-translation` };
    }
  },
  ...overrides
});

// Mock fetch for external APIs
function mockFetch(responses) {
  let callCount = 0;
  globalThis.fetch = async (url, options) => {
    const response = responses[callCount++] || responses[responses.length - 1];
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.data || response,
      text: async () => JSON.stringify(response.data || response)
    };
  };
}

// Helper to create request object
function createRequest(data) {
  return {
    json: async () => data
  };
}

describe('Multi Translator Fallback Logic', () => {
  beforeEach(() => {
    // Reset fetch mock
    globalThis.fetch = undefined;
  });

  it('should successfully translate with primary translators', async () => {
    // Mock successful DeepL response
    mockFetch([
      {
        ok: true,
        data: {
          translations: [
            { text: 'Hola', detected_source_language: 'EN' }
          ]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'deu', 'fra'] // Languages supported by DeepL
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    expect(result.spa).toBeDefined();
    expect(result.metadata.translators.deepl).toContain('spa');
    expect(result.errors).toBeUndefined();
  });

  it('should fall back to alternative translators when primary fails', async () => {
    // Mock DeepL failure, then M2M success
    mockFetch([
      {
        ok: false,
        status: 500,
        data: { error: 'DeepL API Error' }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'fra'] // Languages supported by both DeepL and M2M
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Fallback test result:', JSON.stringify(result, null, 2));

    // Should have successful M2M translations as fallback
    expect(result.spa).toBeDefined();
    expect(result.fra).toBeDefined();
    expect(result.metadata.translators.m2m).toBeDefined();
    expect(result.metadata.translators.m2m.length).toBeGreaterThan(0);
  });

  it('should handle mixed success and failure scenarios', async () => {
    // Mock DeepL success for some languages, failure for others
    let callCount = 0;
    globalThis.fetch = async (url, options) => {
      callCount++;
      // First call succeeds (for one language), second fails
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            translations: [{ text: 'Hola', detected_source_language: 'EN' }]
          })
        };
      } else {
        return {
          ok: false,
          status: 429, // Rate limit error
          json: async () => ({ error: 'Rate limit exceeded' })
        };
      }
    };

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'deu', 'fra']
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Mixed scenario result:', JSON.stringify(result, null, 2));

    // Should have some successful translations
    expect(Object.keys(result).filter(key => !['metadata', 'errors'].includes(key)).length).toBeGreaterThan(0);
    expect(result.metadata.translators).toBeDefined();
  });

  it('should handle complete translator failure gracefully', async () => {
    // Mock all external APIs failing
    mockFetch([
      { ok: false, status: 500, data: { error: 'DeepL failed' } }
    ]);

    // Also mock AI.run to fail
    const env = createMockEnv({
      AI: {
        run: async () => {
          throw new Error('M2M model unavailable');
        }
      }
    });

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'deu']
    });

    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Complete failure result:', JSON.stringify(result, null, 2));

    // Should still return a valid response structure
    expect(result.metadata).toBeDefined();
    expect(response.status).toBe(200); // Multi translator shouldn't crash
  });

  it('should handle unsupported languages correctly', async () => {
    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'zzz', 'xxx'] // Mix of supported and unsupported
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Unsupported languages result:', JSON.stringify(result, null, 2));

    expect(result.errors?.unsupported_target_langs).toContain('zzz');
    expect(result.errors?.unsupported_target_langs).toContain('xxx');
    expect(result.spa).toBeDefined(); // Supported language should still work
  });

  it('should preserve original text in response', async () => {
    mockFetch([
      {
        ok: true,
        data: {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello world',
      tgt_langs: ['spa']
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    // Should include the original text (exact key depends on source language detection)
    const hasOriginalText = Object.values(result).includes('Hello world') ||
                           result.eng === 'Hello world' ||
                           result.source === 'Hello world';
    expect(hasOriginalText).toBe(true);
  });

  it('should handle OpenAI fallback correctly', async () => {
    // Mock DeepL and M2M failures
    mockFetch([
      { ok: false, status: 500, data: { error: 'DeepL failed' } },
      { ok: true, data: { choices: [{ message: { content: '{"spa": "¡Hola!", "fra": "Salut!"}' } }] } }
    ]);

    const env = createMockEnv({
      AI: {
        run: async () => {
          throw new Error('M2M failed');
        }
      }
    });

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'fra']
    });

    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('OpenAI fallback result:', JSON.stringify(result, null, 2));

    // Should have OpenAI as fallback translator in metadata
    expect(result.metadata.translators.openai).toBeDefined();
  });

  it('should maintain proper metadata about which translators were used', async () => {
    // Mock DeepL success for some, M2M success for others
    let deeplCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (url.includes('deepl') || url.includes('v2/translate')) {
        deeplCalls++;
        if (deeplCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              translations: [{ text: 'Hola', detected_source_language: 'EN' }]
            })
          };
        } else {
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: 'Rate limit' })
          };
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"deu": "Hallo"}' } }] })
      };
    };

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa', 'deu', 'fra']
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Metadata test result:', JSON.stringify(result, null, 2));

    expect(result.metadata.translators).toBeDefined();
    
    // Should track which translators were actually used
    const usedTranslators = Object.keys(result.metadata.translators);
    expect(usedTranslators.length).toBeGreaterThan(0);
    
    // Should have proper language assignments
    for (const [translator, languages] of Object.entries(result.metadata.translators)) {
      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
    }
  });

  it('should handle empty target languages gracefully', async () => {
    const request = createRequest({
      text: 'Hello',
      tgt_langs: []
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toMatch(/no target languages provided/i);
  });

  it('should handle string format target languages', async () => {
    mockFetch([
      {
        ok: true,
        data: {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: 'spa,fra,deu' // String format
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    expect(result.spa).toBeDefined();
    expect(Object.keys(result.metadata.translators).length).toBeGreaterThan(0);
  });

  it('should handle Google Translate in multi-translator system', async () => {
    // Mock Google Translate API response
    mockFetch([
      {
        ok: true,
        data: {
          translations: [
            {
              translatedText: "Hola mundo",
              detectedLanguageCode: "en"
            }
          ]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello world',
      tgt_langs: ['spa']  // Spanish - should be handled by Google if prioritized
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    console.log('Google Translate test result:', JSON.stringify(result, null, 2));
    
    expect(result.spa).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.metadata.translator).toBeDefined();
  });

  it('should use preferred translator for language detection', async () => {
    // Mock Google Translate API responses - first for detection, then for translation
    mockFetch([
      {
        ok: true,
        data: {
          translations: [
            {
              translatedText: "Hello",
              detectedLanguageCode: "en"
            }
          ]
        }
      },
      {
        ok: true,
        data: {
          translations: [
            {
              translatedText: "Hola",
              detectedLanguageCode: "en"
            }
          ]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa'],
      detection_preference: 'google'  // Prefer Google for detection
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    expect(result.metadata.detection_preference).toBe('google');
    expect(result.metadata.detection_used_translator).toBe('google');
    expect(result.metadata.detected_source_language).toBeDefined();
  });

  it('should validate detection_preference parameter', async () => {
    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa'],
      detection_preference: 'invalid'  // Invalid preference
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toMatch(/invalid detection_preference/i);
  });

  it('should handle detection preference fallback when preferred translator fails', async () => {
    // Mock Google Translate detection failure
    mockFetch([
      {
        ok: false,
        status: 500,
        data: { error: 'Google detection failed' }
      },
      {
        ok: true,
        data: {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa'],
      detection_preference: 'google'
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    expect(result.metadata.detection_preference).toBe('google');
    // Should not have detection_used_translator since detection failed
    expect(result.metadata.detection_used_translator).toBe(null);
    expect(result.spa).toBeDefined(); // Translation should still work
  });

  it('should default to auto detection when no preference specified', async () => {
    mockFetch([
      {
        ok: true,
        data: {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }]
        }
      }
    ]);

    const request = createRequest({
      text: 'Hello',
      tgt_langs: ['spa']
      // No detection_preference specified
    });

    const env = createMockEnv();
    const response = await handleMultiRequest(request, env);
    const result = await response.json();

    expect(result.metadata.detection_preference).toBe('auto');
    expect(result.metadata.detection_used_translator).toBe(null);
  });
});
