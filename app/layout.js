import './globals.css';
import './credit-balance-bar.css';
import MarketplaceEnrichmentBridge from './marketplace-enrichment-bridge';
import ReferenceBridge from './reference-bridge';
import CreditBalanceBar from './credit-balance-bar';
export const metadata={title:'Synthetic Review Lab',description:'Synthetic review fixtures for QA and modeling'};
export default function Layout({children}){return <html lang="en"><body><MarketplaceEnrichmentBridge/><ReferenceBridge/><CreditBalanceBar/>{children}</body></html>}
