import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { polygon } from '@reown/appkit/networks'

// Reown Project ID - from cloud.reown.com
const projectId = '99d90105116696e9de1d61526b0e0da0'

// Create a metadata object - must match current origin for local development
const metadata = {
  name: 'Rift Finance Payment Widget',
  description: 'Secure cryptocurrency payment widget by Rift Finance',
  url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

// Create Wagmi Adapter with custom RPC
const wagmiAdapter = new WagmiAdapter({
  networks: [polygon],
  projectId,
  ssr: false,
})

// Create the AppKit instance
export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [polygon],
  defaultNetwork: polygon,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: [],
    emailShowWallets: false,
    onramp: false, // Disable onramp to reduce API calls
    swaps: false, // Disable swaps to reduce API calls
  },
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#8B5CF6', // Rift Finance purple
    '--w3m-border-radius-master': '12px',
  }
})

export const wagmiConfig = wagmiAdapter.wagmiConfig