import wikidataLanguages from './wikidata-languages.json' assert { type: 'json' };
import googleTranslateSupport from './google-translate-support.json' assert { type: 'json' };

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

// Generate access token from service account using Google's token endpoint
async function generateAccessToken(serviceAccountKey) {
    try {
        const serviceAccount = JSON.parse(serviceAccountKey);
        console.log("Service Account Email:", serviceAccount.client_email);
        
        // Create JWT header and payload
        const now = Math.floor(Date.now() / 1000);
        
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };
        
        const payload = {
            iss: serviceAccount.client_email,
            scope: 'https://www.googleapis.com/auth/cloud-translation',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };
        
        // Base64URL encode
        const base64UrlEncode = (obj) => {
            return btoa(JSON.stringify(obj))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
        };
        
        const encodedHeader = base64UrlEncode(header);
        const encodedPayload = base64UrlEncode(payload);
        const unsignedToken = `${encodedHeader}.${encodedPayload}`;
        
        // Clean and import the private key
        const privateKeyPem = serviceAccount.private_key
            .replace(/\\n/g, '\n')
            .replace('-----BEGIN PRIVATE KEY-----\n', '')
            .replace('\n-----END PRIVATE KEY-----', '')
            .replace(/\n/g, '');
        
        // Convert PEM to binary
        const binaryKey = Uint8Array.from(atob(privateKeyPem), c => c.charCodeAt(0));
        
        // Import the private key
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            binaryKey,
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: 'SHA-256'
            },
            false,
            ['sign']
        );
        
        // Sign the token
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            new TextEncoder().encode(unsignedToken)
        );
        
        // Base64URL encode signature
        const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        
        const jwt = `${encodedHeader}.${encodedPayload}.${signatureBase64}`;
        console.log("Generated JWT:", jwt); // Don't log in production!
        
        // Exchange JWT for access token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            console.error("Token endpoint error:", tokenData);
        } else {
            console.log("Token endpoint success:", tokenData);
        }
        return tokenData.access_token;
    } catch (error) {
        console.error('Failed to generate access token:', error);
        throw error;
    }
}


// Function dedicated to Google Translate translation logic
export async function translate_with_google(request, env, getISO2ForModel) {
    const GOOGLE_CLOUD_PROJECT_ID = env.GOOGLE_CLOUD_PROJECT_ID;
    const GOOGLE_SERVICE_ACCOUNT_KEY = env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const GOOGLE_TRANSLATE_ACCESS_TOKEN = env.GOOGLE_TRANSLATE_ACCESS_TOKEN;
    
    // Check for required credentials
    if (!GOOGLE_CLOUD_PROJECT_ID) {
        return new Response(JSON.stringify({ 
            error: "Google Translate API not configured. Please set GOOGLE_CLOUD_PROJECT_ID." 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }
    
    // Generate or use provided access token
    let accessToken = GOOGLE_TRANSLATE_ACCESS_TOKEN;
    if (!accessToken && GOOGLE_SERVICE_ACCOUNT_KEY) {
        try {
            accessToken = await generateAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY);
        } catch (error) {
            return new Response(JSON.stringify({ 
                error: "Failed to generate Google Translate access token.", 
                details: error.message 
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }
    }
    
    if (!accessToken) {
        return new Response(JSON.stringify({ 
            error: "Google Translate API credentials not configured. Please set either GOOGLE_TRANSLATE_ACCESS_TOKEN or GOOGLE_SERVICE_ACCOUNT_KEY." 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }

    // Google Translate API endpoint
    const GOOGLE_TRANSLATE_ENDPOINT = `https://translate.googleapis.com/v3/projects/${GOOGLE_CLOUD_PROJECT_ID}:translateText`;

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
