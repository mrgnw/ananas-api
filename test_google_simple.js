// Simple test to verify Google Translate integration
const { readFileSync } = require('fs');

// Load the data files directly
const wikidataLanguages = JSON.parse(readFileSync('./src/wikidata-languages.json', 'utf8'));
const googleTranslateSupport = JSON.parse(readFileSync('./src/google-translate-support.json', 'utf8'));
const deeplTargets = JSON.parse(readFileSync('./src/deepl-targets.json', 'utf8'));
const m2mSupport = JSON.parse(readFileSync('./src/m2m-support.json', 'utf8'));

// Build ISO3 to ISO2 mapping
const ISO3_TO_ISO2_MAP = wikidataLanguages.reduce((acc, lang) => {
    if (lang.iso && lang.iso1) {
        acc[lang.iso] = lang.iso1;
    }
    return acc;
}, {});

// Build supported language sets
const deeplSupported = new Set(
    deeplTargets
        .map(l => l.language.split('-')[0].toLowerCase())
        .filter(Boolean)
);
const m2mSupported = new Set(Object.keys(m2mSupport));
const googleSupported = new Set(Object.keys(googleTranslateSupport));
const openaiSupported = new Set(
    wikidataLanguages.map(l => l.iso).filter(Boolean)
);

// Simple assignment function
function assignTranslators(tgt_langs, translator_order = ['deepl', 'google', 'm2m', 'openai']) {
    if (!tgt_langs || tgt_langs.length === 0) {
        tgt_langs = wikidataLanguages.map(l => l.iso).filter(Boolean);
    }
    const result = { deepl: [], google: [], m2m: [], openai: [], unsupported: [] };
    const supportMap = {
        deepl: deeplSupported,
        google: googleSupported,
        m2m: m2mSupported,
        openai: openaiSupported
    };

    for (const code of tgt_langs) {
        const iso2 = ISO3_TO_ISO2_MAP[code];
        const assigned = translator_order.find(tr =>
            (tr === 'deepl' && iso2 && supportMap.deepl.has(iso2.toLowerCase())) ||
            (tr === 'google' && supportMap.google.has(code)) ||
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

// Test language assignment
console.log('=== Google Translate Integration Test ===\n');

const testLanguages = ['eng', 'spa', 'fra', 'deu', 'ita', 'jpn', 'kor', 'cmn', 'por', 'rus'];

console.log('Testing with standard priority order: [deepl, google, m2m, openai]');
const assignment1 = assignTranslators(testLanguages, ['deepl', 'google', 'm2m', 'openai']);
console.log(JSON.stringify(assignment1, null, 2));

console.log('\n---\n');

console.log('Testing with Google first: [google, deepl, m2m, openai]');
const assignment2 = assignTranslators(testLanguages, ['google', 'deepl', 'm2m', 'openai']);
console.log(JSON.stringify(assignment2, null, 2));

console.log('\n---\n');

console.log('Language support summary:');
console.log(`- DeepL supports: ${deeplSupported.size} base languages`);
console.log(`- Google supports: ${googleSupported.size} languages`);
console.log(`- M2M supports: ${m2mSupported.size} languages`);
console.log(`- OpenAI supports: ${openaiSupported.size} languages`);

console.log('\n=== Test Complete ===');
