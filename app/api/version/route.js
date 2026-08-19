export const runtime='nodejs';

export async function GET(){
  return Response.json({
    source:'github-auto',
    repository:'Apex-performance-Team/SampleReviewsGenerator',
    commit:process.env.VERCEL_GIT_COMMIT_SHA||null,
    branch:process.env.VERCEL_GIT_COMMIT_REF||null,
    environment:process.env.VERCEL_ENV||null,
    deployedAt:new Date().toISOString()
  },{headers:{'cache-control':'no-store'}})
}
