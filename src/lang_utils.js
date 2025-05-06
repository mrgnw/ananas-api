import wikidataLanguages from './wikidata-languages.json' assert { type: 'json' };
import deeplTargets from './deepl-targets.json' assert { type: 'json' };
import m2mSupport from './m2m-support.json' assert { type: 'json' };

export const ISO3_TO_ISO2_MAP = wikidataLanguages.reduce((acc, lang) => {
    if (lang.iso && lang.iso1) {
        acc[lang.iso] = lang.iso1;
    }
    return acc;
}, {});

export const ISO2_TO_ISO3_MAP = wikidataLanguages.reduce((acc, lang) => {
    if (lang.iso && lang.iso1) {
        acc[lang.iso1.toUpperCase()] = lang.iso;
    }
    return acc;
}, {});

export function getISO2ForModel(iso3) {
    return ISO3_TO_ISO2_MAP[iso3] || null;
}

export function getISO3FromISO2(iso2) {
    return ISO2_TO_ISO3_MAP[iso2.toUpperCase()] || null;
}

// Build sets of supported 2-letter codes for DeepL (lowercase)
const deeplSupported = new Set(
  deeplTargets
    .map(l => l.language.split('-')[0].toLowerCase()) // e.g. EN-GB -> en
    .filter(Boolean)
);
const m2mSupported = new Set(Object.keys(m2mSupport));
const openaiSupported = new Set(
  wikidataLanguages.map(l => l.iso).filter(Boolean)
);

export function assignTranslators(tgt_langs, translator_order = ['deepl', 'm2m', 'openai']) {
  // If no tgt_langs provided, use all 3-letter codes from wikidataLanguages
  if (!tgt_langs || tgt_langs.length === 0) {
    tgt_langs = wikidataLanguages.map(l => l.iso).filter(Boolean);
  }
  const result = { deepl: [], m2m: [], openai: [], unsupported: [] };
  const supportMap = {
    deepl: deeplSupported,
    m2m: m2mSupported,
    openai: openaiSupported
  };

  for (const code of tgt_langs) {
    const iso2 = ISO3_TO_ISO2_MAP[code];
    const assigned = translator_order.find(tr =>
      (tr === 'deepl' && iso2 && supportMap.deepl.has(iso2.toLowerCase())) ||
      (tr === 'm2m' && iso2 && supportMap.m2m.has(iso2)) ||
      (tr === 'openai' && supportMap.openai.has(code))
    );
    if (assigned) {
      result[assigned].push(code);
    } else {
      result.unsupported.push(code);
    }
  }
  return result;
}
