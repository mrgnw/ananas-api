import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assignTranslators } from './src/lang_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wikidataLanguages = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/wikidata-languages.json')));
const deeplTargets = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/deepl-targets.json')));
const m2mSupport = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/m2m-support.json')));

console.log(assignTranslators(['eng', 'spa', 'rus', 'jpy', 'cmn', 'deu', 'fra']));
console.dir(assignTranslators(), { depth: null, maxArrayLength: null });
import util from 'util';

console.debug(util.inspect(assignTranslators(), { depth: null, maxArrayLength: null }));
