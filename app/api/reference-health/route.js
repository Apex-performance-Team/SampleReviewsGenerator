export const runtime='nodejs';
export async function GET(){
  return Response.json({
    ok:true,
    provider:'Google Cloud Vision Web Detection',
    configured:Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY),
    env:'GOOGLE_CLOUD_VISION_API_KEY'
  },{headers:{'cache-control':'no-store'}})
}
