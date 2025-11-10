import deeplSources from './deepl-sources.json';
import deeplTargets from './deepl-targets.json';
import { getISO2ForModel, getISO3FromISO2 } from './lang_utils.js';

// Map 3-letter codes to preferred DeepL codes for regional variants
const deeplPreferredMap = {
    eng: "EN-US", // or "EN-GB" for traditional
    por: "PT-BR", // or "PT-PT" for traditional
    zho: "ZH-HANS", // or "ZH-HANT" for traditional
};

const deeplReverseMap = {
  "EN-GB": "eng",
  "EN-US": "eng",
  "PT-PT": "por",
  "PT-BR": "por",
  "ZH-HANS": "zho",
  "ZH-HANT": "zho"
};

function getDeepLTargetCode(iso3) {
    return deeplPreferredMap[iso3.toLowerCase()] || getISO2ForModel(iso3)?.toUpperCase();
}

function getDeepLSourceCode(iso3) {
    // For source languages, DeepL only accepts base codes like "EN", not regional variants like "EN-US"
    return getISO2ForModel(iso3)?.toUpperCase();
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

// Function dedicated to DeepL language detection (uses minimal translation since DeepL has no detection-only endpoint)
export async function detect_language_with_deepl(text, env) {
    const DEEPL_API_KEY = env.DEEPL_API_KEY;
    if (!DEEPL_API_KEY) {
        throw new Error("DeepL API key not configured.");
    }

    const DEEPL_API_ENDPOINT = env.DEEPL_API_ENDPOINT || 'https://api-free.deepl.com/v2/translate';

    // Use English as minimal target for detection (most widely supported)
    const requestPayload = {
        text: [text],
        target_lang: 'EN'
        // Deliberately omit source_lang to trigger detection
    };

    const headersToSend = {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
    };

    console.log("DeepL Detection Request:", JSON.stringify(requestPayload, null, 2));

    const apiResponse = await fetch(DEEPL_API_ENDPOINT, {
        method: 'POST',
        headers: headersToSend,
        body: JSON.stringify(requestPayload),
    });

    if (!apiResponse.ok) {
        let errorDetails = `DeepL Detection API Error (${apiResponse.status})`;
        try {
            const rawErrorText = await apiResponse.text();
            if (rawErrorText && rawErrorText.trim() !== '') {
                try {
                    const errorJson = JSON.parse(rawErrorText);
                    if (errorJson && errorJson.message) {
                        errorDetails = errorJson.message;
                    }
                } catch (jsonError) {
                    // Keep the raw text as error details
                }
            }
        } catch (readError) {
            console.error("Failed to read DeepL detection error response:", readError);
        }
        throw new Error(`DeepL Detection API request failed: ${errorDetails}`);
    }

    const result = await apiResponse.json();
    
    if (result.translations && result.translations.length > 0) {
        const detectedSourceLanguage = result.translations[0].detected_source_language;
        if (detectedSourceLanguage) {
            // Map DeepL code back to 3-letter code
            const detectedLang3 = deeplReverseMap[detectedSourceLanguage] || getISO3FromISO2(detectedSourceLanguage) || detectedSourceLanguage;
            
            console.log(`DeepL detected language: ${detectedSourceLanguage} -> ${detectedLang3}`);
            return {
                detectedLanguage: detectedLang3,
                originalCode: detectedSourceLanguage
            };
        }
    }
    
    throw new Error("No language detected by DeepL");
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
        const srcLang3 = data.src_lang; // e.g., 'eng' or 'zzz'
        const supportedSourcesSet = new Set(deeplSources.map(l => l.language.toUpperCase())); // Set of supported 2-letter codes like 'EN', 'DE'

        let sourceLangDeepL = undefined;
        let unsupportedSourceLang = null; // Store the original invalid 3-letter code if found
        let languageDefinition = 'deepl-auto-detect';

        if (srcLang3) {
            languageDefinition = 'user';
            const srcLang2 = getISO2ForModel(srcLang3)?.toUpperCase(); // Get 2-letter code for checking support
            if (srcLang2 && supportedSourcesSet.has(srcLang2)) {
                // For source languages, use base codes only (no regional variants)
                sourceLangDeepL = getDeepLSourceCode(srcLang3);
                if (!sourceLangDeepL) {
                     // This case means the base lang (e.g., 'eng') is supported, but the specific 3-letter code didn't map cleanly
                     // (e.g., maybe a rare variant). Let DeepL auto-detect instead of failing.
                     console.warn(`Could not map supported source language ${srcLang3} (${srcLang2}) to a specific DeepL code. Letting DeepL auto-detect.`);
                     sourceLangDeepL = undefined; // Clear it so we don't send potentially invalid source_lang param
                }
            } else {
                // The provided 3-letter code does not map to a supported 2-letter source language
                unsupportedSourceLang = srcLang3; // Mark it as unsupported
                sourceLangDeepL = undefined; // Don't send source_lang to DeepL API
                console.log(`Unsupported source language provided: ${srcLang3}. Letting DeepL auto-detect if possible.`);
            }
        }


        // Handle target languages input (3-char codes)
        let targetLangs3 = [];
        if (typeof data.tgt_langs === 'string') {
            targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
        } else if (Array.isArray(data.tgt_langs)) {
            targetLangs3 = data.tgt_langs;
        }

        // If no target languages provided, return error
        if (!targetLangs3.length) {
            const errors = {};
            // Include unsupported source error if it was detected
            if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;
            return new Response(JSON.stringify({
                error: "No target languages provided.",
                errors: Object.keys(errors).length ? errors : undefined,
                requested_target_langs: targetLangs3
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        const supportedTargetsSet = new Set(deeplTargets.map(l => l.language.toUpperCase()));
        const { supported: supportedTargetCodes, unsupported: unsupportedTargets } =
            mapAndFilterLanguages(targetLangs3, getDeepLTargetCode, supportedTargetsSet);

        // If NO valid targets could be mapped, return error
        if (supportedTargetCodes.length === 0) {
            const errors = {};
            // Always include unsupported targets if we got here
            if (unsupportedTargets.length > 0) errors.unsupported_target_langs = unsupportedTargets;
            // Also include unsupported source error if it was detected
            if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;

            return new Response(JSON.stringify({
                error: "No valid target languages provided or mapped.",
                // Ensure errors object is included if either condition is met
                errors: Object.keys(errors).length ? errors : undefined,
                requested_target_langs: targetLangs3
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // --- Proceed with API call ---

        // Construct DeepL API request payload
        const payloadBase = {
            text: [inputText], // DeepL expects an array of texts
        };
        // Only add source_lang if it was provided AND supported AND successfully mapped
        if (sourceLangDeepL) {
            payloadBase.source_lang = sourceLangDeepL;
        }

        // --- BEGIN DEBUG LOGGING ---
        console.log("DeepL Request Payload:", JSON.stringify(payloadBase, null, 2));
        const headersToSend = {
            'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
            'Content-Type': 'application/json',
        };
        console.log("DeepL Request Headers:", JSON.stringify(headersToSend, null, 2));
        // --- END DEBUG LOGGING ---

        // Instead of sending all target_langs at once, send one request per target_lang
        const translations = await Promise.all(supportedTargetCodes.map(async (targetLangDeepL) => {
            const singlePayload = {
                ...payloadBase, // Include base payload (text and potentially source_lang)
                target_lang: targetLangDeepL,
            };
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
            // Use original srcLang3 if provided, else use detected source if available, else 'source'
            // This key might be ambiguous if srcLang3 was invalid but detection worked.
            // Let's keep the original text keyed by the *requested* src_lang if provided, or 'source' otherwise.
            [srcLang3 || 'source']: inputText,
            metadata: {
                src_lang: srcLang3 || null, // Reflect original request's src_lang
                language_definition: languageDefinition, // 'user' or 'deepl-auto-detect'
                translator: 'deepl',
                // Optionally add detected source from DeepL if auto-detected
                detected_source_language: null // Placeholder, will be updated below if needed
            }
        };

        let firstDetectedSource = null;
        translations.forEach(({ lang, text, detected_source_language }) => {
            // Map DeepL target code (e.g., 'DE', 'PT-BR') back to 3-letter code ('deu', 'por')
            const targetLang3 = deeplReverseMap[lang] || getISO3FromISO2(lang);
            if (targetLang3) {
                responseObj[targetLang3] = text;
            } else {
                // Handle cases where reverse mapping fails (should be rare)
                console.warn(`Could not map DeepL target code ${lang} back to ISO 639-3.`);
                responseObj[`unknown_target_${lang}`] = text;
            }

            // Capture the first detected source language reported by DeepL (always store it)
            if (detected_source_language && !firstDetectedSource) {
                 firstDetectedSource = detected_source_language; // Store the DeepL code (e.g., 'EN')
            }
        });

        // Always update metadata with detected source if available
        if (firstDetectedSource) {
            // Map detected DeepL code (e.g., 'EN') back to 3-letter code ('eng') if possible
            const detectedSourceLang3 = deeplReverseMap[firstDetectedSource] || getISO3FromISO2(firstDetectedSource) || firstDetectedSource;
            responseObj.metadata.detected_source_language = detectedSourceLang3;
            
            // If the detected source language is not in the target languages and no source was provided,
            // include the original text under the detected source language key
            if (!srcLang3 && detectedSourceLang3 && !responseObj[detectedSourceLang3]) {
                responseObj[detectedSourceLang3] = inputText;
            }
        }


        // Add error info for unsupported languages to the final response object
        const errors = {};
        if (unsupportedTargets.length) errors.unsupported_target_langs = unsupportedTargets;
        if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang; // Add the previously detected unsupported source

        // Attach errors object if it contains any keys
        if (Object.keys(errors).length) {
            responseObj.errors = errors;
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