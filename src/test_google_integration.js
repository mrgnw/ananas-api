// Test Google Translate integration in multi translator
import { assignTranslators } from './lang_utils.js';

// Test language assignment
console.log('Testing language assignment with Google Translate...');

const testLanguages = ['eng', 'spa', 'fra', 'deu', 'ita', 'jpn', 'kor', 'cmn'];
const assignment = assignTranslators(testLanguages, ['deepl', 'google', 'm2m', 'openai']);

console.log('Language assignment result:');
console.log(JSON.stringify(assignment, null, 2));

// Test with Google as priority
const googlePriorityAssignment = assignTranslators(testLanguages, ['google', 'deepl', 'm2m', 'openai']);
console.log('\nGoogle priority assignment:');
console.log(JSON.stringify(googlePriorityAssignment, null, 2));
