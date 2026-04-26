import './_load-env';
import { looksNonEnglishOriginal } from '../src/lib/evaluator';

const body = '您好，\n\n我想申请这个职位。简历附上。\n\nGitHub: https://github.com/wei-z-dev\nPortfolio: https://weizhang.dev\n\n谢谢，\n张伟';
console.log('body length:', body.length);
const nl = (body.match(/[\u4e00-\u9fff]/g) || []).length;
console.log('non-Latin chars:', nl);
console.log('non-Latin pct:', nl / body.length);
console.log('detector result (body only):', looksNonEnglishOriginal(null, body, ''));
console.log('detector result (rawText only):', looksNonEnglishOriginal(body, null, ''));
console.log('detector result (combined w/ english resume):', looksNonEnglishOriginal('Senior engineer with 5 years experience working at Google. Built large scale systems.', body, ''));
