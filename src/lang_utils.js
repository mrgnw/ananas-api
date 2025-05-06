import wikidataLanguages from './wikidata-languages.json';
import deeplTargets from './deepl-targets.json';
import m2mSupport from './m2m-support.json';

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

// Build sets of supported 3-letter codes for each translator
const deeplSupported = new Set(
  deeplTargets.map(l => l.iso3 || l.language.toLowerCase())
);
const m2mSupported = new Set(Object.keys(m2mSupport));
const openaiSupported = new Set(
  wikidataLanguages.map(l => l.iso).filter(Boolean)
);

export function assignTranslators(tgt_langs, translator_order = ['deepl', 'm2m', 'openai']) {
  const result = { deepl: [], m2m: [], openai: [], unsupported: [] };
  const supportMap = {
    deepl: deeplSupported,
    m2m: m2mSupported,
    openai: openaiSupported
  };

  for (const code of tgt_langs) {
    const assigned = translator_order.find(tr => supportMap[tr] && supportMap[tr].has(code));
    if (assigned) {
      result[assigned].push(code);
    } else {
      result.unsupported.push(code);
    }
  }
  return result;
}
