import { Ai } from './vendor/@cloudflare/ai.js';

function handleGetRequest() {
	return new Response(JSON.stringify({
		"en": "hello everybody",
		"es": "Hola a todos",
		"ja": "こんにちはみんな",
		"ru": "Привет всем",
		"metadata": {
			"src_lang": "en",
			"language_definition": "assumed en"
		}
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
}

async function handlePostRequest(request, ai) {
	const data = await request.json();
	const src_lang = data.src_lang || 'en';
	const languageDefinition = data.src_lang ? 'user' : 'assumed en'
	let tgt_langs = ['es', 'ja', 'ru'];

	if (typeof data.tgt_langs === 'string') {
		tgt_langs = data.tgt_langs.split(',').map(lang => lang.trim());
	} else if (Array.isArray(data.tgt_langs)) {
		tgt_langs = data.tgt_langs;
	}

	const translations = await Promise.all(tgt_langs.map(async lang => {
		const response = await ai.run('@cf/meta/m2m100-1.2b', {
			text: data.text,
			source_lang: src_lang,
			target_lang: lang
		});
		const translatedText = typeof response.translated_text === 'object' 
			? response.translated_text[lang]
			: response.translated_text;
		return { [lang]: translatedText };
	}));

	translations.unshift({ original: data.text });

	return new Response(JSON.stringify({
		[src_lang]: data.text,
		...translations.reduce((acc, translation) => ({ ...acc, ...translation }), {}),
		metadata: {
			src_lang: src_lang,
			language_definition: languageDefinition
		}
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
}

export default {
	async fetch(request, env) {
		const ai = new Ai(env.AI);

		if (request.method === "GET") {
			return handleGetRequest();
		} else if (request.method === "POST") {
			return handlePostRequest(request, ai);
		}
	}
};