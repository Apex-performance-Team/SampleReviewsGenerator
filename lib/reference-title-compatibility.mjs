const clean=value=>String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

const TITLE_MODES={
  outdoor:/\b(outdoor|outdoors|exterior|rooftop|roof|mast|weather[- ]?resistant|weatherproof)\b/i,
  indoor:/\b(indoor|indoors|interior|window|room|desktop|countertop)\b/i,
  omni:/\b(omni(?:reach|directional)?|360(?:\s*degree|°)?)\b/i,
  directional:/\b(directional|yagi|rotating|motorized)\b/i,
};

const REVIEW_SIGNALS={
  outdoor:[
    ['roof_or_mast',/\b(on|onto|from|to) (?:the |my |our )?(?:roof|rooftop|mast)\b|\broof[- ]mounted\b/i,2],
    ['exterior_mount',/\b(?:mounted|installed|placed|set up) (?:it )?(?:outside|outdoors|on (?:an? |the |my |our )?exterior wall)\b/i,2],
    ['weather_exposure',/\b(?:rain|snow|wind|weather|waterproof|weather[- ]?resistant)\b/i,1],
    ['ladder_or_attic',/\b(?:ladder|attic|eave|chimney)\b/i,1],
  ],
  indoor:[
    ['adhesive_window_mount',/\b(?:double[- ]sided tape|tape(?:d|ing)? (?:it )?(?:to|on) (?:the |my |our )?(?:window|wall)|tape residue.{0,40}\bwindow)\b/i,3],
    ['behind_tv',/\b(?:behind|beside|next to) (?:the |my |our )?tv\b/i,2],
    ['indoor_stand',/\b(?:stand|standing|set|placed|mounted|installed|used) (?:it )?(?:indoors|inside|in (?:the |my |our )?(?:living room|bedroom|apartment|room))\b/i,2],
    ['window_position',/\b(?:in|on|against|between|near|by) (?:the |my |our )?window\b|\bwindow and (?:the )?screen\b/i,2],
    ['flat_indoor_form',/\b(?:flat (?:plate|panel|wall[- ]mount|antenna)|small,? flat|thin and flimsy|paper[- ]thin)\b/i,2],
    ['interior_location',/\b(?:indoor|indoors|inside|apartment|living room|bedroom|bookcase|mantle)\b/i,1],
  ],
};

function modeFrom(value){
  const text=clean(value);
  const outdoor=TITLE_MODES.outdoor.test(text),indoor=TITLE_MODES.indoor.test(text),omni=TITLE_MODES.omni.test(text),directional=TITLE_MODES.directional.test(text)&&!omni;
  return{outdoor,indoor,omni,directional};
}

function signalSummary(text,definitions){
  const signals=[];let score=0;
  for(const[name,pattern,weight]of definitions)if(pattern.test(text)){signals.push(name);score+=weight}
  return{score,signals};
}

function reviewProductTitle(review){
  return clean(review?.sourceReviewProductTitle||review?.sourceProductTitle||review?.reviewProductTitle||review?.productTitle||review?.variantTitle||review?.sourceVariantTitle||'');
}

function reviewText(review){
  return clean([review?.sourceTitle,review?.title,review?.sourceBody,review?.body].filter(Boolean).join(' '));
}

export function assessReferenceTitleCompatibility(productTitle,review={}){
  const authoritativeTitle=clean(productTitle),target=modeFrom(authoritativeTitle);
  if(!authoritativeTitle)return{accepted:true,reason:'missing_shopify_product_title',productMode:target,reviewMode:modeFrom(''),indoorSignals:[],outdoorSignals:[]};
  const sourceProductTitle=reviewProductTitle(review),sourceMode=modeFrom(sourceProductTitle),text=reviewText(review),indoor=signalSummary(text,REVIEW_SIGNALS.indoor),outdoor=signalSummary(text,REVIEW_SIGNALS.outdoor);
  let reason='compatible_or_unresolved';
  if(target.outdoor&&!target.indoor){
    if(sourceProductTitle&&sourceMode.indoor&&!sourceMode.outdoor)reason='source_product_title_conflicts_with_outdoor_shopify_title';
    else if(indoor.score>=2&&outdoor.score===0)reason='review_context_conflicts_with_outdoor_shopify_title';
  }else if(target.indoor&&!target.outdoor){
    if(sourceProductTitle&&sourceMode.outdoor&&!sourceMode.indoor)reason='source_product_title_conflicts_with_indoor_shopify_title';
    else if(outdoor.score>=2&&indoor.score===0)reason='review_context_conflicts_with_indoor_shopify_title';
  }
  if(reason==='compatible_or_unresolved'&&target.omni){
    if(sourceProductTitle&&sourceMode.directional)reason='source_product_title_conflicts_with_omni_shopify_title';
    else if(sourceProductTitle&&sourceMode.indoor&&!sourceMode.omni)reason='source_product_title_conflicts_with_omni_shopify_title';
    else if(indoor.score>=2&&outdoor.score===0)reason='review_context_conflicts_with_omni_shopify_title';
  }
  return{accepted:reason==='compatible_or_unresolved',reason,productMode:target,reviewMode:sourceMode,sourceProductTitle:sourceProductTitle||null,indoorScore:indoor.score,outdoorScore:outdoor.score,indoorSignals:indoor.signals,outdoorSignals:outdoor.signals};
}

export function filterReferencesByProductTitle(productTitle,references=[]){
  const accepted=[],rejected=[],reasonCounts={};
  for(const reference of Array.isArray(references)?references:[]){
    const assessment=assessReferenceTitleCompatibility(productTitle,reference);
    if(assessment.accepted)accepted.push(reference);
    else{
      rejected.push({reference,assessment});
      reasonCounts[assessment.reason]=(reasonCounts[assessment.reason]||0)+1;
    }
  }
  return{accepted,rejected,diagnostics:{version:'shopify-product-title-v1',productTitle:clean(productTitle),inputCount:accepted.length+rejected.length,acceptedCount:accepted.length,rejectedCount:rejected.length,reasonCounts,rejectedReferenceIds:rejected.map(x=>clean(x.reference?.referenceId||x.reference?.sourceReviewId||x.reference?.reviewId)).filter(Boolean).slice(0,50)}};
}
