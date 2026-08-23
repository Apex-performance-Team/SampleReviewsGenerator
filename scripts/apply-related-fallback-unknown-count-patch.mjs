import{readFileSync,writeFileSync}from'node:fs';

const file='app/api/reference-enrich-marketplaces/route.js';
function replaceOnce(s,from,to){if(s.includes(to))return s;if(!s.includes(from))throw Error('Patch anchor not found');return s.replace(from,to)}

let s=readFileSync(file,'utf8');
s=replaceOnce(s,
  "if(!asin||relation!=='similar'||!Number.isFinite(ratingCount)||ratingCount<=0)continue;",
  "if(!asin||relation!=='similar')continue;");
s=replaceOnce(s,
  "ratingCount,rating:base.rating??null,verificationConfidence:",
  "ratingCount:Number.isFinite(ratingCount)&&ratingCount>0?ratingCount:null,rating:base.rating??null,verificationConfidence:");
writeFileSync(file,s);
console.log(`patched ${file}`);
