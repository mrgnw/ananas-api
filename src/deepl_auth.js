// Shared DeepL authentication utilities

/**
 * Get DeepL API credentials from environment
 * @param {Object} env - Cloudflare environment variables
 * @returns {{apiKey: string, endpoint: string}}
 * @throws {Error} if API key is not configured
 */
export function getDeepLCredentials(env) {
    const apiKey = env.DEEPL_API_KEY;
    
    if (!apiKey) {
        throw new Error("DeepL API key not configured. Please set DEEPL_API_KEY environment variable.");
    }
    
    // Default to free tier endpoint if not specified
    const endpoint = env.DEEPL_API_ENDPOINT || 'https://api-free.deepl.com/v2/translate';
    
    return {
        apiKey,
        endpoint
    };
}
