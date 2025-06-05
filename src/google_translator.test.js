import { translate_with_google } from './google_translator.js';

// Mock environment variables for testing
const mockEnv = {
  GOOGLE_CLOUD_PROJECT_ID: 'test-project-123',
  GOOGLE_TRANSLATE_ACCESS_TOKEN: 'mock-access-token'
};

// Mock getISO2ForModel function
function mockGetISO2ForModel(iso3) {
  const mapping = {
    'eng': 'en',
    'spa': 'es',
    'fra': 'fr',
    'deu': 'de',
    'ita': 'it',
    'por': 'pt',
    'rus': 'ru',
    'jpn': 'ja',
    'kor': 'ko',
    'cmn': 'zh'
  };
  return mapping[iso3] || null;
}

// Test basic translation request
async function testBasicTranslation() {
  console.log('Testing basic Google Translate request...');
  
  const mockRequest = {
    json: async () => ({
      text: 'Hello world',
      tgt_langs: ['spa', 'fra']
    })
  };

  try {
    const response = await translate_with_google(mockRequest, mockEnv, mockGetISO2ForModel);
    const result = await response.json();
    console.log('Basic translation result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Basic translation test failed:', error.message);
  }
}

// Test with unsupported language
async function testUnsupportedLanguage() {
  console.log('Testing with unsupported language...');
  
  const mockRequest = {
    json: async () => ({
      text: 'Hello world',
      tgt_langs: ['xyz', 'spa'] // xyz is unsupported
    })
  };

  try {
    const response = await translate_with_google(mockRequest, mockEnv, mockGetISO2ForModel);
    const result = await response.json();
    console.log('Unsupported language result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Unsupported language test failed:', error.message);
  }
}

// Test with source language
async function testWithSourceLanguage() {
  console.log('Testing with source language specified...');
  
  const mockRequest = {
    json: async () => ({
      text: 'Bonjour le monde',
      src_lang: 'fra',
      tgt_langs: ['eng', 'spa']
    })
  };

  try {
    const response = await translate_with_google(mockRequest, mockEnv, mockGetISO2ForModel);
    const result = await response.json();
    console.log('Source language result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Source language test failed:', error.message);
  }
}

// Test missing credentials
async function testMissingCredentials() {
  console.log('Testing missing credentials...');
  
  const mockRequest = {
    json: async () => ({
      text: 'Hello world',
      tgt_langs: ['spa']
    })
  };

  const emptyEnv = {}; // No credentials

  try {
    const response = await translate_with_google(mockRequest, emptyEnv, mockGetISO2ForModel);
    const result = await response.json();
    console.log('Missing credentials result:', JSON.stringify(result, null, 2));
    console.log('Status:', response.status);
  } catch (error) {
    console.error('Missing credentials test failed:', error.message);
  }
}

// Run tests
async function runTests() {
  console.log('=== Google Translate Tests ===\n');
  
  await testMissingCredentials();
  console.log('\n---\n');
  
  await testBasicTranslation();
  console.log('\n---\n');
  
  await testUnsupportedLanguage();
  console.log('\n---\n');
  
  await testWithSourceLanguage();
  
  console.log('\n=== Tests Complete ===');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
