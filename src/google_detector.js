import wikidataLanguages from './wikidata-languages.json' with { type: 'json' };
import googleTranslateSupport from './google-translate-support.json' with { type: 'json' };

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

// Function dedicated to Google Translate language detection only
export async function detect_language_with_google(text, env) {
    const GOOGLE_CLOUD_PROJECT_ID = env.GOOGLE_CLOUD_PROJECT_ID;
    const GOOGLE_SERVICE_ACCOUNT_KEY = env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const GOOGLE_TRANSLATE_ACCESS_TOKEN = env.GOOGLE_TRANSLATE_ACCESS_TOKEN;
    
    // Check for required credentials
    if (!GOOGLE_CLOUD_PROJECT_ID) {
        throw new Error("Google Translate API not configured. Please set GOOGLE_CLOUD_PROJECT_ID.");
    }
    
    // Generate or use provided access token
    let accessToken = GOOGLE_TRANSLATE_ACCESS_TOKEN;
    if (!accessToken && GOOGLE_SERVICE_ACCOUNT_KEY) {
        accessToken = await generateAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY);
    }
    
    if (!accessToken) {
        throw new Error("Google Translate API credentials not configured. Please set either GOOGLE_TRANSLATE_ACCESS_TOKEN or GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    // Google Translate detection endpoint
    const GOOGLE_DETECT_ENDPOINT = `https://translation.googleapis.com/v3/projects/${GOOGLE_CLOUD_PROJECT_ID}/locations/global:detectLanguage`;

    const requestPayload = {
        content: text
    };

    const headersToSend = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': GOOGLE_CLOUD_PROJECT_ID
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