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
        const sourceLangDeepL = srcLang3 ? getISO2ForModel(srcLang3)?.toUpperCase() : undefined; // e.g., 'EN'

        const languageDefinition = srcLang3 ? 'user' : 'deepl-auto-detect';

        // Handle target languages input (3-char codes)
        let targetLangs3 = ['deu', 'fra']; // Default languages if none provided
        if (typeof data.tgt_langs === 'string') {
            targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
        } else if (Array.isArray(data.tgt_langs)) {
            targetLangs3 = data.tgt_langs;
        }

        // Convert target languages to 2-char uppercase codes for DeepL
        const targetLangsDeepL = targetLangs3.map(lang3 => getISO2ForModel(lang3)?.toUpperCase()).filter(Boolean); // e.g., ['DE', 'FR']

        if (targetLangsDeepL.length === 0) {
             return new Response(JSON.stringify({ error: "No valid target languages provided or mapped." }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // Map DeepL codes back to original 3-char codes for response formatting
        const deepLToIso3Map = {};
        targetLangs3.forEach(lang3 => {
            const deepLCode = getISO2ForModel(lang3)?.toUpperCase();
            if (deepLCode) {
                deepLToIso3Map[deepLCode] = lang3;
            }
        });

        // Build sets of supported source and target languages (uppercase)
        const supportedSources = new Set(deeplSources.map(l => l.language.toUpperCase()));
        const supportedTargets = new Set(deeplTargets.map(l => l.language.toUpperCase()));

        // Filter out unsupported target languages
        const filteredTargetLangsDeepL = targetLangsDeepL.filter(lang => supportedTargets.has(lang));
        const unsupportedTargetLangs = targetLangsDeepL.filter(lang => !supportedTargets.has(lang));

        // Check if source language is supported (if provided)
        let unsupportedSourceLang = null;
        if (sourceLangDeepL && !supportedSources.has(sourceLangDeepL)) {
            unsupportedSourceLang = sourceLangDeepL;
        }

        // If no supported target languages, return error
        if (filteredTargetLangsDeepL.length === 0) {
            return new Response(JSON.stringify({
                error: "No valid target languages provided or mapped.",
                unsupported_target_langs: unsupportedTargetLangs,
                unsupported_source_lang: unsupportedSourceLang
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // Construct DeepL API request payload
        const payload = {
            text: [inputText], // DeepL expects an array of texts
            target_lang: targetLangsDeepL,
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
        const translations = await Promise.all(targetLangsDeepL.map(async (targetLangDeepL) => {
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
                src_lang: srcLang3 || translations[0]?.detected_source_language || 'unknown',
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

        // Add error info for unsupported languages
        if (unsupportedTargetLangs.length > 0 || unsupportedSourceLang) {
            responseObj.unsupported = {
                unsupported_target_langs: unsupportedTargetLangs,
                unsupported_source_lang: unsupportedSourceLang
            };
        }

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