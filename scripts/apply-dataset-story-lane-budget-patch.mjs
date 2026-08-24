import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

function writeIfChanged(path, next) {
  const current = fs.readFileSync(path, 'utf8');
  if (current === next) return false;
  fs.writeFileSync(path, next);
  return true;
}
function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw Error(`Patch anchor not found: ${label}`);
}

function patchBlueprint() {
  const path = 'lib/review-blueprint.mjs';
  let text = fs.readFileSync(path, 'utf8');
  let changed = false;
  if (text.includes('export function fallbackProductThemes(')) {
    // Continue below; this patch also tightens the reference-story role budget.
  } else {
  const anchor = "export function requestedThemeCount(reviewCount){const n=Math.max(1,Number(reviewCount)||1);return Math.min(n,Math.max(12,Math.ceil(n/4)))}";
  assertIncludes(text, anchor, `${path}: requestedThemeCount`);
  const fallback = [
    anchor,
    '',
    "const FALLBACK_THEME_FOCI=[",
    "  'purchase rationale','expectations before use','first impression','shipping or packaging','instructions clarity',",
    "  'setup time and effort','compatibility check','daily routine use','replacement for prior solution','value for price',",
    "  'ongoing cost or subscription expectation','family or shared use','nontechnical buyer experience','experienced user perspective','space or placement constraint',",
    "  'appearance and discretion','handling and materials impression','maintenance or upkeep','performance under normal conditions','performance limitation',",
    "  'minor annoyance','return or keep decision','support or seller interaction','longer-term observation','gift or recommendation context',",
    "  'portability or moving between spots','size and fit','household friction or lack of it','learning curve','comparison to cheaper alternative',",
    "  'comparison to more expensive alternative','installation hardware or included parts','single-user or single-device setup','multi-user or multi-device expectations','weather or environment caveat',",
    "  'quality control concern','simple satisfaction','balanced pros and cons','surprise benefit','not for every situation',",
    "  'failed expectation','partial success','ease after setup','storage between uses','small defect tolerated',",
    "  'small defect not tolerated','repeat purchase or second location','practical tip','customer mistake corrected','plain negative review',",
    "  'plain positive review','overall recommendation','buyer-specific constraint','ordinary convenience','caveated recommendation',",
    "  'reason for rating','unmet use case','works as expected','better than expected','worse than expected'",
    "];",
    "export function fallbackProductThemes(reviewCount){",
    "  const count=requestedThemeCount(reviewCount);",
    "  return Array.from({length:count},(_,index)=>{",
    "    const base=FALLBACK_THEME_FOCI[index%FALLBACK_THEME_FOCI.length],suffix=index>=FALLBACK_THEME_FOCI.length?' '+(Math.floor(index/FALLBACK_THEME_FOCI.length)+1):'';",
    "    const focus=base+suffix;",
    "    return{",
    "      id:'THEME-'+String(index+1).padStart(2,'0'),focus,",
    "      scenarioVariants:[",
    "        'customer explains '+focus+' with one concrete context detail',",
    "        'customer describes a practical tradeoff around '+focus,",
    "        'customer compares expectations to the result for '+focus,",
    "        'customer gives a rating-appropriate verdict centered on '+focus,",
    "      ],",
    "      evidenceBoundary:'Keep claims within authoritative product facts and verified reference plausibility. Do not let one obvious setup step, troubleshooting action, headline feature, or marketing phrase dominate the corpus unless this theme explicitly makes it central.',",
    "      allowedRatings:[1,2,3,4,5],",
    "    };",
    "  });",
    "}"
  ].join('\n');
  text = text.replace(anchor, fallback);
  changed = true;
  }
  const oldRoleCap = 'const sourceRewriteCap=Math.max(3,Math.min(Number(caps.storyFamilySoftCap)||5,Math.ceil(items.length*.08),8));';
  const newRoleCap = 'const datasetSize=items.length;\n  const sourceRewriteCap=datasetSize>=100?1:datasetSize>=50?2:Math.max(3,Math.min(Number(caps.storyFamilySoftCap)||5,Math.ceil(datasetSize*.08),8));';
  if (text.includes(oldRoleCap)) {
    text = text.replace(oldRoleCap, newRoleCap);
    changed = true;
  }
  return changed ? writeIfChanged(path, text) : false;
}

function patchPlanner() {
  const path = 'app/api/generation-plan/route.js';
  let text = fs.readFileSync(path, 'utf8');
  text = text.replace("import{createBlueprintPlan,requestedThemeCount,solveNaturalRatingDistribution,sourceListingKey}from'../../../lib/review-blueprint.mjs';", "import{createBlueprintPlan,fallbackProductThemes,requestedThemeCount,solveNaturalRatingDistribution,sourceListingKey}from'../../../lib/review-blueprint.mjs';");
  text = text.replace("import{createBlueprintPlan,requestedThemeCount,solveNaturalRatingDistribution}from'../../../lib/review-blueprint.mjs';", "import{createBlueprintPlan,fallbackProductThemes,requestedThemeCount,solveNaturalRatingDistribution}from'../../../lib/review-blueprint.mjs';");
  if (!text.includes('plannerFallbackReason')) {
    const sourceLine = "const planned=await gateway(req,prompt,75000),now=Date.now(),plan=createBlueprintPlan({productTitle,productDescription,reviewCount,targetAverage,themes:parseObject(planned.text)?.themes,references:enrichedReferences,now,nonce:`${now}`});";
    assertIncludes(text, sourceLine, `${path}: planner call`);
    const plannerBlock = [
      'let planned=null,themes=null,plannerProvider=null,plannerModel=MODEL,plannerFallbackReason=null;',
      '    try{',
      '      planned=await gateway(req,prompt,75000);',
      '      plannerProvider=planned.provider;',
      '      themes=parseObject(planned.text)?.themes;',
      '    }catch(error){',
      "      plannerProvider='local';",
      "      plannerModel='deterministic-high-breadth-fallback';",
      "      plannerFallbackReason=clean(error?.message||'planner failed',300);",
      '      themes=fallbackProductThemes(reviewCount);',
      '    }',
      '    const now=Date.now();',
      '    let plan;',
      '    try{',
      '      plan=createBlueprintPlan({productTitle,productDescription,reviewCount,targetAverage,themes,references:enrichedReferences,now,nonce:`${now}`});',
      '    }catch(error){',
      "      if(plannerProvider==='local')throw error;",
      "      plannerProvider='local';",
      "      plannerModel='deterministic-high-breadth-fallback';",
      "      plannerFallbackReason=clean(error?.message||'planner output unusable',300);",
      '      themes=fallbackProductThemes(reviewCount);',
      '      plan=createBlueprintPlan({productTitle,productDescription,reviewCount,targetAverage,themes,references:enrichedReferences,now,nonce:`${now}|fallback`});',
      '    }',
    ].join('\n');
    text = text.replace(sourceLine, plannerBlock);
    text = text.replace('plannerModel:MODEL,plannerProvider:planned.provider,', 'plannerModel,plannerProvider,plannerFallbackReason,');
  }
  return writeIfChanged(path, text);
}

function patchGenerator() {
  const path = 'app/api/generate/route.js';
  let text = fs.readFileSync(path, 'utf8');
  let changed = false;
  const titleRule = '- Titles and first-six-word openings must be unique within this batch. Avoid stock titles and conclusions.';
  if (!text.includes('central-story contract')) {
    assertIncludes(text, titleRule, `${path}: title rule`);
    const replacement = [
      titleRule,
      "- The corpus_blueprint focus and scenario are the central-story contract for that fixture. Do not substitute the product category's easiest story if the assigned blueprint points somewhere else.",
      "- Treat obvious setup steps, first-use mechanics, troubleshooting actions, adjustments, scans, pairing, charging, cleaning, fitting, or other category-default actions as background facts unless the corpus_blueprint explicitly makes that action the fixture's focus.",
      '- Do not solve most positive reviews with the same structure: initial problem, adjustment, then success. Vary the evidence type across purchase reason, first impression, ordinary routine, value, compatibility, household context, appearance, logistics, support, upkeep, limitations, and recommendation-with-caveat.',
    ].join('\n');
    text = text.split(titleRule).join(replacement);
    changed = true;
  }
  const oldSupportedSeed = "sourceReviewFingerprint:{...fingerprint,title:compactText(item.reference.sourceTitle,160),rating:sourceRating,experienceSeed:compactText(item.reference.sourceBody,360)},";
  const newSupportedSeed = "sourceReviewFingerprint:{...fingerprint,title:compactText(item.reference.sourceTitle,140),rating:sourceRating,experienceSeed:compactText(item.reference.sourceBody,220)},";
  if (text.includes(oldSupportedSeed)) {
    text = text.replace(oldSupportedSeed, newSupportedSeed);
    changed = true;
  }
  const oldCompactReference = "function compactReference(x){return x?.reference?{referenceId:x.reference.referenceId,platform:x.reference.platform,provider:x.reference.provider,sourceRating:x.reference.sourceRating,title:compactText(x.reference.sourceTitle,180),body:compactText(x.reference.sourceBody,900),fingerprint:x.referenceFingerprint||x.reference.referenceFingerprint||null,wordCount:x.reference.wordCount,sentenceCount:x.reference.sentenceCount}:null}";
  const newCompactReference = "function compactReference(x){if(!x?.reference)return null;const blueprintLed=x.referenceRole==='reference_supported_blueprint';return{referenceId:x.reference.referenceId,platform:x.reference.platform,provider:x.reference.provider,sourceRating:x.reference.sourceRating,title:compactText(x.reference.sourceTitle,blueprintLed?120:180),body:compactText(x.reference.sourceBody,blueprintLed?220:900),fingerprint:x.referenceFingerprint||x.reference.referenceFingerprint||null,wordCount:x.reference.wordCount,sentenceCount:x.reference.sentenceCount,sourceUse:blueprintLed?'support_only':'central_fingerprint'}}";
  if (text.includes(oldCompactReference)) {
    text = text.replace(oldCompactReference, newCompactReference);
    changed = true;
  }
  const referenceRulesAnchor = 'REFERENCE-LED RULES:\n- If rewrite_strategy.mode is source_fingerprint_rewrite, source_review_fingerprint is the primary uniqueness engine.';
  const referenceRulesReplacement = 'REFERENCE-LED RULES:\n- Every reference-led fixture must still obey its corpus_blueprint as the central-story contract unless rewrite_strategy explicitly says the source fingerprint is central. The reference proves plausible sentiment and texture; it is not permission to repeat the same category-default story across the corpus.\n- If rewrite_strategy.mode is source_fingerprint_rewrite, source_review_fingerprint is the primary uniqueness engine.';
  if (text.includes(referenceRulesAnchor) && !text.includes('The reference proves plausible sentiment and texture')) {
    text = text.replace(referenceRulesAnchor, referenceRulesReplacement);
    changed = true;
  }
  const tropeRule = '- Do not normalize reference-led rows into the same product-level trope. The fingerprint lane decides what the review is about; the product category must not collapse every row into one common feature, failure mode, or use case.';
  const tropeReplacement = [
    tropeRule,
    '- In a 10-row batch, no more than two reviews may make the same category-default action, setup step, troubleshooting move, or obvious headline benefit the main story. If more assignments point there, demote that action to a background clause and center the blueprint/persona instead.',
    '- For reference_supported_blueprint rows, carry forward at most one broad source-compatible detail. Do not carry forward source chronology, setup sequence, or topic center unless the blueprint explicitly asks for it.',
  ].join('\n');
  if (text.includes(tropeRule) && !text.includes('no more than two reviews may make the same category-default action')) {
    text = text.replace(tropeRule, tropeReplacement);
    changed = true;
  }
  return changed ? writeIfChanged(path, text) : false;
}

const changed = [patchBlueprint(), patchPlanner(), patchGenerator()].some(Boolean);
console.log(`${changed ? 'Applied' : 'Skipped'} dataset story lane budget patch.`);

for (const target of ['lib/review-blueprint.mjs','app/api/generation-plan/route.js','app/api/generate/route.js']) {
  const result = spawnSync('node', ['--check', target], {stdio:'inherit', encoding:'utf8'});
  if (result.status !== 0) process.exit(result.status || 1);
}
const smoke = spawnSync('node', ['--input-type=module', '-e', "import{fallbackProductThemes,requestedThemeCount}from'./lib/review-blueprint.mjs';const xs=fallbackProductThemes(200);if(xs.length!==requestedThemeCount(200)||new Set(xs.map(x=>x.focus)).size!==xs.length)process.exit(1);"], {stdio:'inherit', encoding:'utf8'});
if (smoke.status !== 0) process.exit(smoke.status || 1);
