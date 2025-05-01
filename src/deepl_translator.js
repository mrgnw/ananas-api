import deeplSources from './deepl-sources.json';
import deeplTargets from './deepl-targets.json';
import { getISO2ForModel, getISO3FromISO2 } from './lang_utils';

// Map 3-letter codes to preferred DeepL codes for regional variants
const deeplPreferredMap = {
    eng: "EN-US", // or "EN-GB" for traditional
    por: "PT-BR", // or "PT-PT" for traditional
    zho: "ZH-HANS", // or "ZH-HANT" for traditional
};

function getDeepLTargetCode(iso3) {
    return deeplPreferredMap[iso3.toLowerCase()] || getISO2ForModel(iso3)?.toUpperCase();
}

// Helper function to map and filter target languages
function mapAndFilterLanguages(requestedLangs, iso3To2, supportedSet) {
    const supported = [];
    const unsupported = [];

    for (const lang3 of requestedLangs) {
        const lang2 = iso3To2(lang3)?.toUpperCase();
        if (lang2 && supportedSet.has(lang2)) {
            supported.push(lang2);
        } else {
            unsupported.push(lang3);
        }
    }

    return { supported, unsupported };
}

// Function dedicated to DeepL translation logic
export async function translate_with_deepl(request, env, getISO2ForModel) {
    const DEEPL_API_KEY = env.DEEPL_API_KEY;
    if (!DEEPL_API_KEY) {
        return new Response(JSON.stringify({ error: "DeepL API key not configured." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }

    // Determine API endpoint (use free tier by default)
    // You might want to make this configurable via env vars too
    const DEEPL_API_ENDPOINT = env.DEEPL_API_ENDPOINT || 'https://api-free.deepl.com/v2/translate';

    try {
        const data = await request.json();
        const inputText = data.text;

        if (!inputText) {
            return new Response(JSON.stringify({ error: "Missing 'text' field in request body." }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // Get source language (3-char code), optional
        const srcLang3 = data.src_lang; // e.g., 'eng'
        const supportedSources = new Set(deeplSources.map(l => l.language.toUpperCase()));
        const sourceLangDeepL = srcLang3 ? getDeepLTargetCode(srcLang3) : undefined;
        const unsupportedSourceLang = sourceLangDeepL && !supportedSources.has(sourceLangDeepL) ? sourceLangDeepL : null;

        const languageDefinition = srcLang3 ? 'user' : 'deepl-auto-detect';

        // Handle target languages input (3-char codes)
        let targetLangs3 = ['eng', 'esp', 'zho']; // Default languages if none provided
        if (typeof data.tgt_langs === 'string') {
            targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
        } else if (Array.isArray(data.tgt_langs)) {
            targetLangs3 = data.tgt_langs;
        }

        const supportedTargetsSet = new Set(deeplTargets.map(l => l.language.toUpperCase()));
        const { supported: supportedTargetCodes, unsupported: unsupportedTargets } =
            mapAndFilterLanguages(targetLangs3, getDeepLTargetCode, supportedTargetsSet);

        if (supportedTargetCodes.length === 0) {
            const errors = {};
            if (unsupportedTargets.length > 0) errors.unsupported_target_langs = unsupportedTargets;
            if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;
            return new Response(JSON.stringify({
                error: "No valid target languages provided or mapped.",
                errors,
                requested_target_langs: targetLangs3
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // Construct DeepL API request payload
        const payload = {
            text: [inputText], // DeepL expects an array of texts
            target_lang: supportedTargetCodes,
        };
        if (sourceLangDeepL) {
            payload.source_lang = sourceLangDeepL;
        }

        // --- BEGIN DEBUG LOGGING ---
        console.log("DeepL Request Payload:", JSON.stringify(payload, null, 2));
        const headersToSend = {
            'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
            'Content-Type': 'application/json',
        };
        console.log("DeepL Request Headers:", JSON.stringify(headersToSend, null, 2));
        // --- END DEBUG LOGGING ---

        // Instead of sending all target_langs at once, send one request per target_lang
        const translations = await Promise.all(supportedTargetCodes.map(async (targetLangDeepL) => {
            const singlePayload = {
                text: [inputText],
                target_lang: targetLangDeepL,
            };
            if (sourceLangDeepL) {
                singlePayload.source_lang = sourceLangDeepL;
            }
            // Debug log for each request
            console.log("DeepL Single Request Payload:", JSON.stringify(singlePayload));
            const apiResponse = await fetch(DEEPL_API_ENDPOINT, {
                method: 'POST',
                headers: headersToSend,
                body: JSON.stringify(singlePayload),
            });
            if (!apiResponse.ok) {
                let errorDetails = `DeepL API Error (${apiResponse.status})`;
                let rawErrorText = '';
                try {
                    rawErrorText = await apiResponse.text();
                    if (rawErrorText && rawErrorText.trim() !== '') {
                        errorDetails = rawErrorText.trim();
                        try {
                            const errorJson = JSON.parse(rawErrorText);
                            if (errorJson && errorJson.message) {
                                errorDetails = errorJson.message;
                            }
                        } catch (jsonError) {
                            console.log("DeepL error response was not valid JSON:", jsonError);
                        }
                    } else {
                        errorDetails = "Received empty error response body from DeepL.";
                        console.log("DeepL returned status", apiResponse.status, "with an empty response body.");
                    }
                } catch (readError) {
                    console.error("Failed to read DeepL error response body:", readError);
                    errorDetails = "Could not read error details from DeepL response body.";
                }
                throw new Error(`DeepL API request failed for ${targetLangDeepL}: ${errorDetails}`);
            }
            const result = await apiResponse.json();
            return {
                lang: targetLangDeepL,
                text: result.translations[0]?.text,
                detected_source_language: result.translations[0]?.detected_source_language
            };
        }));

        // Format the response similar to m2m translator
        const responseObj = {
            [srcLang3 || 'source']: inputText,
            metadata: {
                src_lang: srcLang3 || null,
                language_definition: languageDefinition,
                translator: 'deepl'
            }
        };
        translations.forEach(({ lang, text }) => {
            const targetLang3 = getISO3FromISO2(lang);
            if (targetLang3) {
                responseObj[targetLang3] = text;
            } else {
                responseObj[`unknown_target_${lang}`] = text;
            }
        });

        // Add error info for unsupported languages (only if present, and use 'errors' key)
        const errors = {};
        if (unsupportedTargets.length) errors.unsupported_target_langs = unsupportedTargets;
        if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;
        if (Object.keys(errors).length) responseObj.errors = errors;

        return new Response(JSON.stringify(responseObj), {
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });

    } catch (error) {
        console.error("Error processing DeepL request:", error);
        return new Response(JSON.stringify({ error: "Internal server error processing DeepL request.", details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }
}