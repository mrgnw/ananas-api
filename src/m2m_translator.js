// Function dedicated to M2M translation logic
export async function translate_with_m2m(request, env, getISO2ForModel) {
    const data = await request.json();

    // Get source language (3-char code)
    const srcLang3 = data.src_lang || 'eng';
    const src_lang = getISO2ForModel(srcLang3); // Convert to 2-char for model

    const languageDefinition = data.src_lang ? 'user' : 'assumed eng';

    // Handle target languages input (3-char codes)
    let targetLangs3 = ['spa', 'jpn', 'rus']; // Default languages
    if (typeof data.tgt_langs === 'string') {
        targetLangs3 = data.tgt_langs.split(',').map(lang => lang.trim());
    } else if (Array.isArray(data.tgt_langs)) {
        targetLangs3 = data.tgt_langs;
    }

    // Convert target languages to 2-char codes for model
    const targetLangs2 = targetLangs3.map(lang => getISO2ForModel(lang));

    // Map to track which 2-char code maps to which 3-char code
    const codeMapping = {};
    targetLangs3.forEach((iso3, index) => {
        codeMapping[targetLangs2[index]] = iso3;
    });

    // Perform translations using native Workers AI
    const translations = await Promise.all(targetLangs2.map(async (lang2) => {
        try {
            const response = await env.AI.run('@cf/meta/m2m100-1.2b', {
                text: data.text,
                source_lang: src_lang,
                target_lang: lang2
            });

            const translatedText = typeof response.translated_text === 'object'
                ? response.translated_text[lang2]
                : response.translated_text;

            // Use original 3-char code in response
            const lang3 = codeMapping[lang2];
            return { [lang3]: translatedText };
        } catch (error) {
            console.error(`Translation error for language ${lang2}:`, error);
            const lang3 = codeMapping[lang2];
            return { [lang3]: `Error translating to ${lang2}: ${error.message}` };
        }
    }));

    // Create response using 3-char codes
    const responseObj = {
        [srcLang3]: data.text,
        ...translations.reduce((acc, translation) => ({ ...acc, ...translation }), {}),
        metadata: {
            src_lang: srcLang3,
            language_definition: languageDefinition
        }
    };

    return new Response(JSON.stringify(responseObj), {
        headers: { 'Content-Type': 'application/json' }
    });
}