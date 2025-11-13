import { translate_with_m2m } from "./m2m_translator.js";
import { translate_with_deepl, detect_language_with_deepl } from "./deepl_translator.js";
import { translate_with_google } from "./google_translator.js";
import { detect_language_with_google } from "./google_detector.js";
import { handleGptRequest } from "./openai.js";
import { assignTranslators } from "./lang_utils.js";
import wikidataLanguages from "./wikidata-languages.json";

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
  const verboseMode = data.verbose === true;
  
  if (typeof tgt_langs === "string")
    tgt_langs = tgt_langs.split(",").map((l) => l.trim());
  if (!Array.isArray(tgt_langs) || tgt_langs.length === 0) {
    return new Response(
      JSON.stringify({ error: "No target languages provided." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      },
    );
  }

  // Log incoming request data for debugging
  console.log("🔍 MULTI translator received:", JSON.stringify(data, null, 2));

  // Extract detection preferences (supports both single and array)
  const validDetectors = ["google", "deepl", "m2m", "openai"];
  let detectionPreferences = [];
  
  // Handle backwards compatibility: detection_preference (single) or detection_preferences (array)
  if (data.detection_preferences) {
    // New array format
    if (Array.isArray(data.detection_preferences)) {
      detectionPreferences = data.detection_preferences;
    } else {
      detectionPreferences = [data.detection_preferences];
    }
  } else if (data.detection_preference) {
    // Old single format - backwards compatibility
    if (data.detection_preference === "auto") {
      detectionPreferences = validDetectors; // Run all detectors
    } else {
      detectionPreferences = [data.detection_preference];
    }
  } else {
    // Default: run all detectors
    detectionPreferences = validDetectors;
  }

  // Validate all detection preferences
  const invalidDetectors = detectionPreferences.filter(d => !validDetectors.includes(d));
  if (invalidDetectors.length > 0) {
    return new Response(
      JSON.stringify({
        error: `Invalid detection preferences: ${invalidDetectors.join(", ")}. Must be one of: ${validDetectors.join(", ")}`,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      },
    );
  }

  console.log("🔍 Detection preferences:", detectionPreferences);

  // Use user-specified translators if provided, otherwise use default priority
  let translatorPriority = data.translators || [
    "google",
    "deepl",
    "m2m",
    "openai",
  ];
  console.log("🔍 Using translator priority:", translatorPriority);

  // Run language detection from all requested detectors (if no src_lang provided)
  const languageDetections = {}; // Will store {detector: {lang: string, success: boolean, error?: string}}
  const detectionErrors = {}; // Will store errors for failed detections
  let primaryDetectedLang = null; // First successful detection for backwards compatibility

  if (!data.src_lang && detectionPreferences.length > 0) {
    console.log("🔍 Running language detection with:", detectionPreferences);
    
    // Helper to run detection with a specific translator
    async function detectWithTranslator(detector) {
      try {
        let detected;
        
        if (detector === "openai") {
          // OpenAI uses translation endpoint with detect_language flag
          const detectionReq = { text, tgt_langs: ["eng"], detect_language: true };
          const res = await handleGptRequest(
            { json: async () => detectionReq },
            env,
          );
          const detectionResult = res.json ? await res.json() : res;
          detected = detectionResult?.metadata?.detected_source_language || detectionResult?.metadata?.src_lang;
        } else if (detector === "deepl") {
          // DeepL has dedicated detection function
          detected = await detect_language_with_deepl(text, env);
        } else if (detector === "google") {
          // Google has dedicated detection function
          detected = await detect_language_with_google(text, env);
        } else if (detector === "m2m") {
          // M2M uses translation endpoint with detect_language flag
          const detectionReq = { text, tgt_langs: ["eng"], detect_language: true };
          const res = await translate_with_m2m(
            { json: async () => detectionReq },
            env,
            getISO2ForModel,
          );
          const detectionResult = res.json ? await res.json() : res;
          detected = detectionResult?.metadata?.detected_source_language || detectionResult?.metadata?.src_lang;
        }

        return { detected: detected || null, error: null };
      } catch (error) {
        console.warn(`❌ Detection failed for ${detector}:`, error.message);
        return { detected: null, error: error.message };
      }
    }

    // Run all detections in parallel
    const detectionPromises = detectionPreferences.map(async (detector) => {
      const result = await detectWithTranslator(detector);
      return { detector, ...result };
    });

    const detectionResults = await Promise.all(detectionPromises);

    // Collect all detection results with detailed status
    for (const { detector, detected, error } of detectionResults) {
      if (detected) {
        languageDetections[detector] = detected;
        if (!primaryDetectedLang) {
          primaryDetectedLang = detected; // First successful detection
        }
        console.log(`✅ ${detector} detected: ${detected}`);
      } else {
        detectionErrors[detector] = error || "Unknown error";
        console.log(`❌ ${detector} failed: ${error || "Unknown error"}`);
      }
    }

    console.log("🔍 Language detections collected:", languageDetections);
    console.log("🔍 Detection errors:", detectionErrors);
  }

  const assignment = assignTranslators(tgt_langs, translatorPriority);

  // Store translator errors for verbose mode
  const translatorErrors = {};

  function buildReq(langs, srcLang = null) {
    const reqData = { text, tgt_langs: langs };
    if (srcLang) reqData.src_lang = srcLang;
    return { json: async () => reqData };
  }

  // Helper function to try a translator and return results or errors
  async function tryTranslator(translatorFn, langs, translatorName) {
    if (langs.length === 0) return { translations: {}, errors: [] };
    try {
      let res;
      if (translatorName === "OpenAI" || translatorName === "OpenAI-Fallback") {
        // OpenAI translator only takes (request, env)
        res = await translatorFn(
          buildReq(langs, primaryDetectedLang || data.src_lang),
          env,
        );
      } else {
        // DeepL, Google, and M2M translators take (request, env, getISO2ForModel)
        res = await translatorFn(
          buildReq(langs, primaryDetectedLang || data.src_lang),
          env,
          getISO2ForModel,
        );
      }
      const result = res.json ? await res.json() : res;
      // Check if the response indicates an error
      if (res.status && res.status >= 400) {
        console.warn(
          `${translatorName} failed with status ${res.status}:`,
          result,
        );
        // Store error for verbose mode
        if (verboseMode) {
          const errorKey = translatorName.toLowerCase().replace("-fallback", "");
          translatorErrors[errorKey] = result.details || result.error || "Unknown error";
        }
        return { translations: {}, errors: langs };
      }
      // Extract successful translations and failed languages
      const translations = {};
      const errors = [];
      for (const lang of langs) {
        if (result[lang] && !result[lang].includes("Error translating")) {
          translations[lang] = result[lang];
        } else {
          errors.push(lang);
        }
      }
      return { translations, errors, metadata: result.metadata };
    } catch (error) {
      console.error(`${translatorName} translator failed:`, error);
      // Store error for verbose mode
      if (verboseMode) {
        const errorKey = translatorName.toLowerCase().replace("-fallback", "");
        translatorErrors[errorKey] = error.message || "Unknown error";
      }
      return { translations: {}, errors: langs };
    }
  }

  // Try primary assignments
  const primaryPromises = [];
  const translatorOrder = [];

  if (assignment.deepl.length) {
    translatorOrder.push({ name: "deepl", langs: assignment.deepl });
    primaryPromises.push(
      tryTranslator(translate_with_deepl, assignment.deepl, "DeepL"),
    );
  }
  if (assignment.google.length) {
    translatorOrder.push({ name: "google", langs: assignment.google });
    primaryPromises.push(
      tryTranslator(translate_with_google, assignment.google, "Google"),
    );
  }
  if (assignment.m2m.length) {
    translatorOrder.push({ name: "m2m", langs: assignment.m2m });
    primaryPromises.push(
      tryTranslator(translate_with_m2m, assignment.m2m, "M2M"),
    );
  }
  if (assignment.openai.length) {
    translatorOrder.push({ name: "openai", langs: assignment.openai });
    primaryPromises.push(
      tryTranslator(handleGptRequest, assignment.openai, "OpenAI"),
    );
  }

  const primaryResults = await Promise.all(primaryPromises);

  // Collect successful translations and failed languages
  const finalTranslations = {};
  const failedLanguages = [];
  
  // Base metadata - always included
  const metadata = {
    translators: {}, // Will store {lang: translator_name}
    src_lang: data.src_lang || primaryDetectedLang || null,
    language_definition: data.src_lang ? 'user' : (primaryDetectedLang ? 'detected' : null),
  };
  
  // Verbose metadata - only included if verbose mode
  const verboseMetadata = verboseMode ? {
    translator_attempts: {}, // Will store {lang: [attempted_translators]}
    language_detection: Object.keys(languageDetections).length > 0 ? languageDetections : undefined,
    detection_errors: Object.keys(detectionErrors).length > 0 ? detectionErrors : undefined,
  } : {};
  
  const errors = { unsupported_target_langs: [] };

  // Process primary results
  for (let i = 0; i < primaryResults.length; i++) {
    const result = primaryResults[i];
    const translatorInfo = translatorOrder[i];

    // Track attempts for each language (verbose only)
    if (verboseMode) {
      for (const lang of translatorInfo.langs) {
        if (!verboseMetadata.translator_attempts[lang]) {
          verboseMetadata.translator_attempts[lang] = [];
        }
        verboseMetadata.translator_attempts[lang].push(translatorInfo.name);
      }
    }

    // Add successful translations and track which translator succeeded
    for (const [lang, translation] of Object.entries(result.translations)) {
      finalTranslations[lang] = translation;
      metadata.translators[lang] = translatorInfo.name;
    }

    // Add failed languages to retry list
    failedLanguages.push(...result.errors);

    // Merge metadata - first translator sets the detection info
    if (result.metadata) {
      if (result.metadata.src_lang && !metadata.src_lang)
        metadata.src_lang = result.metadata.src_lang;
      if (result.metadata.language_definition && !metadata.language_definition)
        metadata.language_definition = result.metadata.language_definition;
    }
  }

  // Try fallbacks for failed languages
  if (failedLanguages.length > 0) {
    console.log(
      `Attempting fallbacks for failed languages: ${failedLanguages.join(", ")}`,
    );

    // Create fallback assignment (try all translators for failed languages)
    const fallbackAssignment = assignTranslators(failedLanguages, [
      "m2m",
      "google",
      "deepl",
      "openai",
    ]);

    const fallbackPromises = [];
    const fallbackOrder = [];

    if (fallbackAssignment.deepl.length) {
      fallbackOrder.push({
        name: "deepl-fallback",
        langs: fallbackAssignment.deepl,
      });
      fallbackPromises.push(
        tryTranslator(
          translate_with_deepl,
          fallbackAssignment.deepl,
          "DeepL-Fallback",
        ),
      );
    }
    if (fallbackAssignment.google.length) {
      fallbackOrder.push({
        name: "google-fallback",
        langs: fallbackAssignment.google,
      });
      fallbackPromises.push(
        tryTranslator(
          translate_with_google,
          fallbackAssignment.google,
          "Google-Fallback",
        ),
      );
    }
    if (fallbackAssignment.m2m.length) {
      fallbackOrder.push({
        name: "m2m-fallback",
        langs: fallbackAssignment.m2m,
      });
      fallbackPromises.push(
        tryTranslator(
          translate_with_m2m,
          fallbackAssignment.m2m,
          "M2M-Fallback",
        ),
      );
    }
    if (fallbackAssignment.openai.length) {
      fallbackOrder.push({
        name: "openai-fallback",
        langs: fallbackAssignment.openai,
      });
      fallbackPromises.push(
        tryTranslator(
          handleGptRequest,
          fallbackAssignment.openai,
          "OpenAI-Fallback",
        ),
      );
    }

    const fallbackResults = await Promise.all(fallbackPromises);

    // Process fallback results
    for (let i = 0; i < fallbackResults.length; i++) {
      const result = fallbackResults[i];
      const translatorInfo = fallbackOrder[i];
      const translatorName = translatorInfo.name.replace("-fallback", "");

      // Track fallback attempts (verbose only)
      if (verboseMode) {
        for (const lang of translatorInfo.langs) {
          if (!verboseMetadata.translator_attempts[lang]) {
            verboseMetadata.translator_attempts[lang] = [];
          }
          verboseMetadata.translator_attempts[lang].push(translatorName);
        }
      }

      // Add successful fallback translations (only if not already translated)
      for (const [lang, translation] of Object.entries(result.translations)) {
        if (!finalTranslations[lang]) {
          finalTranslations[lang] = translation;
          metadata.translators[lang] = translatorName;
        }
      }
    }
  }

  // Add originally unsupported languages to errors
  if (assignment.unsupported.length) {
    errors.unsupported_target_langs.push(...assignment.unsupported);
  }

  // Remove empty errors
  if (!errors.unsupported_target_langs.length)
    delete errors.unsupported_target_langs;

  // Add translator errors to verbose metadata if any occurred
  if (verboseMode && Object.keys(translatorErrors).length > 0) {
    verboseMetadata.translator_errors = translatorErrors;
  }

  // Merge verbose metadata into base metadata if verbose mode is enabled
  const finalMetadata = verboseMode ? { ...metadata, ...verboseMetadata } : metadata;

  const responseObj = {
    ...finalTranslations,
    metadata: finalMetadata,
    ...(Object.keys(errors).length ? { errors } : {}),
  };

  console.log("MULTI final response:", JSON.stringify(responseObj, null, 2));
  return new Response(JSON.stringify(responseObj), {
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}
