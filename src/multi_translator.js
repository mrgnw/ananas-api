import { translate_with_m2m } from './m2m_translator.js';
import { translate_with_deepl } from './deepl_translator.js';
import { translate_with_google } from './google_translator.js';
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

  const assignment = assignTranslators(tgt_langs, ['deepl', 'google', 'm2m', 'openai']);

  function buildReq(langs) {
    return { json: async () => ({ text, tgt_langs: langs }) };
  }

  // Helper function to try a translator and return results or errors
  async function tryTranslator(translatorFn, langs, translatorName) {
    if (langs.length === 0) return { translations: {}, errors: [] };
    
    try {
      let res;
      if (translatorName === 'OpenAI' || translatorName === 'OpenAI-Fallback') {
        // OpenAI translator only takes (request, env)
        res = await translatorFn(buildReq(langs), env);
      } else {
        // DeepL, Google, and M2M translators take (request, env, getISO2ForModel)
        res = await translatorFn(buildReq(langs), env, getISO2ForModel);
      }
      
      const result = res.json ? await res.json() : res;
      
      // Check if the response indicates an error
      if (res.status && res.status >= 400) {
        console.warn(`${translatorName} failed with status ${res.status}:`, result);
        return { translations: {}, errors: langs };
      }
      
      // Extract successful translations and failed languages
      const translations = {};
      const errors = [];
      
      for (const lang of langs) {
        if (result[lang] && !result[lang].includes('Error translating')) {
          translations[lang] = result[lang];
        } else {
          errors.push(lang);
        }
      }
      
      return { translations, errors, metadata: result.metadata };
    } catch (error) {
      console.error(`${translatorName} translator failed:`, error);
      return { translations: {}, errors: langs };
    }
  }

  // Try primary assignments
  const primaryPromises = [];
  const translatorOrder = [];
  
  if (assignment.deepl.length) {
    translatorOrder.push({ name: 'deepl', langs: assignment.deepl });
    primaryPromises.push(tryTranslator(translate_with_deepl, assignment.deepl, 'DeepL'));
  }
  if (assignment.google.length) {
    translatorOrder.push({ name: 'google', langs: assignment.google });
    primaryPromises.push(tryTranslator(translate_with_google, assignment.google, 'Google'));
  }
  if (assignment.m2m.length) {
    translatorOrder.push({ name: 'm2m', langs: assignment.m2m });
    primaryPromises.push(tryTranslator(translate_with_m2m, assignment.m2m, 'M2M'));
  }
  if (assignment.openai.length) {
    translatorOrder.push({ name: 'openai', langs: assignment.openai });
    primaryPromises.push(tryTranslator(handleGptRequest, assignment.openai, 'OpenAI'));
  }

  const primaryResults = await Promise.all(primaryPromises);

  // Collect successful translations and failed languages
  const finalTranslations = {};
  const failedLanguages = [];
  const metadata = { translators: {}, src_lang: null, language_definition: null };
  const errors = { unsupported_target_langs: [] };

  // Process primary results
  for (let i = 0; i < primaryResults.length; i++) {
    const result = primaryResults[i];
    const translatorInfo = translatorOrder[i];
    
    // Track successful languages for this translator
    const successfulLangs = Object.keys(result.translations);
    if (successfulLangs.length > 0) {
      metadata.translators[translatorInfo.name] = successfulLangs;
    }
    
    // Add successful translations
    Object.assign(finalTranslations, result.translations);
    
    // Add failed languages to retry list
    failedLanguages.push(...result.errors);
    
    // Merge metadata
    if (result.metadata) {
      if (result.metadata.src_lang && !metadata.src_lang) metadata.src_lang = result.metadata.src_lang;
      if (result.metadata.language_definition && !metadata.language_definition) metadata.language_definition = result.metadata.language_definition;
      if (result.metadata.detected_source_language && !metadata.detected_source_language) metadata.detected_source_language = result.metadata.detected_source_language;
    }
  }

  // Try fallbacks for failed languages
  if (failedLanguages.length > 0) {
    console.log(`Attempting fallbacks for failed languages: ${failedLanguages.join(', ')}`);
    
    // Create fallback assignment (try all translators for failed languages)
    const fallbackAssignment = assignTranslators(failedLanguages, ['m2m', 'google', 'deepl', 'openai']);
    
    const fallbackPromises = [];
    const fallbackOrder = [];
    
    if (fallbackAssignment.deepl.length) {
      fallbackOrder.push({ name: 'deepl-fallback', langs: fallbackAssignment.deepl });
      fallbackPromises.push(tryTranslator(translate_with_deepl, fallbackAssignment.deepl, 'DeepL-Fallback'));
    }
    if (fallbackAssignment.google.length) {
      fallbackOrder.push({ name: 'google-fallback', langs: fallbackAssignment.google });
      fallbackPromises.push(tryTranslator(translate_with_google, fallbackAssignment.google, 'Google-Fallback'));
    }
    if (fallbackAssignment.m2m.length) {
      fallbackOrder.push({ name: 'm2m-fallback', langs: fallbackAssignment.m2m });
      fallbackPromises.push(tryTranslator(translate_with_m2m, fallbackAssignment.m2m, 'M2M-Fallback'));
    }
    if (fallbackAssignment.openai.length) {
      fallbackOrder.push({ name: 'openai-fallback', langs: fallbackAssignment.openai });
      fallbackPromises.push(tryTranslator(handleGptRequest, fallbackAssignment.openai, 'OpenAI-Fallback'));
    }
    
    const fallbackResults = await Promise.all(fallbackPromises);
    
    // Process fallback results
    for (let i = 0; i < fallbackResults.length; i++) {
      const result = fallbackResults[i];
      const translatorInfo = fallbackOrder[i];
      
      // Add successful fallback translations (only if not already translated)
      for (const [lang, translation] of Object.entries(result.translations)) {
        if (!finalTranslations[lang]) {
          finalTranslations[lang] = translation;
          
          // Update metadata to show this translator was used
          const translatorName = translatorInfo.name.replace('-fallback', '');
          if (!metadata.translators[translatorName]) {
            metadata.translators[translatorName] = [];
          }
          metadata.translators[translatorName].push(lang);
        }
      }
    }
  }

  // Add originally unsupported languages to errors
  if (assignment.unsupported.length) {
    errors.unsupported_target_langs.push(...assignment.unsupported);
  }

  // Remove empty errors
  if (!errors.unsupported_target_langs.length) delete errors.unsupported_target_langs;

  const responseObj = {
    ...finalTranslations,
    metadata,
    ...(Object.keys(errors).length ? { errors } : {})
  };
  
  console.log('MULTI final response:', JSON.stringify(responseObj, null, 2));
  return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
}
