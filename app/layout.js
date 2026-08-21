import './globals.css';
import ReferenceBridge from './reference-bridge';
import ReviewCorpusExport from './review-corpus-export';
export const metadata={title:'Synthetic Review Lab',description:'Synthetic review fixtures for QA and modeling'};
export default function Layout({children}){return <html lang="en"><body><ReferenceBridge/><ReviewCorpusExport/>{children}</body></html>}
