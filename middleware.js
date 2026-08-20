import { NextResponse } from 'next/server';

export function middleware(request){
  const url=request.nextUrl.clone();
  if(url.pathname==='/api/reference-scan'){
    url.pathname='/api/reference-scan-lens';
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config={matcher:['/api/reference-scan']};
