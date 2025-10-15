import wikidataLanguages from "./wikidata-languages.json";

// Build a language map: iso1 (2-letter) code as key, value = { name, iso, ... }
const languages = {};
for (const lang of wikidataLanguages) {
  if (lang.iso1) {
    languages[lang.iso1] = {
      name: lang.langLabel,
      iso: lang.iso,
      ...lang,
    };
  }
}

// Build a map from 3-letter ISO to 2-letter ISO
const ISO3_TO_ISO2_MAP = {};
for (const lang of wikidataLanguages) {
  if (lang.iso && lang.iso1) {
    ISO3_TO_ISO2_MAP[lang.iso] = lang.iso1;
  }
}

export default {
  async fetch(request, env) {
    let model = "gpt-4.1";

    const db = env.TRANSLATIONS_DB;

    const headers = {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        request.headers.get("access-control-request-headers") || "",
      "Access-Control-Max-Age": "86400", // 24 hours
    };

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    try {
      const requestData = await request.json();
      const originalText = requestData.text;
      const api_key = request.headers.get("api_key");
      const tgt_langs = requestData.tgt_langs;

      // prevent duplicate requests
      // TODO: translate existing languages for originalText;
      //  -> e.g. "YOLO" (en,es) exists but "YOLO" (en,es,ru) is requested
      const existing_translation = await get_translation_from_db(
        db,
        originalText,
      );
      if (existing_translation !== null) {
        return new Response(existing_translation, { headers });
      }

      let translations = await openaiTranslate({
        originalText,
        api_key,
        model,
        tgt_langs,
      });
      await saveTranslation(db, originalText, translations, model);

      return new Response(JSON.stringify(translations), { headers });
    } catch (error) {
      console.error("Error in fetch handler:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers,
      });
    }
  },
};

async function saveTranslation(db, text, translations, model) {
  let translations_text = JSON.stringify(translations);
  const insertSQL = `
        INSERT INTO gpt_translations (original_text, translations_json, model, timestamp)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

  try {
    const stmt = await db
      .prepare(insertSQL)
      .bind(text, translations_text, model)
      .run();
    // console.debug(stmt)
  } catch (err) {
    console.error("Error saving translation to database: " + err.message);
  }
}

function create_language_prompt(request_languages = []) {
  console.log("reqo", request_languages);

  const languageCodes = new Set(Object.keys(languages));

  let supported_languages = request_languages.filter((lang) =>
    languageCodes.has(lang),
  );
  console.log("suppo", supported_languages);
  let unsupported_languages = request_languages.filter(
    (lang) => !languageCodes.has(lang),
  );
  if (supported_languages.length == 0) {
    supported_languages = ["en", "es", "ru"];
  }
  console.log("suppo", supported_languages);

  console.log("request_languages", request_languages);

  let language_prompts = supported_languages.map(
    (code) => `"${code}" for ${languages[code].name}`,
  );

  if (unsupported_languages.length > 0) {
    console.log(`Unsupported languages: ${unsupported_languages.join(", ")}`);
  }
  return language_prompts;
}

async function get_translation_from_db(db, originalText) {
  const get_translation_query = `SELECT translations_json FROM gpt_translations WHERE original_text = ?`;

  try {
    const stmt = db.prepare(get_translation_query).bind(originalText);
    const result = await stmt.first("translations_json");
    console.log("Database result:", result);
    return result;
  } catch (err) {
    console.error(
      "Error checking if translation exists in database: " + err.message,
    );
    return null;
  }
}

function handleOptions(request) {
  const headers = {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("access-control-request-headers") || "",
    "Access-Control-Max-Age": "86400", // 24 hours
  };

  if (request.method !== "OPTIONS") {
    return new Response(null, { status: 405, headers });
  }

  return new Response(null, { headers });
}

export async function openaiTranslate(params) {
  const {
    originalText,
    api_key,
    model = "gpt-4o",
    tgt_langs = [],
    detect_language = false,
    src_lang = null,
  } = params;

  // Filter out invalid language codes and create langs string
  let validLanguages = tgt_langs.filter((code) => languages[code]);
  if (validLanguages.length === 0) {
    validLanguages = ["en", "es", "ru"];
  }

  let langs = validLanguages
    .map((code) => `"${code}" (${languages[code].name})`)
    .join(", ");

  // Enhanced prompt that includes source language detection context
  const languageContextPrompt =
    validLanguages.length > 0
      ? `\n\nCONTEXT: The user typically works with these languages: ${langs}. Use this context to help identify the most likely source language, especially for short or ambiguous text.`
      : "";

  let prompt;
  if (detect_language) {
    prompt = `You are a professional translator and language detector.

First, identify the source language of the given text. Consider that the user typically works with these languages: ${langs}. This context should help you identify the most likely source language, especially for short or ambiguous text.

Then translate the text into all specified target languages: ${langs}

IMPORTANT:
- You MUST provide translations for ALL specified languages
- If the text is a phrase, proverb, slang, or colloquialism, translate for natural, native-like expression in each language
- Be aware of times and numbers, and spell them out as they would appear in the local language with words, not digits
- For very short text like single words, provide the most natural and commonly used translation
- Include the detected source language in the metadata

The JSON response MUST include translations for ALL specified languages and metadata in this exact format:
{
  "eng": "...",
  "esp": "...",
  "metadata": {
    "detected_source_language": "language_code",
    "src_lang": "language_code"
  }
}

Text to translate: "${originalText}"

Respond ONLY with the JSON object containing ALL translations and metadata:`;
  } else {
    // Get source language name for better prompt context
    const sourceLangName =
      src_lang && languages[src_lang] ? languages[src_lang].name : null;
    const sourceContext = sourceLangName
      ? `\n\nSOURCE LANGUAGE: The text is in ${sourceLangName} (${src_lang}).`
      : languageContextPrompt;

    prompt = `You are a professional translator. Translate the given text into all specified languages.
Required languages: ${langs}${sourceContext}

IMPORTANT:
- You MUST provide translations for ALL specified languages
- Translate for natural, native-like expression in each target language
- For very short text like single words, provide the most natural and commonly used translation
- For informal expressions like "yo" (Spanish for "I"), translate to natural equivalents like "I" or contextual greetings if appropriate
- If the text is a phrase, proverb, slang, or colloquialism, translate for natural expression
- Be aware of times and numbers, and spell them out as they would appear in the local language with words, not digits

The JSON response MUST include translations for ALL specified languages in this exact format:
{
  "eng": "...",
  "esp": "...",
  ...
}

Text to translate: "${originalText}"

Respond ONLY with the JSON object containing ALL translations:`;
  }

  const openAIUrl = "https://api.openai.com/v1/chat/completions";
  const openAIRequestHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${api_key}`,
  };
  const openAIBody = JSON.stringify({
    model: model,
    messages: [
      {
        role: "system",
        content: "Multi Translate: You are a professional translator.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const response = await fetch(openAIUrl, {
    method: "POST",
    headers: openAIRequestHeaders,
    body: openAIBody,
  });
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  const result = await response.json();
  const aiResponseContent = result.choices[0].message.content;
  return JSON.parse(aiResponseContent);
}

/**
 * Handle /gpt POST requests (m2m_translator.js compatible)
 * @param {Request} request
 * @param {Object} env Cloudflare environment variables
 * @returns {Promise<Response>}
 */
export async function handleGptRequest(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}
  const model = body.model || "gpt-4o";
  const api_key = env.OPENAI_API_KEY;
  const text = body.text;
  let tgt_langs = body.tgt_langs;

  // Accept comma-separated string or array
  if (typeof tgt_langs === "string") {
    tgt_langs = tgt_langs.split(",").map((l) => l.trim());
  }
  if (!Array.isArray(tgt_langs) || tgt_langs.length === 0) {
    tgt_langs = ["eng", "spa", "rus"];
  }

  // Map 3-letter codes to 2-letter codes if available, else use 3-letter code
  const supported = [];
  const unsupported = [];
  const iso3to2 = {};
  for (const code3 of tgt_langs) {
    const langEntry = wikidataLanguages.find((l) => l.iso === code3);
    if (langEntry) {
      // Use iso1 if available, else fallback to iso3
      const code2 = langEntry.iso1 || code3;
      supported.push(code2);
      iso3to2[code2] = code3;
    } else {
      unsupported.push(code3);
    }
  }

  if (!api_key) {
    return new Response(
      JSON.stringify({
        error: "Missing OpenAI API key in environment variables.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      },
    );
  }
  if (!text) {
    return new Response(
      JSON.stringify({ error: "Missing text in request body." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      },
    );
  }
  if (supported.length === 0) {
    return new Response(
      JSON.stringify({ error: "No supported target languages." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      },
    );
  }

  try {
    // Check if this is a language detection request
    const detect_language = body.detect_language || false;

    const translations2 = await openaiTranslate({
      originalText: text,
      api_key,
      model,
      tgt_langs: supported,
      detect_language,
      src_lang: body.src_lang,
    });

    // Remap keys to 3-letter codes
    const translations3 = {};
    for (const code of supported) {
      const code3 = iso3to2[code];
      if (translations2[code]) {
        translations3[code3] = translations2[code];
      } else if (translations2[code3]) {
        translations3[code3] = translations2[code3];
      }
    }

    // Extract metadata from OpenAI response if present
    let metadata = {
      translator: "openai",
      model,
      src_lang: null,
      language_definition: null,
    };

    if (translations2.metadata) {
      if (translations2.metadata.detected_source_language) {
        metadata.detected_source_language =
          translations2.metadata.detected_source_language;
        metadata.src_lang = translations2.metadata.detected_source_language;
      }
      if (translations2.metadata.src_lang) {
        metadata.src_lang = translations2.metadata.src_lang;
      }
    }

    const responseObj = {
      ...translations3,
      metadata,
      errors:
        unsupported.length > 0
          ? { unsupported_target_langs: unsupported }
          : undefined,
    };
    return new Response(JSON.stringify(responseObj), {
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  }
}

export { languages };
