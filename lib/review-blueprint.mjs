const RATING_ANCHORS=[
  {mean:1,shares:[1,0,0,0,0]},
  {mean:1.3,shares:[.83,.1,.03,.02,.02]},
  {mean:2,shares:[.3,.5,.12,.06,.02]},
  {mean:3,shares:[.1,.2,.4,.2,.1]},
  {mean:4,shares:[.02,.06,.12,.5,.3]},
  {mean:4.7,shares:[.02,.02,.03,.1,.83]},
  {mean:5,shares:[0,0,0,0,1]},
];

const VOICES=[
  'plainspoken','warm conversational','dry and understated','blunt practical','careful analytical',
  'casual and clipped','enthusiastic but specific','skeptical and evidence-led','budget conscious','comparison driven',
  'detail attentive','low-key appreciative','problem-solution focused','first-time-user curious','experienced-user matter-of-fact',
  'busy-household practical','small-space conscious','convenience focused','performance focused','design sensitive',
  'instruction attentive','cautiously optimistic','minimalist','story led','balanced pros-and-cons',
];
const STRUCTURES=[
  'bottom line first, then one reason','brief chronology','expectation versus result','problem, adjustment, outcome',
  'one concrete detail, then verdict','pros followed by one caveat','caveat first, then what worked','miniature before-and-after story',
  'direct answer with a short explanation','observation, comparison, conclusion','single-scene anecdote','two short points and a verdict',
  'setup, regular use, final judgment',
];
const TEXTURES=[
  'natural contractions and ordinary vocabulary','mostly short sentences with one fragment','measured sentences with no hype',
  'one parenthetical aside at most','slightly informal wording without slang overload','specific nouns and restrained adjectives',
  'one mild hesitation or qualifier','compact wording that omits obvious background','a conversational transition such as but or honestly',
  'one concrete sensory or situational detail when appropriate','unpolished rhythm but correct meaning','matter-of-fact wording with no marketing phrases',
  'one comparison to the prior situation, not a competing brand','a clear limitation stated without dramatizing it',
  'a personal reaction followed by evidence','a practical recommendation with a condition','varied sentence lengths and no stock conclusion',
];
const LENGTHS=[
  {id:'micro',min:9,max:18},{id:'short',min:18,max:32},{id:'compact',min:28,max:44},{id:'standard',min:38,max:58},
  {id:'expanded',min:52,max:76},{id:'detailed',min:72,max:105},{id:'standard-light',min:34,max:50},{id:'compact-story',min:42,max:66},
];

export function hashSeed(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
export function seededRandom(seed){let a=Number(seed)>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export function shuffleSeeded(values,random){const out=[...values];for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out}

function desiredRatingShares(target){
  const value=Math.max(1,Math.min(5,Number(target)||0));
  let left=RATING_ANCHORS[0],right=RATING_ANCHORS.at(-1);
  for(let i=0;i<RATING_ANCHORS.length-1;i++)if(value>=RATING_ANCHORS[i].mean&&value<=RATING_ANCHORS[i+1].mean){left=RATING_ANCHORS[i];right=RATING_ANCHORS[i+1];break}
  if(left.mean===right.mean)return[...left.shares];
  const mix=(value-left.mean)/(right.mean-left.mean);
  return left.shares.map((share,i)=>share+(right.shares[i]-share)*mix);
}

export function solveNaturalRatingDistribution(reviewCount,targetAverage){
  const n=Number(reviewCount),requested=Number(targetAverage);
  if(!Number.isInteger(n)||n<1||n>250)throw Error('Review count must be an integer from 1 to 250.');
  if(!(requested>=1&&requested<=5))throw Error('Target average must be from 1 to 5.');
  const total=Math.round(n*requested),target=total/n,desired=desiredRatingShares(target).map(x=>x*n);
  let best=null;
  for(let five=0;five<=n;five++)for(let four=0;four<=n-five;four++){
    const remaining=n-five-four,left=total-five*5-four*4;
    if(left<remaining||left>remaining*3)continue;
    for(let three=0;three<=remaining;three++){
      const two=left-remaining-twoOrZero(three),one=remaining-three-two;
      if(two<0||one<0||!Number.isInteger(two)||!Number.isInteger(one))continue;
      const counts=[one,two,three,four,five];
      const score=counts.reduce((sum,count,i)=>sum+((count-desired[i])**2/Math.max(1,desired[i])),0);
      if(!best||score<best.score)best={score,counts};
    }
  }
  if(!best)throw Error('Could not solve the requested rating distribution.');
  const [one,two,three,four,five]=best.counts,by={5:five,4:four,3:three,2:two,1:one};
  return{by,avg:Object.entries(by).reduce((sum,[rating,count])=>sum+Number(rating)*count,0)/n,requestedAverage:requested};
}

function twoOrZero(three){return three*2}

export function requestedThemeCount(reviewCount){const n=Math.max(1,Number(reviewCount)||1);return Math.min(n,Math.max(12,Math.ceil(n/4)))}

const FALLBACK_THEME_FOCI=[
  'purchase rationale','expectations before use','first impression','shipping or packaging','instructions clarity',
  'setup time and effort','compatibility check','daily routine use','replacement for prior solution','value for price',
  'ongoing cost or subscription expectation','family or shared use','nontechnical buyer experience','experienced user perspective','space or placement constraint',
  'appearance and discretion','handling and materials impression','maintenance or upkeep','performance under normal conditions','performance limitation',
  'minor annoyance','return or keep decision','support or seller interaction','longer-term observation','gift or recommendation context',
  'portability or moving between spots','size and fit','household friction or lack of it','learning curve','comparison to cheaper alternative',
  'comparison to more expensive alternative','installation hardware or included parts','single-user or single-device setup','multi-user or multi-device expectations','weather or environment caveat',
  'quality control concern','simple satisfaction','balanced pros and cons','surprise benefit','not for every situation',
  'failed expectation','partial success','ease after setup','storage between uses','small defect tolerated',
  'small defect not tolerated','repeat purchase or second location','practical tip','customer mistake corrected','plain negative review',
  'plain positive review','overall recommendation','buyer-specific constraint','ordinary convenience','caveated recommendation',
  'reason for rating','unmet use case','works as expected','better than expected','worse than expected'
];
export function fallbackProductThemes(reviewCount){
  const count=requestedThemeCount(reviewCount);
  return Array.from({length:count},(_,index)=>{
    const base=FALLBACK_THEME_FOCI[index%FALLBACK_THEME_FOCI.length],suffix=index>=FALLBACK_THEME_FOCI.length?' '+(Math.floor(index/FALLBACK_THEME_FOCI.length)+1):'';
    const focus=base+suffix;
    return{
      id:'THEME-'+String(index+1).padStart(2,'0'),focus,
      scenarioVariants:[
        'customer explains '+focus+' with one concrete context detail',
        'customer describes a practical tradeoff around '+focus,
        'customer compares expectations to the result for '+focus,
        'customer gives a rating-appropriate verdict centered on '+focus,
      ],
      evidenceBoundary:'Keep claims within authoritative product facts and verified reference plausibility. Do not let one obvious setup step, troubleshooting action, headline feature, or marketing phrase dominate the corpus unless this theme explicitly makes it central.',
      allowedRatings:[1,2,3,4,5],
    };
  });
}

function normalizeText(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function cleanText(value,max=240){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function safeRatings(value){const xs=Array.isArray(value)?value:[];const out=[...new Set(xs.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=5))];return out.length?out:[1,2,3,4,5]}

const STAGE_RULES=[
  {id:'purchase_decision',label:'purchase decision',terms:['decided','chose','ordered','bought','purchase','picked','needed','wanted','looking for','shopping','considered']},
  {id:'setup_onboarding',label:'setup/onboarding',terms:['setup','set up','install','installed','installation','assembly','assembled','instructions','manual','configure','connected','paired','scan','scanned','mounted','unboxed','out of the box']},
  {id:'first_use',label:'first use',terms:['first time','first use','initially','right away','immediately','arrived','after it arrived','tried it','opened','unpacked']},
  {id:'daily_use',label:'daily use',terms:['daily','every day','regularly','routine','usual','most days','around the house','at home','workday','weekend','often']},
  {id:'long_term_use',label:'long-term use',terms:['weeks','months','year','years','still','so far','after a while','held up','durable','lasted','broke','wear','worn']},
  {id:'issue_troubleshooting',label:'issue/troubleshooting',terms:['issue','problem','trouble','failed','did not','didn t','does not','doesn t','would not','wouldn t','inconsistent','adjusted','reset','returned to','had to','kept trying']},
  {id:'support_return',label:'support/return',terms:['return','returned','refund','replacement','support','customer service','seller','warranty','exchange']},
];
const CONTEXT_RULES=[
  {id:'general_use',label:'general use',terms:['use','using','used','product','item','thing']},
  {id:'gift_or_family',label:'gift/family context',terms:['gift','mom','mother','dad','father','parent','parents','wife','husband','partner','son','daughter','kid','kids','family','friend','neighbor']},
  {id:'replacing_previous',label:'replacing previous solution',terms:['replaced','replacement','old one','previous','before this','upgrade','upgraded','switched','instead of','compared with','better than','worse than']},
  {id:'beginner_or_learning',label:'beginner/learning context',terms:['first time','new to','beginner','never used','learning','confusing','figured out','instructions','easy to understand']},
  {id:'experienced_user',label:'experienced-user context',terms:['i have used','used several','tried other','for years','again','another one','second one','third one']},
  {id:'space_or_environment',label:'space/environment constraint',terms:['small','large','room','house','apartment','office','garage','yard','outside','outdoor','indoor','window','wall','floor','desk','counter','corner','tight space','weather','distance','range','signal']},
  {id:'budget_value',label:'budget/value context',terms:['price','money','cost','cheap','expensive','worth','value','budget','bill','subscription','save','saves','paid']},
  {id:'shipping_packaging',label:'shipping/packaging context',terms:['shipping','shipped','delivered','delivery','arrived','package','packaging','box','damaged','missing']},
  {id:'work_or_business',label:'work/business context',terms:['work','business','client','customer','office','job','project','professional']},
];
const JOB_RULES=[
  {id:'core_performance',label:'core performance',terms:['works','worked','performance','reliable','consistent','strong','weak','stable','unstable','fast','slow','quality','effective','range','signal','connection','clear','clarity','accurate','accuracy']},
  {id:'ease_and_convenience',label:'ease/convenience',terms:['easy','simple','quick','convenient','hassle','effort','straightforward','smooth','portable','lightweight','compact']},
  {id:'fit_and_compatibility',label:'fit/compatibility',terms:['fit','fits','size','compatible','compatibility','matched','works with','too big','too small','adapter','connector']},
  {id:'appearance_design',label:'appearance/design',terms:['looks','looked','design','style','color','finish','visible','hidden','appearance','aesthetic','nice looking','ugly']},
  {id:'comfort_or_handling',label:'comfort/handling',terms:['comfortable','comfort','feel','feels','handle','heavy','light','weight','grip','awkward','smooth']},
  {id:'maintenance_or_cleanup',label:'maintenance/cleanup',terms:['clean','cleanup','wash','maintain','maintenance','refill','replace','battery','charge','charged','storage']},
  {id:'service_or_logistics',label:'service/logistics',terms:['support','seller','service','return','refund','replacement','shipping','delivery','warranty']},
];
const OUTCOME_RULES=[
  {id:'positive_outcome',label:'positive outcome',terms:['love','loved','great','excellent','perfect','happy','pleased','impressed','recommend','worth it','works well','good','better','solid']},
  {id:'mixed_outcome',label:'mixed outcome',terms:['but','however','though','although','mixed','okay','fine','decent','acceptable','not perfect','caveat','tradeoff','still']},
  {id:'negative_outcome',label:'negative outcome',terms:['bad','poor','terrible','disappointed','disappointing','waste','failed','broken','does not work','did not work','returned','refund','not worth','unusable']},
];
const TRADEOFF_RULES=[
  {id:'no_major_tradeoff',label:'no major tradeoff',terms:[]},
  {id:'price_tradeoff',label:'price/value tradeoff',terms:['price','cost','cheap','expensive','worth','value','budget','money']},
  {id:'effort_tradeoff',label:'effort/setup tradeoff',terms:['setup','install','assembly','instructions','had to','took a while','figured out','adjusted']},
  {id:'quality_tradeoff',label:'quality/reliability tradeoff',terms:['quality','durable','broke','stable','unstable','inconsistent','reliable','wear']},
  {id:'space_tradeoff',label:'space/visibility tradeoff',terms:['space','small','large','visible','hidden','bulky','compact','fits','fit','outside','indoor','outdoor']},
  {id:'expectation_tradeoff',label:'expectation/result tradeoff',terms:['expected','expecting','thought','hoped','advertised','claimed','supposed','promised']},
];
const COMPARISON_RULES=[
  {id:'no_comparison',label:'no comparison',terms:[]},
  {id:'prior_solution_comparison',label:'prior-solution comparison',terms:['replaced','old','previous','before','instead','upgrade','switched']},
  {id:'competitor_or_alternative_comparison',label:'alternative comparison',terms:['other brand','another brand','others','different one','compared','cheaper one','more expensive']},
  {id:'expectation_comparison',label:'expectation comparison',terms:['expected','expecting','thought','hoped','advertised','claimed','supposed']},
];

function scoreRule(text,rule){
  const hay=` ${normalizeText(text)} `,tokens=new Set(hay.trim().split(/\s+/).filter(Boolean)),hits=[];
  for(const term of rule.terms||[]){
    const needle=normalizeText(term);
    if(!needle)continue;
    const found=needle.includes(' ')?hay.includes(` ${needle} `):tokens.has(needle);
    if(found)hits.push(needle);
  }
  return{rule,score:hits.reduce((sum,hit)=>sum+(hit.includes(' ')?2:1),0),hits};
}
function dominantRule(text,rules,fallbackId){
  const fallback=rules.find(x=>x.id===fallbackId)||rules[0],scored=rules.map(rule=>scoreRule(text,rule)).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const top=scored[0]||{rule:fallback,score:0,hits:[]};
  return{id:top.rule.id,label:top.rule.label,hits:top.hits.slice(0,5)};
}
function outcomeFallbackFromRating(rating){
  const value=Number(rating)||0;
  if(value&&value<=2)return'negative_outcome';
  if(value===3)return'mixed_outcome';
  return'positive_outcome';
}
function specificityAnchors(text){
  const raw=String(text||''),normalized=` ${normalizeText(raw)} `,anchors=[];
  if(/\b\d+(?:\.\d+)?\b/.test(raw))anchors.push('numeric_detail');
  if(/\b(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\b/.test(normalized))anchors.push('timeframe');
  if(/\b(?:room|house|apartment|office|garage|yard|outside|outdoor|indoor|window|wall|floor|desk|counter|car|kitchen|bedroom)\b/.test(normalized))anchors.push('place_or_environment');
  if(/\b(?:mom|mother|dad|father|wife|husband|partner|kid|kids|family|friend|neighbor|client|customer)\b/.test(normalized))anchors.push('person_or_household');
  if(/\b(?:returned|refund|replacement|support|warranty|seller)\b/.test(normalized))anchors.push('service_or_return_event');
  return anchors.slice(0,6);
}
function compactFingerprintPart(raw){
  if(!raw||typeof raw!=='object')return null;
  const id=cleanText(raw.id,80),label=cleanText(raw.label,120);
  return id&&label?{id,label,hits:(Array.isArray(raw.hits)?raw.hits:[]).map(x=>cleanText(x,60)).filter(Boolean).slice(0,5)}:null;
}
export function sanitizeReferenceFingerprint(raw){
  if(!raw||typeof raw!=='object')return null;
  const laneId=cleanText(raw.laneId,260),laneLabel=cleanText(raw.laneLabel,240);
  if(!laneId||!laneLabel)return null;
  return{
    version:cleanText(raw.version,60)||'experience-fingerprint-v1',
    laneId,laneLabel,
    stage:compactFingerprintPart(raw.stage),
    context:compactFingerprintPart(raw.context),
    job:compactFingerprintPart(raw.job),
    outcome:compactFingerprintPart(raw.outcome),
    tradeoff:compactFingerprintPart(raw.tradeoff),
    comparison:compactFingerprintPart(raw.comparison),
    signals:(Array.isArray(raw.signals)?raw.signals:[]).map(x=>cleanText(x,90)).filter(Boolean).slice(0,14),
    specificityAnchors:(Array.isArray(raw.specificityAnchors)?raw.specificityAnchors:[]).map(x=>cleanText(x,80)).filter(Boolean).slice(0,8),
  };
}
export function referenceExperienceFingerprint(value){
  const title=cleanText(value?.sourceTitle||value?.title,220),body=cleanText(value?.sourceBody||value?.body||value?.text||value?.content,1200),rating=Number(value?.sourceRating)||null,text=`${title} ${body}`;
  const stage=dominantRule(text,STAGE_RULES,'daily_use'),context=dominantRule(text,CONTEXT_RULES,'general_use'),job=dominantRule(text,JOB_RULES,'core_performance'),outcome=dominantRule(text,OUTCOME_RULES,outcomeFallbackFromRating(rating)),tradeoff=dominantRule(text,TRADEOFF_RULES,'no_major_tradeoff'),comparison=dominantRule(text,COMPARISON_RULES,'no_comparison');
  const signals=[stage,context,job,outcome,tradeoff,comparison].flatMap(x=>x.hits.map(hit=>`${x.id}:${hit}`)),anchors=specificityAnchors(text),laneId=[stage.id,context.id,job.id,outcome.id].join('|'),laneLabel=`${stage.label} / ${context.label} / ${job.label} / ${outcome.label}`;
  return sanitizeReferenceFingerprint({version:'experience-fingerprint-v1',laneId,laneLabel,stage,context,job,outcome,tradeoff,comparison,signals:[...new Set(signals)].slice(0,14),specificityAnchors:anchors});
}

export function sanitizeThemes(rawThemes,{minimum=1,maximum=60}={}){
  const seen=new Set(),themes=[];
  for(const raw of Array.isArray(rawThemes)?rawThemes:[]){
    const focus=cleanText(raw?.focus,180),variantSeen=new Set(),variants=[];
    for(const value of Array.isArray(raw?.scenarioVariants)?raw.scenarioVariants:[]){const scenario=cleanText(value,220),key=normalizeText(scenario);if(!key||variantSeen.has(key))continue;variantSeen.add(key);variants.push(scenario);if(variants.length===4)break}
    const key=normalizeText(focus);
    if(!key||seen.has(key)||variants.length!==4)continue;
    seen.add(key);
    themes.push({
      id:`THEME-${String(themes.length+1).padStart(2,'0')}`,
      focus,
      scenarioVariants:variants,
      evidenceBoundary:cleanText(raw?.evidenceBoundary,240),
      allowedRatings:safeRatings(raw?.allowedRatings),
    });
    if(themes.length>=maximum)break;
  }
  if(themes.length<minimum)throw Error(`The corpus planner returned ${themes.length} usable themes; ${minimum} are required.`);
  return themes;
}

export function createPersonaProfiles(count,seedKey){
  const n=Math.max(0,Math.min(250,Number(count)||0)),seed=hashSeed(seedKey),profiles=[];
  for(let i=0;i<n;i++){
    const voice=VOICES[(i+seed)%VOICES.length],structure=STRUCTURES[(i*7+(seed>>>5))%STRUCTURES.length],texture=TEXTURES[(i*11+(seed>>>11))%TEXTURES.length],length=LENGTHS[(i*3+(seed>>>17))%LENGTHS.length];
    profiles.push({
      personaId:`PERSONA-${String(i+1).padStart(4,'0')}`,
      voice,structure,texture,lengthBand:length.id,minWords:length.min,maxWords:length.max,
      label:`${voice} · ${structure}`,
      signature:[voice,structure,texture,length.id].join('|'),
    });
  }
  if(new Set(profiles.map(x=>x.signature)).size!==profiles.length)throw Error('Persona profile construction produced a collision.');
  return shuffleSeeded(profiles,seededRandom(seed^0x9e3779b9));
}

function ratingList(distribution){return[5,4,3,2,1].flatMap(rating=>Array(distribution.by[rating]||0).fill(rating))}
function isoDay(ms){return new Date(ms).toISOString().slice(0,10)}
function hostFromUrl(value){try{return new URL(String(value||'')).host.replace(/^www\./,'').slice(0,120)}catch{return cleanText(value,120)}}
function firstNumber(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>=0)return n}return null}
export function sourceListingKey(value){
  const raw=String(value?.directSourceUrl||value?.sourceUrl||value?.url||value||'').trim(),asin=cleanText(value?.asin||value?.sourceAsin,20).toUpperCase();
  try{
    const url=new URL(raw),host=url.host.replace(/^www\./,'').toLowerCase(),path=url.pathname.replace(/\/+$/,'');
    const amazonAsin=asin||path.match(/\/(?:dp|gp\/product|product-reviews|clp)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    if(/(^|\.)amazon\./i.test(host)&&amazonAsin)return`amazon:${amazonAsin}`;
    const ebayItem=path.match(/\/itm\/(\d+)/i)?.[1];
    if(/(^|\.)ebay\./i.test(host)&&ebayItem)return`ebay:${ebayItem}`;
    url.hash='';url.search='';
    return`${host}${path||'/'}`.slice(0,300);
  }catch{return normalizeText(raw||asin||value?.platform||value?.provider).slice(0,300)}
}
export function sourceDisplayKey(value){
  const raw=String(value?.directSourceUrl||value?.sourceUrl||value?.url||'').trim(),asin=cleanText(value?.asin||value?.sourceAsin,20).toUpperCase();
  try{
    const url=new URL(raw),host=url.host.replace(/^www\./,'').toLowerCase(),path=url.pathname.replace(/\/+$/,'');
    const amazonAsin=asin||path.match(/\/(?:dp|gp\/product|product-reviews|clp)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    if(/(^|\.)amazon\./i.test(host)&&amazonAsin)return`https://${host}/dp/${amazonAsin}`;
    const ebayItem=path.match(/\/itm\/(\d+)/i)?.[1];
    if(/(^|\.)ebay\./i.test(host)&&ebayItem)return`https://${host}/itm/${ebayItem}`;
    url.hash='';url.search='';
    return url.href.replace(/\/$/,'').slice(0,500);
  }catch{return cleanText(raw||value?.sourceListingTitle||value?.platform||value?.provider,500)}
}
const TOPIC_STOPWORDS=new Set('a an and are as at be because been but by can could did do does for from get got had has have if in into is it its just like more most my no not of on one or our out over product really so some than that the their them then there they this to too use used using very was we were what when with would you your'.split(' '));
function topicTokenSet(text,globalNoise=new Set()){
  const tokens=normalizeText(text).split(/\s+/).filter(token=>token.length>=3&&!TOPIC_STOPWORDS.has(token)&&!globalNoise.has(token)&&!/^\d+$/.test(token));
  const bigrams=[];for(let i=0;i<tokens.length-1;i++)if(tokens[i]!==tokens[i+1])bigrams.push(`${tokens[i]}_${tokens[i+1]}`);
  return new Set([...tokens,...bigrams]);
}
function overlapScore(left,right){
  if(!left?.size||!right?.size)return 0;
  let hits=0;for(const token of left)if(right.has(token))hits++;
  return hits/Math.max(1,Math.min(left.size,right.size));
}
function assignReferenceClusters(refs,{productTitle='',productDescription=''}={}){
  const productNoise=topicTokenSet(`${productTitle} ${String(productDescription||'').slice(0,400)}`),docFreq=new Map();
  const rawSets=refs.map(ref=>topicTokenSet(`${ref.sourceTitle} ${ref.sourceBody}`,new Set()));
  for(const set of rawSets)for(const token of set)docFreq.set(token,(docFreq.get(token)||0)+1);
  const highFrequencyNoise=new Set([...docFreq.entries()].filter(([,count])=>count>Math.max(8,refs.length*.58)).map(([token])=>token)),globalNoise=new Set([...productNoise,...highFrequencyNoise]);
  const clusters=[];
  refs.forEach((ref,index)=>{
    const tokens=topicTokenSet(`${ref.sourceTitle} ${ref.sourceBody}`,globalNoise),usable=tokens.size?tokens:rawSets[index],best=clusters.map(cluster=>({cluster,score:overlapScore(usable,cluster.tokens)})).sort((a,b)=>b.score-a.score)[0];
    if(best&&best.score>=.42){
      best.cluster.refs.push(ref.referenceId);
      for(const token of usable)best.cluster.tokens.add(token);
      ref.referenceClusterId=best.cluster.id;
      ref.referenceClusterLabel=best.cluster.label;
    }else{
      const top=[...usable].filter(token=>!token.includes('_')).slice(0,5),cluster={id:`CLUSTER-${String(clusters.length+1).padStart(3,'0')}`,label:top.length?top.join('/'):(ref.referenceFingerprint?.laneLabel||'misc source theme'),tokens:new Set(usable),refs:[ref.referenceId]};
      clusters.push(cluster);
      ref.referenceClusterId=cluster.id;
      ref.referenceClusterLabel=cluster.label;
    }
  });
  return clusters.map(cluster=>({id:cluster.id,label:cluster.label,count:cluster.refs.length}));
}
function hasAnyText(text,terms){const hay=` ${normalizeText(text)} `;return terms.some(term=>hay.includes(` ${normalizeText(term)} `))}
function referenceStoryFamily(ref){
  const fp=ref.referenceFingerprint||{},text=`${ref.sourceTitle} ${ref.sourceBody}`,stage=fp.stage?.id||'',context=fp.context?.id||'',job=fp.job?.id||'',tradeoff=fp.tradeoff?.id||'',comparison=fp.comparison?.id||'';
  if(context==='shipping_packaging'||hasAnyText(text,['shipping','delivered','delivery','package','packaging']))return{id:'shipping_packaging',label:'shipping/packaging experience'};
  if(stage==='support_return'||job==='service_or_logistics'||hasAnyText(text,['return','refund','replacement','support','warranty','seller']))return{id:'support_return',label:'support/return experience'};
  if(context==='gift_or_family')return{id:'gift_family',label:'gift/family use'};
  if(comparison==='prior_solution_comparison'||hasAnyText(text,['replaced','old one','previous','upgrade','switched']))return{id:'prior_solution_comparison',label:'prior-solution comparison'};
  if(context==='budget_value'&&hasAnyText(text,['bill','subscription','save','saves','paid','free','cost','money']))return{id:'budget_replacement',label:'budget/value replacement'};
  if((context==='space_or_environment'||tradeoff==='space_tradeoff')&&(stage==='setup_onboarding'||stage==='issue_troubleshooting'||hasAnyText(text,['moved','move','placement','placed','window','outside','outdoor','higher','space','room'])))return{id:'environment_adjustment',label:'space/environment adjustment'};
  if(stage==='long_term_use'||tradeoff==='quality_tradeoff')return{id:'long_term_reliability',label:'long-term reliability'};
  if(job==='ease_and_convenience'||tradeoff==='effort_tradeoff'||stage==='setup_onboarding')return{id:'ease_setup',label:'ease/setup experience'};
  if(job==='appearance_design')return{id:'appearance_design',label:'appearance/design tradeoff'};
  if(context==='work_or_business')return{id:'work_business',label:'work/business use'};
  if(stage==='issue_troubleshooting')return{id:'issue_resolution',label:'issue/resolution outcome'};
  return{id:`${stage||'general'}:${context||'general'}:${job||'general'}`,label:`${fp.stage?.label||'general'} / ${fp.context?.label||'general'} / ${fp.job?.label||'general'}`};
}
function safeReferences(values,context={}){const seen=new Set(),out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanText(value?.referenceId,120),body=cleanText(value?.sourceBody||value?.body||value?.text||value?.content,1400);if(!id||body.length<10||seen.has(id))continue;seen.add(id);const sourceKey=sourceListingKey(value),sourceDisplay=sourceDisplayKey(value);const ref={referenceId:id,sourceRating:Number(value?.sourceRating)||null,sourceUrl:cleanText(value?.sourceUrl||value?.url,1000),sourceTitle:cleanText(value?.sourceTitle||value?.title,220),sourceBody:body,sourceKey,sourceDisplayKey:sourceDisplay,sourceHost:hostFromUrl(value?.sourceUrl||value?.url)||cleanText(value?.platform||value?.provider,120),sourceAsin:cleanText(value?.sourceAsin||value?.asin,20).toUpperCase(),sourceListingTitle:cleanText(value?.sourceListingTitle||value?.listingTitle||value?.title,240),sourcePlatform:cleanText(value?.platform,80),sourceProvider:cleanText(value?.provider,80),sourcePublicReviewCount:firstNumber(value?.sourcePublicReviewCount,value?.publicReviewCount,value?.reviewCountEstimate,value?.aggregateRatingCount,value?.itemFeedbackCount),sourceExtractedCount:firstNumber(value?.sourceExtractedCount,value?.individualExtractedCount,value?.extractedReviewCount,value?.reviewCount)};ref.referenceFingerprint=sanitizeReferenceFingerprint(value?.referenceFingerprint)||referenceExperienceFingerprint(ref);const family=referenceStoryFamily(ref);ref.referenceStoryFamilyId=family.id;ref.referenceStoryFamilyLabel=family.label;out.push(ref)}assignReferenceClusters(out,context);return out}

function maxFlowThemeAllocation(distribution,themes,themeCapacities){
  const ratings=[1,2,3,4,5],source=0,ratingStart=1,themeStart=ratingStart+ratings.length,sink=themeStart+themes.length,graph=Array.from({length:sink+1},()=>[]),themeEdges=[];
  function edge(from,to,capacity){const forward={to,capacity,initial:capacity,reverse:graph[to].length},backward={to:from,capacity:0,initial:0,reverse:graph[from].length};graph[from].push(forward);graph[to].push(backward);return forward}
  for(let r=0;r<ratings.length;r++)edge(source,ratingStart+r,distribution.by[ratings[r]]||0);
  for(let r=0;r<ratings.length;r++)for(let t=0;t<themes.length;t++)if(themes[t].allowedRatings.includes(ratings[r]))themeEdges.push({rating:ratings[r],themeIndex:t,edge:edge(ratingStart+r,themeStart+t,themeCapacities[t])});
  for(let t=0;t<themes.length;t++)edge(themeStart+t,sink,themeCapacities[t]);
  let flow=0;
  while(true){const parent=Array(graph.length).fill(null),queue=[source];parent[source]={node:-1,edgeIndex:-1};for(let q=0;q<queue.length&&!parent[sink];q++){const node=queue[q];for(let i=0;i<graph[node].length;i++){const candidate=graph[node][i];if(candidate.capacity>0&&!parent[candidate.to]){parent[candidate.to]={node,edgeIndex:i};queue.push(candidate.to);if(candidate.to===sink)break}}}if(!parent[sink])break;let amount=Infinity;for(let node=sink;node!==source;){const step=parent[node],candidate=graph[step.node][step.edgeIndex];amount=Math.min(amount,candidate.capacity);node=step.node}for(let node=sink;node!==source;){const step=parent[node],candidate=graph[step.node][step.edgeIndex];candidate.capacity-=amount;graph[node][candidate.reverse].capacity+=amount;node=step.node}flow+=amount}
  const byRating=new Map(ratings.map(rating=>[rating,[]]));
  for(const item of themeEdges){const used=item.edge.initial-item.edge.capacity;for(let i=0;i<used;i++)byRating.get(item.rating).push(item.themeIndex)}
  return{flow,byRating};
}

function allocateThemes(distribution,themes,random){
  const total=Object.values(distribution.by).reduce((sum,count)=>sum+count,0),base=Math.floor(total/themes.length),extra=total%themes.length,extraIndexes=new Set(shuffleSeeded(themes.map((_,index)=>index),random).slice(0,extra)),themeCapacities=themes.map((_,index)=>base+(extraIndexes.has(index)?1:0));
  let allocation=maxFlowThemeAllocation(distribution,themes,themeCapacities),ratingCompatibilityFallback=false;
  if(allocation.flow!==total){allocation=maxFlowThemeAllocation(distribution,themes.map(theme=>({...theme,allowedRatings:[1,2,3,4,5]})),themeCapacities);ratingCompatibilityFallback=true}
  if(allocation.flow!==total)throw Error('The corpus planner could not allocate every rating across the available theme scenarios.');
  for(const [rating,indexes] of allocation.byRating)allocation.byRating.set(rating,shuffleSeeded(indexes,random));
  return{...allocation,themeCapacities,ratingCompatibilityFallback};
}

function spreadThemeRepeats(items,themes,random){
  const queues=new Map(themes.map(theme=>[theme.id,[]]));
  for(const item of items){const queue=queues.get(item.blueprint.themeId)||[];queue.push(item);queues.set(item.blueprint.themeId,queue)}
  const order=shuffleSeeded(themes.map(theme=>theme.id),random),spread=[];
  while(spread.length<items.length){let advanced=false;for(const id of order){const item=queues.get(id)?.shift();if(!item)continue;spread.push(item);advanced=true}if(!advanced)break}
  return spread.map((item,index)=>({...item,index,id:`SYN-${String(index+1).padStart(4,'0')}`}));
}

function increment(map,key){if(!key)return;map.set(key,(map.get(key)||0)+1)}
function sortedCountObject(map,limit=80){return Object.fromEntries([...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).slice(0,limit))}
function softUsageCap(total,bucketCount,share=.18){
  if(!bucketCount)return total;
  const even=Math.ceil(total/bucketCount)+1,absolute=Math.max(4,Math.ceil(total*share));
  return Math.max(2,Math.min(even,absolute));
}
function referenceAssignmentDiagnostics(items,refs,caps={},sourcePriority=[]){
  const assigned=items.filter(x=>x.referenceId),laneUsage=new Map(),stageUsage=new Map(),contextUsage=new Map(),familyUsage=new Map(),clusterUsage=new Map(),sourceUsage=new Map(),roleUsage=new Map();
  for(const item of assigned){
    const fp=item.referenceFingerprint||{};
    increment(laneUsage,fp.laneLabel||fp.laneId||'unfingerprinted');
    increment(stageUsage,fp.stage?.label||fp.stage?.id||'unknown');
    increment(contextUsage,fp.context?.label||fp.context?.id||'unknown');
    increment(familyUsage,item.referenceStoryFamilyLabel||item.referenceStoryFamilyId||'unknown');
    increment(clusterUsage,item.referenceClusterLabel||item.referenceClusterId||'unclustered');
    increment(sourceUsage,item.referenceSourceKey||'unknown');
    increment(roleUsage,item.referenceRole||'source_rewrite');
  }
  return{
    referenceLedTotal:assigned.length,
    referencePoolTotal:refs.length,
    referencePoolLaneCount:new Set(refs.map(x=>x.referenceFingerprint?.laneId||'unfingerprinted')).size,
    referencePoolStageCount:new Set(refs.map(x=>x.referenceFingerprint?.stage?.id||'unknown')).size,
    referencePoolStoryFamilyCount:new Set(refs.map(x=>x.referenceStoryFamilyId||'unknown')).size,
    referencePoolClusterCount:new Set(refs.map(x=>x.referenceClusterId||'unclustered')).size,
    referenceLaneCount:laneUsage.size,
    referenceStageCount:stageUsage.size,
    referenceStoryFamilyCount:familyUsage.size,
    referenceClusterCount:clusterUsage.size,
    referenceLaneUsage:sortedCountObject(laneUsage),
    referenceStageUsage:sortedCountObject(stageUsage),
    referenceContextUsage:sortedCountObject(contextUsage),
    referenceStoryFamilyUsage:sortedCountObject(familyUsage),
    referenceClusterUsage:sortedCountObject(clusterUsage),
    referenceSourceUsage:sortedCountObject(sourceUsage,20),
    referenceRoleUsage:sortedCountObject(roleUsage),
    referenceAssignmentCaps:caps,
    referenceSourceSelectionStrategy:caps.sourceSelectionStrategy||'balanced',
    referencePrimarySourceKey:sourcePriority[0]?.sourceKey||null,
    referenceSourcePriority:sourcePriority.slice(0,20),
  };
}
function applyReferenceRoles(items,caps={}){
  const byFamily=new Map();
  for(const item of items.filter(x=>x.referenceId)){
    const key=item.referenceStoryFamilyId||'unknown';
    const xs=byFamily.get(key)||[];xs.push(item);byFamily.set(key,xs);
  }
  const datasetSize=items.length;
  const sourceRewriteCap=datasetSize>=100?1:datasetSize>=50?2:Math.max(3,Math.min(Number(caps.storyFamilySoftCap)||5,Math.ceil(datasetSize*.08),8));
  for(const familyItems of byFamily.values()){
    familyItems.sort((a,b)=>Math.abs((a.rating||3)-(a.referenceFingerprint?.outcome?.id==='negative_outcome'?2:a.referenceFingerprint?.outcome?.id==='mixed_outcome'?3:5))-Math.abs((b.rating||3)-(b.referenceFingerprint?.outcome?.id==='negative_outcome'?2:b.referenceFingerprint?.outcome?.id==='mixed_outcome'?3:5))||a.index-b.index);
    familyItems.forEach((item,index)=>{item.referenceRole=index<sourceRewriteCap?'source_rewrite':'reference_supported_blueprint'});
  }
}
function rankedSourceGroups(refs,random){
  const map=new Map();
  refs.forEach((ref,index)=>{
    const key=ref.sourceKey||ref.sourceDisplayKey||ref.sourceUrl||ref.sourceHost||'unknown',group=map.get(key)||{sourceKey:key,sourceDisplayKey:ref.sourceDisplayKey||ref.sourceUrl||key,platform:ref.sourcePlatform||ref.sourceHost||'',provider:ref.sourceProvider||'',publicReviewCount:0,indexes:[]};
    group.publicReviewCount=Math.max(group.publicReviewCount,Number(ref.sourcePublicReviewCount)||0);
    group.indexes.push(index);
    map.set(key,group);
  });
  return[...map.values()].map(group=>({...group,extractedReferenceCount:group.indexes.length,indexes:shuffleSeeded(group.indexes,random)})).sort((a,b)=>(b.publicReviewCount-a.publicReviewCount)||(b.extractedReferenceCount-a.extractedReferenceCount)||String(a.sourceDisplayKey).localeCompare(String(b.sourceDisplayKey)));
}
function assignReferences(items,references,random,context={}){
  const refs=shuffleSeeded(safeReferences(references,context),random);
  if(!items.length||!refs.length)return referenceAssignmentDiagnostics(items,refs);
  const sourceGroups=rankedSourceGroups(refs,random),lanePoolCount=new Set(refs.map(x=>x.referenceFingerprint?.laneId||'unfingerprinted')).size,stagePoolCount=new Set(refs.map(x=>x.referenceFingerprint?.stage?.id||'unknown')).size,familyPoolCount=new Set(refs.map(x=>x.referenceStoryFamilyId||'unknown')).size,clusterPoolCount=new Set(refs.map(x=>x.referenceClusterId||'unclustered')).size,sourcePoolCount=sourceGroups.length,caps={laneSoftCap:softUsageCap(items.length,lanePoolCount,.16),stageSoftCap:softUsageCap(items.length,stagePoolCount,.34),storyFamilySoftCap:softUsageCap(items.length,familyPoolCount,.14),clusterSoftCap:softUsageCap(items.length,clusterPoolCount,.12),sourceSoftCap:items.length,sourceSelectionStrategy:'highest_review_listing_sequential'};
  const exactByRating=new Map(),closeByRating=new Map();
  for(let rating=1;rating<=5;rating++){
    exactByRating.set(rating,refs.filter(ref=>Number(ref.sourceRating)===rating).length);
    closeByRating.set(rating,refs.filter(ref=>!ref.sourceRating||Math.abs(Number(ref.sourceRating)-rating)<=1).length);
  }
  const order=shuffleSeeded(items.map((_,index)=>index),random).sort((a,b)=>(exactByRating.get(items[a].rating)-exactByRating.get(items[b].rating))||(closeByRating.get(items[a].rating)-closeByRating.get(items[b].rating))||(items[a].rating-items[b].rating));
  const laneUsage=new Map(),stageUsage=new Map(),contextUsage=new Map(),familyUsage=new Map(),clusterUsage=new Map(),sourceUsage=new Map();
  for(const itemIndex of order){
    const sourceGroup=sourceGroups.find(group=>group.indexes.length);
    if(!sourceGroup)break;
    let best=null,bestScore=Infinity,bestPosition=-1;
    for(let position=0;position<sourceGroup.indexes.length;position++){
      const refIndex=sourceGroup.indexes[position];
      const ref=refs[refIndex],fp=ref.referenceFingerprint||{},laneId=fp.laneId||'unfingerprinted',stageId=fp.stage?.id||'unknown',contextId=fp.context?.id||'unknown',familyId=ref.referenceStoryFamilyId||'unknown',clusterId=ref.referenceClusterId||'unclustered',sourceKey=ref.sourceKey||'unknown',distance=ref.sourceRating?Math.abs(ref.sourceRating-items[itemIndex].rating):2,laneUse=laneUsage.get(laneId)||0,stageUse=stageUsage.get(stageId)||0,contextUse=contextUsage.get(contextId)||0,familyUse=familyUsage.get(familyId)||0,clusterUse=clusterUsage.get(clusterId)||0,sourceUse=sourceUsage.get(sourceKey)||0;
      let score=distance*180+familyUse*180+clusterUse*100+laneUse*65+stageUse*20+contextUse*12+sourceUse*.01+random();
      if(familyUse>=caps.storyFamilySoftCap)score+=1500+(familyUse-caps.storyFamilySoftCap)*700;
      if(clusterUse>=caps.clusterSoftCap)score+=1200+(clusterUse-caps.clusterSoftCap)*550;
      if(laneUse>=caps.laneSoftCap)score+=900+(laneUse-caps.laneSoftCap)*450;
      if(stageUse>=caps.stageSoftCap)score+=180+(stageUse-caps.stageSoftCap)*80;
      if(score<bestScore){bestScore=score;best=refIndex;bestPosition=position}
    }
    if(best==null)break;
    const ref=refs[best],fp=ref.referenceFingerprint||{},laneId=fp.laneId||'unfingerprinted',stageId=fp.stage?.id||'unknown',contextId=fp.context?.id||'unknown',familyId=ref.referenceStoryFamilyId||'unknown',clusterId=ref.referenceClusterId||'unclustered',sourceKey=ref.sourceKey||'unknown',sourceUsageKey=ref.sourceDisplayKey||sourceKey;
    items[itemIndex].referenceId=ref.referenceId;
    items[itemIndex].referenceFingerprint=fp;
    items[itemIndex].referenceStoryFamilyId=ref.referenceStoryFamilyId||null;
    items[itemIndex].referenceStoryFamilyLabel=ref.referenceStoryFamilyLabel||null;
    items[itemIndex].referenceClusterId=ref.referenceClusterId||null;
    items[itemIndex].referenceClusterLabel=ref.referenceClusterLabel||null;
    items[itemIndex].referenceSourceKey=sourceUsageKey;
    increment(laneUsage,laneId);increment(stageUsage,stageId);increment(contextUsage,contextId);increment(familyUsage,familyId);increment(clusterUsage,clusterId);increment(sourceUsage,sourceUsageKey);
    sourceGroup.indexes.splice(bestPosition,1);
  }
  applyReferenceRoles(items,caps);
  return referenceAssignmentDiagnostics(items,refs,caps,sourceGroups.map(group=>({sourceKey:group.sourceDisplayKey||group.sourceKey,platform:group.platform,provider:group.provider,publicReviewCount:group.publicReviewCount||null,extractedReferenceCount:group.extractedReferenceCount})));
}

export function createBlueprintPlan({productTitle,productDescription,reviewCount,targetAverage,themes,references=[],now=Date.now(),nonce=''}){
  const n=Number(reviewCount),distribution=solveNaturalRatingDistribution(n,targetAverage),seedKey=[productTitle,productDescription,n,targetAverage,nonce,isoDay(now)].join('|'),seed=hashSeed(seedKey),random=seededRandom(seed),profiles=createPersonaProfiles(n,`${seedKey}|personas`),ratings=shuffleSeeded(ratingList(distribution),random),themeCount=Math.min(n,requestedThemeCount(n)),cleanThemes=sanitizeThemes(themes,{minimum:themeCount,maximum:themeCount}),allocation=allocateThemes(distribution,cleanThemes,random),usage=new Map();
  let lastTheme='';
  let items=[];
  for(let i=0;i<n;i++){
    const rating=ratings[i],pool=allocation.byRating.get(rating),differentIndex=pool.findIndex(index=>cleanThemes[index].id!==lastTheme),choice=differentIndex>=0?differentIndex:0,themeIndex=pool.splice(choice,1)[0],theme=cleanThemes[themeIndex],used=usage.get(theme.id)||0,profile=profiles[i],scenario=theme.scenarioVariants[used];
    usage.set(theme.id,used+1);lastTheme=theme.id;
    items.push({
      index:i,id:`SYN-${String(i+1).padStart(4,'0')}`,rating,date:isoDay(now-Math.floor(random()*365)*86400000),
      personaId:profile.personaId,persona:profile.label,personaProfile:profile,
      blueprint:{themeId:theme.id,scenarioId:`${theme.id}-S${used+1}`,focus:theme.focus,scenario,evidenceBoundary:theme.evidenceBoundary,narrativeShape:profile.structure},
      referenceId:null,syntheticFixture:true,publicationAllowed:false,
    });
  }
  items=spreadThemeRepeats(items,cleanThemes,random);
  const referenceDiagnostics=assignReferences(items,references,random,{productTitle,productDescription});
  const planId=`PLAN-${hashSeed(`${seedKey}|${cleanThemes.map(x=>x.id).join('|')}`).toString(16).padStart(8,'0')}`,
    runId=`RUN-${Number(now).toString(36)}-${hashSeed(`${seedKey}|run`).toString(16).padStart(8,'0')}`,
    themeUsage=Object.fromEntries([...usage.entries()]);
  return{
    planId,runId,generatedAt:new Date(now).toISOString(),distribution:distribution.by,actualAverage:distribution.avg,items,themes:cleanThemes,
    diagnostics:{themeCount:cleanThemes.length,minThemeUse:Math.min(...usage.values()),maxThemeUse:Math.max(...usage.values()),uniqueScenarios:new Set(items.map(x=>x.blueprint.scenarioId)).size,uniquePersonaProfiles:new Set(items.map(x=>x.personaProfile.signature)).size,referenceLedTotal:items.filter(x=>x.referenceId).length,ratingCompatibilityFallback:allocation.ratingCompatibilityFallback,themeUsage,...referenceDiagnostics},
  };
}

export function sanitizePlanItems(values,{maximum=10,reviewCount=250}={}){
  const seen=new Set(),out=[];
  for(const raw of Array.isArray(values)?values:[]){
    const id=cleanText(raw?.id,24),rating=Number(raw?.rating),index=Number(raw?.index),profile=raw?.personaProfile||{},blueprint=raw?.blueprint||{},personaId=cleanText(raw?.personaId,40),themeId=cleanText(blueprint?.themeId,60),scenarioId=cleanText(blueprint?.scenarioId,80),focus=cleanText(blueprint?.focus,220),scenario=cleanText(blueprint?.scenario,260),voice=cleanText(profile?.voice,100),structure=cleanText(profile?.structure,180),texture=cleanText(profile?.texture,180);
    if(!Number.isInteger(index)||index<0||index>=reviewCount||id!==`SYN-${String(index+1).padStart(4,'0')}`||seen.has(id)||!Number.isInteger(rating)||rating<1||rating>5||!personaId||!themeId||!scenarioId||!focus||!scenario||!voice||!structure||!texture)continue;
    const minWords=Math.max(5,Math.min(140,Number(profile?.minWords)||20)),maxWords=Math.min(160,Math.max(minWords,Number(profile?.maxWords)||60));
    seen.add(id);
    const referenceFingerprint=sanitizeReferenceFingerprint(raw?.referenceFingerprint);
    out.push({
      index,id,rating,date:/^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date||''))?String(raw.date):isoDay(Date.now()),
      personaId,persona:cleanText(raw?.persona,180)||cleanText(profile?.label,180),
      personaProfile:{voice,structure,texture,lengthBand:cleanText(profile?.lengthBand,40),minWords,maxWords,signature:cleanText(profile?.signature,300)},
      blueprint:{themeId,scenarioId,focus,scenario,evidenceBoundary:cleanText(blueprint?.evidenceBoundary,280),narrativeShape:cleanText(blueprint?.narrativeShape,180)||structure},
      referenceId:cleanText(raw?.referenceId,120)||null,referenceRole:['source_rewrite','reference_supported_blueprint'].includes(raw?.referenceRole)?raw.referenceRole:null,referenceFingerprint,referenceStoryFamilyId:cleanText(raw?.referenceStoryFamilyId,100)||null,referenceStoryFamilyLabel:cleanText(raw?.referenceStoryFamilyLabel,180)||null,referenceClusterId:cleanText(raw?.referenceClusterId,80)||null,referenceClusterLabel:cleanText(raw?.referenceClusterLabel,180)||null,referenceSourceKey:cleanText(raw?.referenceSourceKey,160)||null,syntheticFixture:true,publicationAllowed:false,
    });
    if(out.length>=maximum)break;
  }
  return out;
}

function words(value){return normalizeText(value).split(/\s+/).filter(Boolean)}
function shingles(value,size=3){const tokens=words(value),out=new Set();for(let i=0;i<=tokens.length-size;i++)out.add(tokens.slice(i,i+size).join(' '));return out}
function jaccard(left,right){if(!left.size&&!right.size)return 1;let hits=0;for(const value of left)if(right.has(value))hits++;return hits/Math.max(1,left.size+right.size-hits)}
function groupByNormalized(reviews,field){const map=new Map();for(const review of reviews){const key=normalizeText(review?.[field]);if(!key)continue;const ids=map.get(key)||[];ids.push(String(review.id));map.set(key,ids)}return[...map.entries()].filter(([,ids])=>ids.length>1).map(([value,ids])=>({value,ids}))}

export function corpusQualitySignals(values){
  const reviews=(Array.isArray(values)?values:[]).filter(x=>x?.id&&x?.body),exactDuplicateGroups=groupByNormalized(reviews,'body'),duplicateTitleGroups=groupByNormalized(reviews,'title'),tri=reviews.map(x=>shingles(x.body,3)),repairReasons=new Map(),lexicalNearDuplicatePairs=[];
  const flag=(id,reason)=>{const reasons=repairReasons.get(id)||[];if(!reasons.includes(reason))reasons.push(reason);repairReasons.set(id,reasons)};
  for(const group of exactDuplicateGroups)group.ids.slice(1).forEach(id=>flag(id,'exact_duplicate_body'));
  for(const group of duplicateTitleGroups)group.ids.slice(1).forEach(id=>flag(id,'duplicate_title'));
  for(let i=0;i<reviews.length;i++)for(let j=i+1;j<reviews.length;j++){
    const leftWords=words(reviews[i].body).length,rightWords=words(reviews[j].body).length,score=jaccard(tri[i],tri[j]),threshold=Math.min(leftWords,rightWords)<=22?.25:.34;
    if(score>=threshold){lexicalNearDuplicatePairs.push({ids:[reviews[i].id,reviews[j].id],score:Number(score.toFixed(3))});flag(reviews[j].id,'lexical_near_duplicate')}
  }
  const openings=new Map();for(const review of reviews){const key=words(review.body).slice(0,5).join(' ');if(!key)continue;const ids=openings.get(key)||[];ids.push(review.id);openings.set(key,ids)}
  const repeatedOpenings=[...openings.entries()].filter(([,ids])=>ids.length>2).map(([opening,ids])=>({opening,ids}));for(const group of repeatedOpenings)group.ids.slice(2).forEach(id=>flag(id,'repeated_opening'));
  const repairIds=[...repairReasons.keys()];
  return{
    passed:repairIds.length===0,count:reviews.length,uniqueBodies:reviews.length-exactDuplicateGroups.reduce((sum,g)=>sum+g.ids.length-1,0),uniqueTitles:reviews.length-duplicateTitleGroups.reduce((sum,g)=>sum+g.ids.length-1,0),
    exactDuplicateGroups,duplicateTitleGroups,lexicalNearDuplicatePairs:lexicalNearDuplicatePairs.sort((a,b)=>b.score-a.score).slice(0,40),repeatedOpenings,repairIds,repairReasons:Object.fromEntries(repairReasons),
  };
}

export function mergeReviewReplacements(current,replacements){const map=new Map((Array.isArray(replacements)?replacements:[]).map(x=>[x.id,x]));return(Array.isArray(current)?current:[]).map(x=>map.get(x.id)||x)}
