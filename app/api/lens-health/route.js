export const runtime='nodejs';

export async function GET(){
  return Response.json({
    configured:Boolean(process.env.BRIGHT_DATA_API_KEY),
    provider:'bright_data_google_lens',
    zone:process.env.BRIGHT_DATA_SERP_ZONE||'serp_api1',
    keyExposed:false,
    syntheticUseOnly:true
  },{headers:{'cache-control':'no-store'}})
}
