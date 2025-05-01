import wikidataLanguages from './wikidata-languages.json';

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
