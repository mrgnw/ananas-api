// Updated Worker script using native Cloudflare Workers AI binding
import wikidataLanguages from './wikidata-languages.json';
import { translate_with_m2m } from './m2m_translator.js'; // Import the function

// Create mapping for converting 3-digit to 2-digit codes for m2m100 model compatibility
const ISO3_TO_ISO2_MAP = wikidataLanguages.reduce((acc, lang) => {
  if (lang.iso && lang.iso1) {
    acc[lang.iso] = lang.iso1;
  }
  return acc;
}, {});

// Convert iso3 to iso2 for m2m100 model compatibility
function getISO2ForModel(iso3) {
  return ISO3_TO_ISO2_MAP[iso3] || iso3;
}

function handleGetRequest() {
  return new Response(JSON.stringify({
    "eng": "hello everybody",
    "spa": "Hola a todos",
    "jpn": "こんにちはみんな",
    "rus": "Привет всем",
    "deu": "Hallo zusammen",
    "fra": "Bonjour à tous",
    "cmn": "大家好",
    "metadata": {
      "src_lang": "eng",
      "language_definition": "assumed eng"
    }
  }), {
    // Specify UTF-8 encoding in the Content-Type header
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}

async function handlePostRequest(request, env) {
  const data = await request.json();

  // Get source language (3-char code)
  const srcLang3 = data.src_lang || 'eng';
  const src_lang = getISO2ForModel(srcLang3); // Convert to 2-char for model

  const languageDefinition = data.src_lang ? 'user' : 'assumed eng';

  // Handle target languages input (3-char codes)
  let targetLangs3 = ['spa', 'jpn', 'rus']; // Default languages
  if (typeof data.tgt_langs === 'string') {
    targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
  } else if (Array.isArray(data.tgt_langs)) {
    targetLangs3 = data.tgt_langs;
  }

  // Convert target languages to 2-char codes for model
  const targetLangs2 = targetLangs3.map(lang => getISO2ForModel(lang));

  // Map to track which 2-char code maps to which 3-char code
  const codeMapping = {};
  targetLangs3.forEach((iso3, index) => {
    codeMapping[targetLangs2[index]] = iso3;
  });

  // Perform translations using native Workers AI
  const translations = await Promise.all(targetLangs2.map(async (lang2) => {
    try {
      const response = await env.AI.run('@cf/meta/m2m100-1.2b', {
        text: data.text,
        source_lang: src_lang,
        target_lang: lang2
      });

      const translatedText = typeof response.translated_text === 'object'
        ? response.translated_text[lang2]
        : response.translated_text;

      // Use original 3-char code in response
      const lang3 = codeMapping[lang2];
      return { [lang3]: translatedText };
    } catch (error) {
      console.error(`Translation error for language ${lang2}:`, error);
      const lang3 = codeMapping[lang2];
      return { [lang3]: `Error translating to ${lang2}: ${error.message}` };
    }
  }));

  // Create response using 3-char codes
  const responseObj = {
    [srcLang3]: data.text,
    ...translations.reduce((acc, translation) => ({ ...acc, ...translation }), {}),
    metadata: {
      src_lang: srcLang3,
      language_definition: languageDefinition
    }
  };

  return new Response(JSON.stringify(responseObj), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env, ctx) {
    // Add CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, api_key'
    };

    // Handle OPTIONS requests for CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    let response;
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/") {
        response = await handleGetRequest();
      } else if (request.method === "POST" && pathname === "/") {
        response = await handlePostRequest(request, env);
      } else if (request.method === "POST" && pathname === "/m2m") {
        // Pass getISO2ForModel function to the imported translator
        response = await translate_with_m2m(request, env, getISO2ForModel);
      } else {
        response = new Response("Not Found", { status: 404 });
      }

      // Add CORS headers to the response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
};