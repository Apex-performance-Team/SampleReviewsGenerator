import{readFileSync,writeFileSync}from'node:fs';

function replaceBetween(source,startNeedle,endNeedle,replacement){
  const start=source.indexOf(startNeedle);
  if(start<0)return source;
  const end=source.indexOf(endNeedle,start);
  if(end<0)return source;
  return source.slice(0,start)+replacement+source.slice(end);
}

const factContract='PRODUCT FACT CONTRACT: The Shopify product title and authoritative PDP context define the exact product identity. Do not contradict explicit title/PDP facts, but do not add vertical-specific assumptions that are not provided.';

let route=readFileSync('app/api/generate/route.js','utf8');
route=route.replace(/function productPlacementContract[^\n]*\n/g,'');
route=route.replace(/PLACEMENT CONTRACT: \$\{productPlacementContract\(input\)\.instruction\}/g,factContract);
route=route.replace(/Especially avoid making scanning, placement, weak channels, or channel count the central story unless the attached source fingerprint specifically requires it\./g,'Avoid making the category-default setup step, headline feature, common complaint, or obvious outcome the central story unless the attached source fingerprint specifically requires it.');
if(!route.includes('Use words by their common shopper meaning')){
  route=route.replace('- Write like a real ecommerce customer, not a product analyst, copywriter, or review editor. Normal reviews can be clipped, a little uneven, and less perfectly organized.','- Write like a real ecommerce customer, not a product analyst, copywriter, or review editor. Normal reviews can be clipped, a little uneven, and less perfectly organized.\n- Use words by their common shopper meaning, not their technical/spec-sheet meaning. Prefer “worked,” “fine,” “easy enough,” “feels solid,” “kind of annoying,” “worth it,” “not bad,” and similar ordinary wording over “functional performance,” “use case,” “rationale,” “value proposition,” “ownership experience,” or “usage conditions.”\n- If repair_reasons include hard deterministic style warnings, write a new review from the same assignment. Do not preserve the old title frame, opening, sentence structure, conclusion, or abstract logic. Keep rating, product facts, and source sentiment, but switch to common customer language.');
}
if(!route.includes('technically correct but uncommon shopper way')){
  route=route.replace('- It uses review-template wording such as overall, verdict, caveat, tradeoff, mission, boundary, full marks, final judgment, or similar grading language.','- It uses review-template wording such as overall, verdict, caveat, tradeoff, mission, boundary, full marks, final judgment, or similar grading language.\n- It uses words in a technically correct but uncommon shopper way, such as “functional performance,” “usage conditions,” “value proposition,” “performance outcome,” or “ownership experience,” instead of plain customer wording.');
}
if(!route.includes('Choose common customer wording over technical correctness')){
  route=route.replace('- Keep the review ordinary and customer-like. Use first person when natural. Contractions are allowed. Some roughness is good; confusion is not.','- Keep the review ordinary and customer-like. Use first person when natural. Contractions are allowed. Some roughness is good; confusion is not.\n- Choose common customer wording over technical correctness. “It worked fine,” “does the job,” “feels solid,” “kind of annoying,” and “worth it” are usually better review language than abstract nouns or spec-sheet phrasing.');
}
const localGate=`const COMMON_ECHO_WORDS=new Set('about after again against also among because before being between could every first from have into more most only other same some than that their there these those through under using where which while with without would your this into over very just they them then than also been each will such more make made used use way get got its not for and the are was were had has can you our out all'.split(' '));
function distinctiveTokens(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\\s+/).filter(Boolean)}
function hasDistinctivePdpEcho(text,input={}){
  const body=distinctiveTokens(text).join(' '),desc=distinctiveTokens(input.productDescription).filter(x=>x.length>2),title=new Set(distinctiveTokens(input.productTitle));
  if(desc.length<5||body.length<30)return false;
  for(let i=0;i<=desc.length-5;i++){
    const gram=desc.slice(i,i+5),distinctive=gram.filter(x=>x.length>=5&&!COMMON_ECHO_WORDS.has(x)&&!title.has(x)).length;
    if(distinctive<2)continue;
    if(body.includes(gram.join(' ')))return true;
  }
  return false;
}
function localStyleWarnings(review,input={}){
  const text=\`${'${review?.title||\'\'}'} ${'${review?.body||\'\'}'}\`.toLowerCase(),warnings=[];
  const patterns=[
    ['editorial_voice',/\\b(overall|verdict|caveat|tradeoff|full marks|final judgment|final judgement)\\b/],
    ['template_phrase',/\\b(my verdict|earns full marks|within (that|this) clear boundary|the portion that matters|limited mission|role is limited|central story|one practical detail|plain takeaway|that mattered because|what stood out was)\\b/],
    ['overformal_cadence',/;|:\\s*[a-z]/],
    ['analysis_framing',/\\b(concrete detail|rating|full marks|stronger member|weaker member|evidence boundary|product category|ownership side|use case|rationale|the assigned focus)\\b/],
    ['utility_jargon',/\\b(stay(?:s|ed|ing)? usable|useful (?:selection|lineup|option)|available (?:options|choices|features) (?:came|come|showed|show) up|the portion that matters)\\b/],
    ['category_explainer',/\\b(for this type of product|for a product like this|the product category|category actually provides|category promise|all-purpose solution|universal answer|headline benefit|common feature|obvious use case)\\b/],
    ['essay_cadence',/\\b(the reason i mention|that mattered because|the practical part was|what that did was|the plain takeaway|one practical detail|in real use)\\b/],
    ['persona_leakage',/\\b(for a buyer who|as a first[- ]time owner|from a gift giver(?:'s)? side|from a renter(?:'s)? side|from a homeowner(?:'s)? side|my use case|our use case|persona)\\b/],
    ['abstract_review_language',/\\b(that rationale|the purchase made sense|cost stayed reasonable|the product language was manageable|purpose stayed clear|matched the assigned|stayed within the boundary)\\b/],
    ['technical_register',/\\b(functional performance|acceptable functional|usage conditions|procedural effort|price point|value proposition|performance outcome|ownership experience|purchase decision|material quality (?:was|is)|met the expected use case|met expectations in(?: a)?|consistent with the price point)\\b/],
  ];
  for(const [name,pattern]of patterns)if(pattern.test(text))warnings.push(name);
  const body=String(review?.body||''),sentences=body.split(/[.!?]+/).map(x=>x.trim()).filter(Boolean);
  const wordCount=body.replace(/\\s+/g,' ').trim().split(/\\s+/).filter(Boolean).length;
  if(/^(?:connected|mounted|installed|placed|used|tried|bought|set|hooked)\\b/i.test(body)&&!/^(?:i|we)\\b/i.test(body))warnings.push('dropped_subject');
  if(sentences.length>=3&&sentences.every(x=>x.length>55))warnings.push('too_uniform_sentence_length');
  if(hasDistinctivePdpEcho(text,input))warnings.push('pdp_phrase_echo');
  if(wordCount<18)warnings.push('low_information_review');
  if(wordCount>85)warnings.push('overwritten_review');
  const positive=/\\b(love|great|perfect|excellent|amazing|works great|very happy|no complaints|five stars|highly recommend)\\b/i.test(body),negative=/\\b(disappointed|waste|return|returned|poor|bad|terrible|doesn'?t work|didn'?t work|not worth|frustrating|regret)\\b/i.test(body),rating=Number(review?.rating);
  if((rating<=2&&positive&&!negative)||(rating>=4&&negative&&!positive))warnings.push('rating_sentiment_mismatch');
  return[...new Set(warnings)].slice(0,10);
}
const HARD_LOCAL_STYLE_WARNINGS=new Set(['template_phrase','analysis_framing','category_explainer','essay_cadence','persona_leakage','abstract_review_language','technical_register','rating_sentiment_mismatch','pdp_phrase_echo']);
const hardLocalStyleWarnings=warnings=>(Array.isArray(warnings)?warnings:[]).filter(flag=>HARD_LOCAL_STYLE_WARNINGS.has(String(flag||'').toLowerCase()));

`;
const localGateStart=route.includes('const COMMON_ECHO_WORDS=')?'const COMMON_ECHO_WORDS=':'function localStyleWarnings(review,input={}){';
route=replaceBetween(route,localGateStart,'function softenUniformCadence',localGate);
route=route.replace('Never leave hard product-context conflicts, obvious template phrases, or analysis-style grading language in a final draft.','Never leave obvious template phrases, product-category explaining, persona leakage, or analysis-style grading language in a final draft.');
route=route.replace('It uses placement, installation, or usage context that conflicts with the authoritative PDP. Marketplace review pages can mix product variants, so keep only source details that fit this exact product and rewrite incompatible variant details.','It uses any context that conflicts with the authoritative PDP. Marketplace review pages can mix product variants, so keep only source details that fit this exact product and rewrite incompatible variant details.');
writeFileSync('app/api/generate/route.js',route);

let page=readFileSync('app/page.js','utf8');
page=page.replace('STYLE_REPAIR_CALL_CAP=1,DETERMINISTIC_REPAIR_CALL_CAP=1','STYLE_REPAIR_CALL_CAP=2,DETERMINISTIC_REPAIR_CALL_CAP=1');
page=page.replace("HARD_LOCAL_STYLE_FLAG_TYPES=new Set(['PRODUCT_CONTEXT_CONFLICT','TEMPLATE_PHRASE','ANALYSIS_FRAMING'])","HARD_LOCAL_STYLE_FLAG_TYPES=new Set(['TEMPLATE_PHRASE','ANALYSIS_FRAMING','CATEGORY_EXPLAINER','ESSAY_CADENCE','PERSONA_LEAKAGE','ABSTRACT_REVIEW_LANGUAGE','TECHNICAL_REGISTER','RATING_SENTIMENT_MISMATCH','PDP_PHRASE_ECHO'])");
writeFileSync('app/page.js',page);

console.log('natural language runtime patch applied');
