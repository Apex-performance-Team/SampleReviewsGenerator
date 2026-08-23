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

function normalizeText(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function cleanText(value,max=240){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function safeRatings(value){const xs=Array.isArray(value)?value:[];const out=[...new Set(xs.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=5))];return out.length?out:[1,2,3,4,5]}

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
function safeReferences(values){const seen=new Set(),out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanText(value?.referenceId,120);if(!id||seen.has(id))continue;seen.add(id);out.push({referenceId:id,sourceRating:Number(value?.sourceRating)||null})}return out}

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

function assignReferences(items,references,random){
  const available=new Set(items.map((_,i)=>i)),refs=shuffleSeeded(safeReferences(references),random);
  for(const reference of refs){
    let best=null,bestScore=Infinity;
    for(const index of available){const distance=reference.sourceRating?Math.abs(reference.sourceRating-items[index].rating):2,score=distance*100+random();if(score<bestScore){bestScore=score;best=index}}
    if(best==null)break;
    items[best].referenceId=reference.referenceId;available.delete(best);
  }
}

export function createBlueprintPlan({productTitle,productDescription,reviewCount,targetAverage,themes,references=[],now=Date.now(),nonce=''}){
  const n=Number(reviewCount),distribution=solveNaturalRatingDistribution(n,targetAverage),seedKey=[productTitle,productDescription,n,targetAverage,nonce,isoDay(now)].join('|'),seed=hashSeed(seedKey),random=seededRandom(seed),profiles=createPersonaProfiles(n,`${seedKey}|personas`),ratings=shuffleSeeded(ratingList(distribution),random),themeCount=Math.min(n,requestedThemeCount(n)),cleanThemes=sanitizeThemes(themes,{minimum:themeCount,maximum:themeCount}),allocation=allocateThemes(distribution,cleanThemes,random),usage=new Map();
  let lastTheme='';
  const items=[];
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
  assignReferences(items,references,random);
  const planId=`PLAN-${hashSeed(`${seedKey}|${cleanThemes.map(x=>x.id).join('|')}`).toString(16).padStart(8,'0')}`,
    runId=`RUN-${Number(now).toString(36)}-${hashSeed(`${seedKey}|run`).toString(16).padStart(8,'0')}`,
    themeUsage=Object.fromEntries([...usage.entries()]);
  return{
    planId,runId,generatedAt:new Date(now).toISOString(),distribution:distribution.by,actualAverage:distribution.avg,items,themes:cleanThemes,
    diagnostics:{themeCount:cleanThemes.length,minThemeUse:Math.min(...usage.values()),maxThemeUse:Math.max(...usage.values()),uniqueScenarios:new Set(items.map(x=>x.blueprint.scenarioId)).size,uniquePersonaProfiles:new Set(items.map(x=>x.personaProfile.signature)).size,referenceLedTotal:items.filter(x=>x.referenceId).length,ratingCompatibilityFallback:allocation.ratingCompatibilityFallback,themeUsage},
  };
}

export function sanitizePlanItems(values,{maximum=10,reviewCount=250}={}){
  const seen=new Set(),out=[];
  for(const raw of Array.isArray(values)?values:[]){
    const id=cleanText(raw?.id,24),rating=Number(raw?.rating),index=Number(raw?.index),profile=raw?.personaProfile||{},blueprint=raw?.blueprint||{},personaId=cleanText(raw?.personaId,40),themeId=cleanText(blueprint?.themeId,60),scenarioId=cleanText(blueprint?.scenarioId,80),focus=cleanText(blueprint?.focus,220),scenario=cleanText(blueprint?.scenario,260),voice=cleanText(profile?.voice,100),structure=cleanText(profile?.structure,180),texture=cleanText(profile?.texture,180);
    if(!Number.isInteger(index)||index<0||index>=reviewCount||id!==`SYN-${String(index+1).padStart(4,'0')}`||seen.has(id)||!Number.isInteger(rating)||rating<1||rating>5||!personaId||!themeId||!scenarioId||!focus||!scenario||!voice||!structure||!texture)continue;
    const minWords=Math.max(5,Math.min(140,Number(profile?.minWords)||20)),maxWords=Math.min(160,Math.max(minWords,Number(profile?.maxWords)||60));
    seen.add(id);
    out.push({
      index,id,rating,date:/^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date||''))?String(raw.date):isoDay(Date.now()),
      personaId,persona:cleanText(raw?.persona,180)||cleanText(profile?.label,180),
      personaProfile:{voice,structure,texture,lengthBand:cleanText(profile?.lengthBand,40),minWords,maxWords,signature:cleanText(profile?.signature,300)},
      blueprint:{themeId,scenarioId,focus,scenario,evidenceBoundary:cleanText(blueprint?.evidenceBoundary,280),narrativeShape:cleanText(blueprint?.narrativeShape,180)||structure},
      referenceId:cleanText(raw?.referenceId,120)||null,syntheticFixture:true,publicationAllowed:false,
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
