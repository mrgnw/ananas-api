// Shared Google Cloud authentication utilities

// Generate access token from service account using Google's token endpoint
export async function generateAccessToken(serviceAccountKey) {
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

/**
 * Get Google Cloud credentials from environment
 * @param {Object} env - Cloudflare environment variables
 * @returns {Promise<{projectId: string, accessToken: string}>}
 * @throws {Error} if credentials are not configured
 */
export async function getGoogleCredentials(env) {
    const GOOGLE_SERVICE_ACCOUNT_KEY = env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const GOOGLE_TRANSLATE_ACCESS_TOKEN = env.GOOGLE_TRANSLATE_ACCESS_TOKEN;
    
    // Extract project ID from service account key if not explicitly provided
    let GOOGLE_CLOUD_PROJECT_ID = env.GOOGLE_CLOUD_PROJECT_ID;
    if (!GOOGLE_CLOUD_PROJECT_ID && GOOGLE_SERVICE_ACCOUNT_KEY) {
        try {
            const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
            GOOGLE_CLOUD_PROJECT_ID = serviceAccount.project_id;
        } catch (error) {
            throw new Error(`Failed to parse Google service account key: ${error.message}`);
        }
    }
    
    // Check for required project ID
    if (!GOOGLE_CLOUD_PROJECT_ID) {
        throw new Error("Google Translate API not configured. Please set GOOGLE_CLOUD_PROJECT_ID or provide GOOGLE_SERVICE_ACCOUNT_KEY with project_id.");
    }
    
    // Generate or use provided access token
    let accessToken = GOOGLE_TRANSLATE_ACCESS_TOKEN;
    if (!accessToken && GOOGLE_SERVICE_ACCOUNT_KEY) {
        accessToken = await generateAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY);
    }
    
    if (!accessToken) {
        throw new Error("Google Translate API credentials not configured. Please set either GOOGLE_TRANSLATE_ACCESS_TOKEN or GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    return {
        projectId: GOOGLE_CLOUD_PROJECT_ID,
        accessToken
    };
}
