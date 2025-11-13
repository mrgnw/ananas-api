import { translate_with_m2m } from "./m2m_translator.js";
import { translate_with_deepl, detect_language_with_deepl } from "./deepl_translator.js";
import { translate_with_google } from "./google_translator.js";
import { detect_language_with_google } from "./google_detector.js";
import { handleGptRequest } from "./openai.js";
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

export async function handleStatusRequest(request, env) {
  const testText = "Hello world";
  const testTargetLang = ["spa"]; // Spanish
  
  console.log("🔍 Testing translator connectivity...");
  
  const results = {
    timestamp: new Date().toISOString(),
    test_text: testText,
    target_language: testTargetLang[0],
    translators: {},
    detectors: {},
    environment: {
      has_google_project_id: !!env.GOOGLE_CLOUD_PROJECT_ID,
      has_google_service_account: !!env.GOOGLE_SERVICE_ACCOUNT_KEY,
      has_google_access_token: !!env.GOOGLE_TRANSLATE_ACCESS_TOKEN,
      has_deepl_key: !!env.DEEPL_API_KEY,
      has_openai_key: !!env.OPENAI_API_KEY,
    }
  };

  // Helper to create real Request objects (since .json() can only be called once)
  const createTestRequest = (includeSrcLang = true) => {
    const testData = {
      text: testText,
      tgt_langs: testTargetLang
    };
    // Only include src_lang for translators that need it
    if (includeSrcLang) {
      testData.src_lang = "eng";
    }
    return new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testData)
    });
  };

  // Test Google Translate
  try {
    const googleStart = Date.now();
    const googleRes = await translate_with_google(createTestRequest(), env, getISO2ForModel);
    const googleTime = Date.now() - googleStart;
    
    if (googleRes.status && googleRes.status >= 400) {
      const errorData = await googleRes.json();
      results.translators.google = {
        status: "error",
        error: errorData.error || "Unknown error",
        response_time_ms: googleTime
      };
    } else {
      const googleData = await googleRes.json();
      results.translators.google = {
        status: "success",
        translation: googleData.spa || "No translation returned",
        response_time_ms: googleTime
      };
    }
  } catch (error) {
    results.translators.google = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Test DeepL (without src_lang to let it auto-detect)
  try {
    const deeplStart = Date.now();
    const deeplRes = await translate_with_deepl(createTestRequest(false), env, getISO2ForModel);
    const deeplTime = Date.now() - deeplStart;
    
    console.log("DeepL response:", { status: deeplRes.status, hasJson: !!deeplRes.json });
    
    if (deeplRes.status && deeplRes.status >= 400) {
      const errorData = await deeplRes.json();
      console.error("DeepL error response:", errorData);
      results.translators.deepl = {
        status: "error",
        error: errorData.error || "Unknown error",
        details: errorData.details || null,
        response_time_ms: deeplTime
      };
    } else {
      const deeplData = deeplRes.json ? await deeplRes.json() : deeplRes;
      console.log("DeepL success data:", deeplData);
      results.translators.deepl = {
        status: "success",
        translation: deeplData.spa || "No translation returned",
        response_time_ms: deeplTime
      };
    }
  } catch (error) {
    console.error("DeepL test error:", error);
    console.error("DeepL error stack:", error.stack);
    results.translators.deepl = {
      status: "error",
      error: `JavaScript error: ${error.message}`,
      response_time_ms: null
    };
  }

  // Test M2M
  try {
    const m2mStart = Date.now();
    const m2mRes = await translate_with_m2m(createTestRequest(), env, getISO2ForModel);
    const m2mTime = Date.now() - m2mStart;
    
    if (m2mRes.status && m2mRes.status >= 400) {
      const errorData = await m2mRes.json();
      results.translators.m2m = {
        status: "error",
        error: errorData.error || "Unknown error",
        response_time_ms: m2mTime
      };
    } else {
      const m2mData = await m2mRes.json();
      results.translators.m2m = {
        status: "success",
        translation: m2mData.spa || "No translation returned",
        response_time_ms: m2mTime
      };
    }
  } catch (error) {
    results.translators.m2m = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Test OpenAI
  try {
    const openaiStart = Date.now();
    const openaiRes = await handleGptRequest(createTestRequest(), env);
    const openaiTime = Date.now() - openaiStart;
    
    if (openaiRes.status && openaiRes.status >= 400) {
      const errorData = await openaiRes.json();
      results.translators.openai = {
        status: "error",
        error: errorData.error || "Unknown error",
        response_time_ms: openaiTime
      };
    } else {
      const openaiData = await openaiRes.json();
      results.translators.openai = {
        status: "success",
        translation: openaiData.spa || "No translation returned",
        response_time_ms: openaiTime
      };
    }
  } catch (error) {
    results.translators.openai = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Test Language Detection - Google
  try {
    const googleDetectStart = Date.now();
    const googleDetected = await detect_language_with_google(testText, env);
    const googleDetectTime = Date.now() - googleDetectStart;
    
    results.detectors.google = {
      status: "success",
      detected_language: googleDetected,
      response_time_ms: googleDetectTime
    };
  } catch (error) {
    results.detectors.google = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Test Language Detection - DeepL
  try {
    const deeplDetectStart = Date.now();
    const deeplDetected = await detect_language_with_deepl(testText, env);
    const deeplDetectTime = Date.now() - deeplDetectStart;
    
    results.detectors.deepl = {
      status: "success",
      detected_language: deeplDetected,
      response_time_ms: deeplDetectTime
    };
  } catch (error) {
    results.detectors.deepl = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Test Language Detection - M2M
  try {
    const detectRequest = {
      json: async () => ({
        text: testText,
        tgt_langs: ["spa"],
        detect_language: true
      })
    };
    
    const m2mDetectStart = Date.now();
    const m2mDetectRes = await translate_with_m2m(detectRequest, env, getISO2ForModel);
    const m2mDetectTime = Date.now() - m2mDetectStart;
    
    const m2mDetectData = await m2mDetectRes.json();
    const detectedLang = m2mDetectData?.metadata?.detected_source_language || m2mDetectData?.metadata?.src_lang;
    
    results.detectors.m2m = {
      status: "success",
      detected_language: detectedLang,
      response_time_ms: m2mDetectTime
    };
  } catch (error) {
    results.detectors.m2m = {
      status: "error",
      error: error.message,
      response_time_ms: null
    };
  }

  // Summary
  const workingTranslators = Object.entries(results.translators)
    .filter(([name, result]) => result.status === "success")
    .map(([name]) => name);
  
  const workingDetectors = Object.entries(results.detectors)
    .filter(([name, result]) => result.status === "success")
    .map(([name]) => name);

  results.summary = {
    working_translators: workingTranslators,
    working_detectors: workingDetectors,
    total_translators_tested: Object.keys(results.translators).length,
    total_detectors_tested: Object.keys(results.detectors).length,
    all_systems_operational: workingTranslators.length === Object.keys(results.translators).length
  };

  console.log("🔍 Status check complete:", JSON.stringify(results.summary, null, 2));

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 
      "Content-Type": "application/json;charset=UTF-8",
      "Cache-Control": "no-cache"
    },
  });
}