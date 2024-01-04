import { Ai } from './vendor/@cloudflare/ai.js';

export default {
	async fetch(request, env) {
		const ai = new Ai(env.AI);
		let text, from_lang, to_languages;
		let languageDefinition = 'assumed en';


		if (request.method === "GET") {
			return new Response(JSON.stringify({
				"en": "hello everybody",
				"es": "Hola a todos",
				"ja": "こんにちはみんな",
				"ru": "Привет всем",
				"metadata": {
					"src_language": "en",
					"language_definition": languageDefinition
				}
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		else if (request.method === "POST") {
			const data = await request.json();
			text = data.text;
			from_lang = data.from_lang || 'en';
			languageDefinition = data.from_lang ? 'user' : languageDefinition

			to_languages = ['es', 'ja', 'ru'];
			if (typeof data.to_languages === 'string') {
				to_languages = data.to_languages.split(',').map(lang => lang.trim());
			} else if (Array.isArray(data.to_languages)) {
				to_languages = data.to_languages;
			}

			const translationsPromises = to_languages.map(lang =>
				ai.run('@cf/meta/m2m100-1.2b', {
					text: text,
					source_lang: from_lang,
					target_lang: lang
				}).then(response => ({ [lang]: response.translated_text }))
			);

			const translations = await Promise.all(translationsPromises);

			// Flatten the translations into a single object
			const flattenedTranslations = translations.reduce((acc, translation) => {
				return { ...acc, ...translation };
			}, {});

			// Construct the final response object with source language metadata
			const responseObject = {
				[from_lang]: text,
				...flattenedTranslations,
				metadata: {
					src_language: from_lang,
					language_definition: languageDefinition
				}
			};

			return new Response(JSON.stringify(responseObject), {
				headers: { 'Content-Type': 'application/json' }
			});

		}
	}
};
