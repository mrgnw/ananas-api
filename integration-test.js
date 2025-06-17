#!/usr/bin/env node

/**
 * Integration test script for ananas-api
 * Tests all translator endpoints with real API calls
 * 
 * Usage:
 * bun run integration-test.js [--endpoint=http://localhost:8787] [--text="Hello world"]
 */

// Note: Using bun which has native fetch support

const API_BASE = process.argv.find(arg => arg.startsWith('--endpoint='))?.split('=')[1] || 'http://localhost:8787';
const TEST_TEXT = process.argv.find(arg => arg.startsWith('--text='))?.split('=')[1] || 'Hello world';
const TARGET_LANGS = ['spa', 'fra', 'deu']; // Spanish, French, German

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(endpoint, payload, description, method = 'POST') {
  log(`\n📡 Testing ${description}...`, 'cyan');
  log(`   Endpoint: ${method} ${API_BASE}${endpoint}`, 'blue');
  if (method === 'POST') {
    log(`   Payload: ${JSON.stringify(payload, null, 2)}`, 'blue');
  }
  
  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (method === 'POST') {
      options.body = JSON.stringify(payload);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);

    const data = await response.json();
    
    if (response.ok) {
      log(`   ✅ Success (${response.status})`, 'green');
      
      // Show translations
      const translations = Object.entries(data)
        .filter(([key]) => !['metadata', 'errors'].includes(key))
        .map(([lang, text]) => `     ${lang}: "${text}"`)
        .join('\n');
      
      if (translations) {
        log(`   Translations:`, 'green');
        log(translations, 'green');
      }
      
      // Show metadata
      if (data.metadata) {
        const metadataStr = Object.entries(data.metadata)
          .map(([key, value]) => `     ${key}: ${JSON.stringify(value)}`)
          .join('\n');
        log(`   Metadata:`, 'yellow');
        log(metadataStr, 'yellow');
      }
      
      // Show errors if any
      if (data.errors) {
        log(`   Warnings:`, 'yellow');
        log(`     ${JSON.stringify(data.errors)}`, 'yellow');
      }
      
      return { success: true, data };
    } else {
      log(`   ❌ Failed (${response.status})`, 'red');
      log(`   Error: ${JSON.stringify(data, null, 2)}`, 'red');
      return { success: false, error: data };
    }
  } catch (error) {
    log(`   💥 Network Error: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function runIntegrationTests() {
  log('🚀 Starting API Integration Tests', 'bright');
  log(`📍 Base URL: ${API_BASE}`, 'cyan');
  log(`📝 Test Text: "${TEST_TEXT}"`, 'cyan');
  log(`🎯 Target Languages: ${TARGET_LANGS.join(', ')}`, 'cyan');
  
  // Quick connectivity test
  log('\n🔗 Testing basic connectivity...', 'cyan');
  try {
    const testResponse = await fetch(API_BASE);
    log(`   Connection successful! (Status: ${testResponse.status})`, 'green');
  } catch (error) {
    log(`   ❌ Cannot connect to ${API_BASE}`, 'red');
    log(`   Error: ${error.message}`, 'red');
    log(`   Make sure the development server is running with: bun run dev`, 'yellow');
    process.exit(1);
  }
  
  const results = {};
  
  // Test 1: GET endpoint (health check)
  log('\n' + '='.repeat(60), 'bright');
  const getResult = await testEndpoint('/', {}, 'GET Health Check', 'GET');
  if (getResult.success) {
    log('   Sample response shows API is alive!', 'green');
  }
  results.health = getResult;
  
  // Test 2: M2M Translator
  log('\n' + '='.repeat(60), 'bright');
  const m2mResult = await testEndpoint('/m2m', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS
  }, 'M2M Translator');
  results.m2m = m2mResult;
  
  // Test 3: DeepL Translator
  log('\n' + '='.repeat(60), 'bright');
  const deeplResult = await testEndpoint('/deepl', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS
  }, 'DeepL Translator');
  results.deepl = deeplResult;
  
  // Test 4: Google Translator
  log('\n' + '='.repeat(60), 'bright');
  const googleResult = await testEndpoint('/google', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS
  }, 'Google Translator');
  results.google = googleResult;
  
  // Test 5: OpenAI Translator
  log('\n' + '='.repeat(60), 'bright');
  const openaiResult = await testEndpoint('/openai', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS
  }, 'OpenAI Translator');
  results.openai = openaiResult;
  
  // Test 6: Multi Translator (default)
  log('\n' + '='.repeat(60), 'bright');
  const multiResult = await testEndpoint('/multi', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS
  }, 'Multi Translator (auto detection)');
  results.multi = multiResult;
  
  // Test 7: Multi Translator with Google detection preference
  log('\n' + '='.repeat(60), 'bright');
  const multiGoogleResult = await testEndpoint('/multi', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS,
    detection_preference: 'google'
  }, 'Multi Translator (Google detection preference)');
  results.multiGoogle = multiGoogleResult;
  
  // Test 8: Multi Translator with DeepL detection preference
  log('\n' + '='.repeat(60), 'bright');
  const multiDeeplResult = await testEndpoint('/multi', {
    text: TEST_TEXT,
    tgt_langs: TARGET_LANGS,
    detection_preference: 'deepl'
  }, 'Multi Translator (DeepL detection preference)');
  results.multiDeepl = multiDeeplResult;
  
  // Test 9: Language detection test (no source language)
  log('\n' + '='.repeat(60), 'bright');
  const detectionResult = await testEndpoint('/multi', {
    text: 'Bonjour le monde',  // French text
    tgt_langs: ['eng', 'spa'],
    detection_preference: 'google'
  }, 'Language Detection Test (French -> English, Spanish)');
  results.detection = detectionResult;
  
  // Test 10: Error handling test
  log('\n' + '='.repeat(60), 'bright');
  const errorResult = await testEndpoint('/multi', {
    text: TEST_TEXT,
    tgt_langs: ['zzz', 'xxx']  // Invalid language codes
  }, 'Error Handling Test (invalid languages)');
  results.error = errorResult;
  
  // Summary
  log('\n' + '='.repeat(60), 'bright');
  log('📊 TEST SUMMARY', 'bright');
  log('='.repeat(60), 'bright');
  
  const successful = Object.entries(results).filter(([, result]) => result.success);
  const failed = Object.entries(results).filter(([, result]) => !result.success);
  
  log(`✅ Successful: ${successful.length}/${Object.keys(results).length}`, 'green');
  successful.forEach(([name]) => {
    log(`   • ${name}`, 'green');
  });
  
  if (failed.length > 0) {
    log(`❌ Failed: ${failed.length}/${Object.keys(results).length}`, 'red');
    failed.forEach(([name, result]) => {
      log(`   • ${name}: ${result.error?.error || result.error}`, 'red');
    });
  }
  
  // Configuration recommendations
  log('\n🔧 CONFIGURATION NOTES:', 'yellow');
  if (!results.deepl.success) {
    log('   • DeepL: Set DEEPL_API_KEY environment variable', 'yellow');
  }
  if (!results.google.success) {
    log('   • Google: Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_TRANSLATE_ACCESS_TOKEN', 'yellow');
  }
  if (!results.openai.success) {
    log('   • OpenAI: Set OPENAI_API_KEY environment variable', 'yellow');
  }
  if (!results.m2m.success) {
    log('   • M2M: Check Cloudflare Workers AI binding', 'yellow');
  }
  
  log('\n🎉 Integration test complete!', 'bright');
  
  // Exit with error code if any critical tests failed
  const criticalTests = ['health', 'multi'];
  const criticalFailures = criticalTests.filter(test => !results[test]?.success);
  
  if (criticalFailures.length > 0) {
    log(`\n⚠️  Critical test failures: ${criticalFailures.join(', ')}`, 'red');
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  log(`💥 Unhandled error: ${error.message}`, 'red');
  process.exit(1);
});

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  log('🔧 Integration Test Script', 'bright');
  log('');
  log('Usage:', 'cyan');
  log('  node integration-test.js [options]', 'cyan');
  log('');
  log('Options:', 'cyan');
  log('  --endpoint=URL    API base URL (default: http://localhost:8787)', 'cyan');
  log('  --text="text"     Test text to translate (default: "Hello world")', 'cyan');
  log('  --help, -h        Show this help message', 'cyan');
  log('');
  log('Examples:', 'cyan');
  log('  node integration-test.js', 'cyan');
  log('  node integration-test.js --endpoint=https://my-api.workers.dev', 'cyan');
  log('  node integration-test.js --text="Bonjour le monde"', 'cyan');
  process.exit(0);
}

// Run the tests
runIntegrationTests().catch(error => {
  log(`💥 Test runner error: ${error.message}`, 'red');
  process.exit(1);
});