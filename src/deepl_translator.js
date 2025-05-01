import deeplSources from './deepl-sources.json';
import deeplTargets from './deepl-targets.json';

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
        const sourceLangDeepL = srcLang3 ? getISO2ForModel(srcLang3)?.toUpperCase() : undefined;
        const unsupportedSourceLang = sourceLangDeepL && !supportedSources.has(sourceLangDeepL) ? sourceLangDeepL : null;

        const languageDefinition = srcLang3 ? 'user' : 'deepl-auto-detect';

        // Handle target languages input (3-char codes)
        let targetLangs3 = ['eng', 'esp', 'zho']; // Default languages if none provided
        if (typeof data.tgt_langs === 'string') {
            targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
        } else if (Array.isArray(data.tgt_langs)) {
            targetLangs3 = data.tgt_langs;
        }

        const supportedTargets = new Set(deeplTargets.map(l => l.language.toUpperCase()));
        const mappedTargets = targetLangs3.map(code => ({
            original: code,
            mapped: getISO2ForModel(code)?.toUpperCase() || null
        }));

        const supported = [];
        const unsupported = [];
        const deepLToIso3Map = {};

        for (const { original, mapped } of mappedTargets) {
            if (mapped && supportedTargets.has(mapped)) {
                supported.push(mapped);
                deepLToIso3Map[mapped] = original;
            } else {
                unsupported.push(original);
            }
        }

        if (supported.length === 0) {
            const errors = {};
            if (unsupported.length > 0) errors.unsupported_target_langs = unsupported;
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
            target_lang: supported,
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
        const translations = await Promise.all(supported.map(async (targetLangDeepL) => {
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
                src_lang: srcLang3 || translations[0]?.detected_source_language || null,
                language_definition: languageDefinition,
                translator: 'deepl'
            }
        };
        translations.forEach(({ lang, text }) => {
            const targetLang3 = deepLToIso3Map[lang];
            if (targetLang3) {
                responseObj[targetLang3] = text;
            } else {
                responseObj[`unknown_target_${lang}`] = text;
            }
        });
        if (!srcLang3 && translations.length > 0) {
            responseObj.metadata.detected_source_language_deepl = translations[0].detected_source_language;
        }

        // Add error info for unsupported languages (only if present, and use 'errors' key)
        const errors = {};
        if (unsupported.length) errors.unsupported_target_langs = unsupported;
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