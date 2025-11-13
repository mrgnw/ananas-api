import wikidataLanguages from './wikidata-languages.json' with { type: 'json' };
import googleTranslateSupport from './google-translate-support.json' with { type: 'json' };
import { getGoogleCredentials } from './google_auth.js';

// Build reverse mapping from Google Translate codes back to ISO 639-3
const googleReverseMap = {};
Object.entries(googleTranslateSupport).forEach(([key, value]) => {
    googleReverseMap[value] = key;
});

// Helper function to get ISO 639-3 from ISO 639-1 code
export function getISO3FromISO2(iso2) {
    const found = wikidataLanguages.find(lang => lang.iso1?.toLowerCase() === iso2.toLowerCase());
    return found?.iso || null;
}

// Function dedicated to Google Translate language detection only
export async function detect_language_with_google(text, env) {
    // Get Google credentials
    const { projectId, accessToken } = await getGoogleCredentials(env);

    // Google Translate detection endpoint
    const GOOGLE_DETECT_ENDPOINT = `https://translation.googleapis.com/v3/projects/${projectId}/locations/global:detectLanguage`;

    const requestPayload = {
        content: text
    };

    const headersToSend = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': projectId
    };

    console.log("Google Translate Detection Request:", JSON.stringify(requestPayload, null, 2));

    const apiResponse = await fetch(GOOGLE_DETECT_ENDPOINT, {
        method: 'POST',
        headers: headersToSend,
        body: JSON.stringify(requestPayload),
    });

    if (!apiResponse.ok) {
        let errorDetails = `Google Translate Detection API Error (${apiResponse.status})`;
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
            console.error("Failed to read Google Translate detection error response:", readError);
        }
        throw new Error(`Google Translate Detection API request failed: ${errorDetails}`);
    }

    const result = await apiResponse.json();
    
    // Return the detected language code (convert to ISO 639-3 if possible)
    if (result.languages && result.languages.length > 0) {
        const detectedLanguageCode = result.languages[0].languageCode;
        const detectedLang3 = googleReverseMap[detectedLanguageCode] || getISO3FromISO2(detectedLanguageCode) || detectedLanguageCode;
        
        console.log(`Google detected language: ${detectedLanguageCode} -> ${detectedLang3}`);
        return {
            detectedLanguage: detectedLang3,
            confidence: result.languages[0].confidence,
            originalCode: detectedLanguageCode
        };
    }
    
    throw new Error("No language detected by Google Translate");
}