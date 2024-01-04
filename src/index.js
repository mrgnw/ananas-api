import { Ai } from './vendor/@cloudflare/ai.js';

export default {
	async fetch(request, env) {
		const ai = new Ai(env.AI);
		let text, src_lang, tgt_langs;
		let languageDefinition = 'assumed en';


		if (request.method === "GET") {
			return new Response(JSON.stringify({
				"en": "hello everybody",
				"es": "Hola a todos",
				"ja": "こんにちはみんな",
				"ru": "Привет всем",
				"metadata": {
					"src_lang": "en",
					"language_definition": languageDefinition
				}
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		else if (request.method === "POST") {
			const data = await request.json();
			text = data.text;
			src_lang = data.src_lang || 'en';
			languageDefinition = data.src_lang ? 'user' : languageDefinition

			tgt_langs = ['es', 'ja', 'ru'];
			if (typeof data.tgt_langs === 'string') {
				tgt_langs = data.tgt_langs.split(',').map(lang => lang.trim());
			} else if (Array.isArray(data.tgt_langs)) {
				tgt_langs = data.tgt_langs;
			}

			const translationsPromises = tgt_langs.map(lang =>
				ai.run('@cf/meta/m2m100-1.2b', {
					text: text,
					source_lang: src_lang,
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
				[src_lang]: text,
				...flattenedTranslations,
				metadata: {
					src_lang: src_lang,
					language_definition: languageDefinition
				}
			};

			return new Response(JSON.stringify(responseObject), {
				headers: { 'Content-Type': 'application/json' }
			});

		}
	}
};
