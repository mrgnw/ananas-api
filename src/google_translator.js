import wikidataLanguages from './wikidata-languages.json' assert { type: 'json' };
import googleTranslateSupport from './google-translate-support.json' assert { type: 'json' };
import { getGoogleCredentials } from './google_auth.js';

// Build reverse mapping from Google Translate codes back to ISO 639-3
const googleReverseMap = {};
Object.entries(googleTranslateSupport).forEach(([key, value]) => {
    googleReverseMap[value] = key;
});

// Map ISO 639-3 codes to Google Translate language codes
function getGoogleTranslateCode(iso3Code) {
    return googleTranslateSupport[iso3Code] || null;
}

// Helper function to get ISO 639-3 from ISO 639-1 code
export function getISO3FromISO2(iso2) {
    const found = wikidataLanguages.find(lang => lang.iso1?.toLowerCase() === iso2.toLowerCase());
    return found?.iso || null;
}

// Helper function to map and filter languages for Google Translate
function mapAndFilterLanguages(targetLangs3, mapFunction, supportedSet) {
    const supported = [];
    const unsupported = [];

    for (const lang3 of targetLangs3) {
        const mappedCode = mapFunction(lang3);
        if (mappedCode && supportedSet.has(mappedCode)) {
            supported.push(mappedCode);
        } else {
            unsupported.push(lang3);
        }
    }

    return { supported, unsupported };
}

// Function dedicated to Google Translate translation logic
export async function translate_with_google(request, env, getISO2ForModel) {
    // Get Google credentials
    let projectId, accessToken;
    try {
        ({ projectId, accessToken } = await getGoogleCredentials(env));
    } catch (error) {
        return new Response(JSON.stringify({ 
            error: error.message,
            details: "Google Translate API credentials are not properly configured."
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }

    // Google Translate API endpoint
    const GOOGLE_TRANSLATE_ENDPOINT = `https://translate.googleapis.com/v3/projects/${projectId}:translateText`;

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
        const supportedSourcesSet = new Set(Object.values(googleTranslateSupport)); // Set of supported Google codes

        let sourceLanguageCode = undefined;
        let unsupportedSourceLang = null;
        let languageDefinition = 'google-auto-detect';

        if (srcLang3) {
            languageDefinition = 'user';
            const googleSourceCode = getGoogleTranslateCode(srcLang3);
            if (googleSourceCode && supportedSourcesSet.has(googleSourceCode)) {
                sourceLanguageCode = googleSourceCode;
            } else {
                // The provided 3-letter code does not map to a supported source language
                unsupportedSourceLang = srcLang3;
                sourceLanguageCode = undefined; // Don't send source language to Google API
                console.log(`Unsupported source language provided: ${srcLang3}. Letting Google auto-detect.`);
            }
        }

        // Handle target languages input (3-char codes)
        let targetLangs3 = [];
        // Accept both 'tgt_langs' and 'target_langs' for compatibility
        const tgtLangsRaw = data.target_langs ?? data.tgt_langs;
        if (typeof tgtLangsRaw === 'string') {
            targetLangs3 = tgtLangsRaw.split(',').map(lang => lang.trim());
        } else if (Array.isArray(tgtLangsRaw)) {
            targetLangs3 = tgtLangsRaw;
        }

        // If no target languages provided, return error
        if (!targetLangs3.length) {
            const errors = {};
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

        const supportedTargetsSet = new Set(Object.values(googleTranslateSupport));
        const { supported: supportedTargetCodes, unsupported: unsupportedTargets } =
            mapAndFilterLanguages(targetLangs3, getGoogleTranslateCode, supportedTargetsSet);

        // If NO valid targets could be mapped, return error
        if (supportedTargetCodes.length === 0) {
            const errors = {};
            if (unsupportedTargets.length > 0) errors.unsupported_target_langs = unsupportedTargets;
            if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;

            return new Response(JSON.stringify({
                error: "No valid target languages provided or mapped.",
                errors: Object.keys(errors).length ? errors : undefined,
                requested_target_langs: targetLangs3
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // --- Proceed with API call ---

        // Headers for Google Translate API
        const headersToSend = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        };

        // Debug logging
        console.log("Google Translate Request Headers:", JSON.stringify(headersToSend, null, 2));

        // Send one request per target language (similar to DeepL pattern)
        const translations = await Promise.all(supportedTargetCodes.map(async (targetLangGoogle) => {
            const requestPayload = {
                contents: [inputText],
                targetLanguageCode: targetLangGoogle,
                mimeType: 'text/plain'
            };
            
            // Only add source language if it was provided and supported
            if (sourceLanguageCode) {
                requestPayload.sourceLanguageCode = sourceLanguageCode;
            }

            console.log("Google Translate Request Payload:", JSON.stringify(requestPayload, null, 2));

            const apiResponse = await fetch(GOOGLE_TRANSLATE_ENDPOINT, {
                method: 'POST',
                headers: headersToSend,
                body: JSON.stringify(requestPayload),
            });

            if (!apiResponse.ok) {
                let errorDetails = `Google Translate API Error (${apiResponse.status})`;
                try {
                    const rawErrorText = await apiResponse.text();
                    if (rawErrorText && rawErrorText.trim() !== '') {
                        try {
                            const errorJson = JSON.parse(rawErrorText);
                            if (errorJson?.error?.message) {
                                errorDetails = errorJson.error.message;
                            } else {
                                errorDetails = rawErrorText.trim();
                            }
                        } catch (jsonError) {
                            errorDetails = rawErrorText.trim();
                        }
                    }
                } catch (readError) {
                    console.error("Failed to read Google Translate error response:", readError);
                }
                throw new Error(`Google Translate API request failed for ${targetLangGoogle}: ${errorDetails}`);
            }

            const result = await apiResponse.json();
            return {
                lang: targetLangGoogle,
                text: result.translations[0]?.translatedText,
                detectedSourceLanguage: result.translations[0]?.detectedLanguageCode
            };
        }));

        // Format the response similar to other translators
        const responseObj = {
            [srcLang3 || 'source']: inputText,
            metadata: {
                src_lang: srcLang3 || null,
                language_definition: languageDefinition,
                translator: 'google',
                detected_source_language: null
            }
        };

        let firstDetectedSource = null;
        translations.forEach(({ lang, text, detectedSourceLanguage }) => {
            // Map Google Translate code back to 3-letter code
            const targetLang3 = googleReverseMap[lang] || getISO3FromISO2(lang);
            if (targetLang3) {
                responseObj[targetLang3] = text;
            } else {
                // Handle cases where reverse mapping fails
                console.warn(`Could not map Google Translate code ${lang} back to ISO 639-3.`);
                responseObj[`unknown_target_${lang}`] = text;
            }

            // Capture the first detected source language
            if (detectedSourceLanguage && !firstDetectedSource) {
                firstDetectedSource = detectedSourceLanguage;
            }
        });

        // Update metadata with detected source if available
        if (firstDetectedSource) {
            // Map detected Google code back to 3-letter code if possible
            const detectedSourceLang3 = googleReverseMap[firstDetectedSource] || getISO3FromISO2(firstDetectedSource) || firstDetectedSource;
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
        if (unsupportedSourceLang) errors.unsupported_source_lang = unsupportedSourceLang;

        // Attach errors object if it contains any keys
        if (Object.keys(errors).length) {
            responseObj.errors = errors;
        }

        return new Response(JSON.stringify(responseObj), {
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });

    } catch (error) {
        console.error("Error processing Google Translate request:", error);
        return new Response(JSON.stringify({ 
            error: "Internal server error processing Google Translate request.", 
            details: error.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }
}
