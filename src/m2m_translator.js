import m2mSupport from './m2m-support.json';
import wikidataLanguages from './wikidata-languages.json';
import { getISO2ForModel, getISO3FromISO2 } from './lang_utils';

// Helper to detect language using DeepL API (only used here)
async function detect_language(text, env) {
    const DEEPL_API_KEY = env.DEEPL_API_KEY;
    const DEEPL_API_ENDPOINT = env.DEEPL_API_ENDPOINT || 'https://api-free.deepl.com/v2/translate';
    const headers = {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
    };
    // Use EN as a dummy target
    const payload = { text: [text], target_lang: 'EN' };
    const resp = await fetch(DEEPL_API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error('DeepL language detection failed');
    const result = await resp.json();
    return result.translations[0]?.detected_source_language;
}

// Build a map from 2-letter to 3-letter codes for DeepL detection
const ISO2_TO_ISO3_MAP = wikidataLanguages.reduce((acc, lang) => {
    if (lang.iso && lang.iso1) {
        acc[lang.iso1.toUpperCase()] = lang.iso;
    }
    return acc;
}, {});

// Function dedicated to M2M translation logic
export async function translate_with_m2m(request, env, getISO2ForModel) {
    const data = await request.json();

    // Detect source language if not provided
    let detectedSourceLang = null;
    let srcLang3 = data.src_lang;
    if (!srcLang3) {
        detectedSourceLang = await detect_language(data.text, env);
        srcLang3 = detectedSourceLang ? getISO3FromISO2(detectedSourceLang) : undefined;
        if (!srcLang3) {
            return new Response(JSON.stringify({
                error: "Could not map detected source language from DeepL to a supported language code.",
                detected_source_language_deepl: detectedSourceLang
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
    const src_lang = srcLang3 ? getISO2ForModel(srcLang3) : undefined;

    const languageDefinition = data.src_lang ? 'user' : (detectedSourceLang ? 'deepl-detected' : 'assumed eng');

    // Handle target languages input (3-char codes)
    let targetLangs3 = ['spa', 'jpn', 'rus']; // Default languages
    if (typeof data.tgt_langs === 'string') {
        targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
    } else if (Array.isArray(data.tgt_langs)) {
        targetLangs3 = data.tgt_langs;
    }

    // Build set of supported 2-letter codes for m2m
    const supportedM2m = new Set(Object.keys(m2mSupport));

    // Map and filter source language
    const unsupportedSourceLang = src_lang && !supportedM2m.has(src_lang) ? srcLang3 : null;
    const usedSrcLang = unsupportedSourceLang ? null : src_lang;

    // Map and filter target languages
    const mappedTargets = targetLangs3.map(code3 => ({
        original: code3,
        mapped: getISO2ForModel(code3)
    }));
    const supportedTargets = [];
    const unsupportedTargets = [];
    const codeMapping = {};
    for (const { original, mapped } of mappedTargets) {
        if (mapped && supportedM2m.has(mapped)) {
            supportedTargets.push(mapped);
            codeMapping[mapped] = original;
        } else {
            unsupportedTargets.push(original);
        }
    }

    if (supportedTargets.length === 0) {
        const errors = {};
        if (unsupportedTargets.length) errors.unsupported_target_langs = unsupportedTargets;
        if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;
        return new Response(JSON.stringify({
            error: "No valid target languages provided or mapped.",
            errors,
            requested_target_langs: targetLangs3
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Perform translations using native Workers AI
    const translations = await Promise.all(supportedTargets.map(async (lang2) => {
        try {
            const response = await env.AI.run('@cf/meta/m2m100-1.2b', {
                text: data.text,
                source_lang: usedSrcLang,
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
    if (detectedSourceLang) {
        responseObj.metadata.detected_source_language_deepl = detectedSourceLang;
    }

    // Add error info for unsupported languages (only if present, and use 'errors' key)
    const errors = {};
    if (unsupportedTargets.length) errors.unsupported_target_langs = unsupportedTargets;
    if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;
    if (Object.keys(errors).length) responseObj.errors = errors;

    return new Response(JSON.stringify(responseObj), {
        headers: { 'Content-Type': 'application/json' }
    });
}