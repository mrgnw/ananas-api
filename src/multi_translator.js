import { translate_with_m2m } from './m2m_translator.js';
import { translate_with_deepl } from './deepl_translator.js';
import { handleGptRequest } from './openai.js';
import { assignTranslators } from './lang_utils.js';
import wikidataLanguages from './wikidata-languages.json';

const ISO3_TO_ISO2_MAP = wikidataLanguages.reduce((acc, lang) => {
  if (lang.iso && lang.iso1) {
    acc[lang.iso] = lang.iso1;
  }
  return acc;
}, {});
function getISO2ForModel(iso3) {
  return ISO3_TO_ISO2_MAP[iso3] || null;
}

export async function handleMultiRequest(request, env) {
  const data = await request.json();
  const text = data.text;
  let tgt_langs = data.tgt_langs;
  if (typeof tgt_langs === 'string') tgt_langs = tgt_langs.split(',').map(l => l.trim());
  if (!Array.isArray(tgt_langs) || tgt_langs.length === 0) {
    return new Response(JSON.stringify({ error: 'No target languages provided.' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
  }

  const assignment = assignTranslators(tgt_langs, ['deepl', 'm2m', 'openai']);

  function buildReq(langs) {
    return { json: async () => ({ text, tgt_langs: langs }) };
  }

  const promises = [];
  if (assignment.deepl.length)
    promises.push(translate_with_deepl(buildReq(assignment.deepl), env, getISO2ForModel));
  if (assignment.m2m.length)
    promises.push(translate_with_m2m(buildReq(assignment.m2m), env, getISO2ForModel));
  if (assignment.openai.length)
    promises.push(handleGptRequest(buildReq(assignment.openai), env));

  const results = await Promise.all(promises.map(async p => {
    const res = await p;
    return res.json ? await res.json() : res;
  }));

  // DEBUG: Log assignment and results for troubleshooting
  console.log('MULTI assignment:', assignment);
  console.log('MULTI results:', JSON.stringify(results, null, 2));

  const translations = {};
  const metadata = { translators: {}, src_lang: null, language_definition: null };
  const errors = { unsupported_target_langs: [] };
  const translatorOrder = [];
  if (assignment.deepl.length) translatorOrder.push('deepl');
  if (assignment.m2m.length) translatorOrder.push('m2m');
  if (assignment.openai.length) translatorOrder.push('openai');

  for (const [i, result] of results.entries()) {
    const translatorKey = translatorOrder[i];
    if (translatorKey && assignment[translatorKey].length) {
      metadata.translators[translatorKey] = assignment[translatorKey];
    }
    // DEBUG: Log each result before merging
    console.log(`MULTI merging result for ${translatorKey}:`, JSON.stringify(result, null, 2));
    for (const [k, v] of Object.entries(result)) {
      if (['metadata', 'errors', 'error'].includes(k)) continue;
      translations[k] = v;
    }
    if (result.metadata) {
      if (result.metadata.src_lang && !metadata.src_lang) metadata.src_lang = result.metadata.src_lang;
      if (result.metadata.language_definition && !metadata.language_definition) metadata.language_definition = result.metadata.language_definition;
      if (result.metadata.detected_source_language && !metadata.detected_source_language) metadata.detected_source_language = result.metadata.detected_source_language;
    }
    if (result.errors && result.errors.unsupported_target_langs) {
      errors.unsupported_target_langs.push(...result.errors.unsupported_target_langs);
    }
  }
  if (assignment.unsupported.length) errors.unsupported_target_langs.push(...assignment.unsupported);
  if (!errors.unsupported_target_langs.length) delete errors.unsupported_target_langs;

  const responseObj = {
    ...translations,
    metadata,
    ...(Object.keys(errors).length ? { errors } : {})
  };
  return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
}
