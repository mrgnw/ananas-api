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


        // Make the API call to DeepL
        const apiResponse = await fetch(DEEPL_API_ENDPOINT, {
            method: 'POST',
            headers: headersToSend, // Use the logged headers
            body: JSON.stringify(payload),
        });

        if (!apiResponse.ok) {
            let errorDetails = `DeepL API Error (${apiResponse.status})`;
            let rawErrorText = '';
            try {
                // Read the raw response body as text first
                rawErrorText = await apiResponse.text();

                if (rawErrorText && rawErrorText.trim() !== '') {
                    errorDetails = rawErrorText.trim(); // Use trimmed raw text as default detail
                    try {
                        // Try parsing the text as JSON
                        const errorJson = JSON.parse(rawErrorText);
                        // If successful and has a message, use that
                        if (errorJson && errorJson.message) {
                            errorDetails = errorJson.message;
                        }
                    } catch (jsonError) {
                        // JSON parsing failed, stick with the raw text
                        console.log("DeepL error response was not valid JSON:", jsonError);
                    }
                } else {
                     // Raw text was empty or whitespace
                     errorDetails = "Received empty error response body from DeepL.";
                     console.log("DeepL returned status", apiResponse.status, "with an empty response body.");
                }

            } catch (readError) {
                console.error("Failed to read DeepL error response body:", readError);
                errorDetails = "Could not read error details from DeepL response body.";
            }

            console.error(`DeepL API Error (${apiResponse.status}): ${errorDetails}`); // Log the details
            return new Response(JSON.stringify({
                error: `DeepL API request failed with status ${apiResponse.status}`,
                details: errorDetails // Include the details in the response
             }), {
                status: apiResponse.status, // Forward DeepL's error status
                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        const result = await apiResponse.json();

        // Format the response similar to m2m translator
        const responseObj = {
            // Use original srcLang3 if provided, otherwise use detected
            [srcLang3 || 'source']: inputText,
            metadata: {
                src_lang: srcLang3 || result.translations[0]?.detected_source_language || 'unknown', // Use detected if src not provided
                language_definition: languageDefinition,
                translator: 'deepl'
            }
        };

        // Add translations, mapping back to 3-letter codes
        result.translations.forEach((translation, index) => {
            const targetLangDeepL = targetLangsDeepL[index]; // Get the target code used in the request
            const targetLang3 = deepLToIso3Map[targetLangDeepL]; // Map back to original 3-letter code
            if (targetLang3) {
                 responseObj[targetLang3] = translation.text;
            } else {
                // Fallback if mapping fails somehow
                responseObj[`unknown_target_${index}`] = translation.text;
            }
        });

         // Add detected source language to metadata if not user-provided
        if (!srcLang3 && result.translations.length > 0) {
             responseObj.metadata.detected_source_language_deepl = result.translations[0].detected_source_language;
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