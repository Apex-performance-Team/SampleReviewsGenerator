export const runtime='nodejs';

import{hasRunAccess,lockRunAccess,runAccessDenied,runAccessHeaders,unlockRunAccess}from'../../../../lib/review-run-auth.mjs';

export async function GET(req){
  const denied=runAccessDenied(req);
  if(denied)return denied;
  return Response.json({ok:true,locked:!hasRunAccess(req)},{headers:runAccessHeaders()});
}
export async function POST(req){return unlockRunAccess(req)}
export async function DELETE(){return lockRunAccess()}
