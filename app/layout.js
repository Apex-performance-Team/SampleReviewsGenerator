import './globals.css';
import ReferenceBridge from './reference-bridge';
export const metadata={title:'Synthetic Review Lab',description:'Synthetic review fixtures for QA and modeling'};
export default function Layout({children}){return <html lang="en"><body><ReferenceBridge/>{children}</body></html>}
