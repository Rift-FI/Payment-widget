import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { base, polygon, arbitrum, mainnet, celo } from '@reown/appkit/networks'

// Reown Project ID - from cloud.reown.com
const projectId = '99d90105116696e9de1d61526b0e0da0'

// Create a metadata object - must match current origin for local development
const metadata = {
  name: 'Rift Finance Payment Widget',
  description: 'Secure cryptocurrency payment widget by Rift Finance',
  url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

const networks: [typeof base, typeof polygon, typeof arbitrum, typeof mainnet, typeof celo] = [base, polygon, arbitrum, mainnet, celo]

// Create Wagmi Adapter
const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false,
})

// Create the AppKit instance
export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: base,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: [],
    emailShowWallets: false,
    onramp: false,
    swaps: false,
  },
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#2E8C96',
    '--w3m-color-mix': '#2E8C96',
    '--w3m-color-mix-strength': 50,
    '--w3m-border-radius-master': '12px',
  }
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
