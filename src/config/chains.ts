import { base, polygon, arbitrum, mainnet, celo } from 'viem/chains'
import type { Chain } from 'viem'

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
  name: string;
}

export interface ChainConfig {
  id: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    default: {
      http: string[];
    };
  };
  blockExplorers: {
    default: {
      name: string;
      url: string;
    };
  };
  tokens: Record<string, TokenConfig>;
}

// ── Token addresses (Circle native USDC + Tether USDT) ──────────────────────

const TOKENS = {
  BASE_USDC: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, name: 'USD Coin' },
  BASE_USDT: { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, name: 'Tether USD' },

  POLYGON_USDC: { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, name: 'USD Coin' },
  POLYGON_USDT: { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, name: 'Tether USD' },

  ARBITRUM_USDC: { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, name: 'USD Coin' },
  ARBITRUM_USDT: { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, name: 'Tether USD' },

  ETHEREUM_USDC: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, name: 'USD Coin' },
  ETHEREUM_USDT: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, name: 'Tether USD' },

  CELO_USDC: { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6, name: 'USD Coin' },
  CELO_USDT: { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6, name: 'Tether USD' },
} as const satisfies Record<string, TokenConfig>;

// ── Chain configs ────────────────────────────────────────────────────────────

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  BASE: {
    id: 8453,
    name: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet.base.org/'] } },
    blockExplorers: { default: { name: 'BaseScan', url: 'https://basescan.org' } },
    tokens: { USDC: TOKENS.BASE_USDC, USDT: TOKENS.BASE_USDT },
  },
  POLYGON: {
    id: 137,
    name: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: { default: { http: ['https://polygon-rpc.com/'] } },
    blockExplorers: { default: { name: 'PolygonScan', url: 'https://polygonscan.com' } },
    tokens: { USDC: TOKENS.POLYGON_USDC, USDT: TOKENS.POLYGON_USDT },
  },
  ARBITRUM: {
    id: 42161,
    name: 'Arbitrum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } },
    blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
    tokens: { USDC: TOKENS.ARBITRUM_USDC, USDT: TOKENS.ARBITRUM_USDT },
  },
  ETHEREUM: {
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://eth.llamarpc.com'] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
    tokens: { USDC: TOKENS.ETHEREUM_USDC, USDT: TOKENS.ETHEREUM_USDT },
  },
  CELO: {
    id: 42220,
    name: 'Celo',
    nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
    rpcUrls: { default: { http: ['https://forno.celo.org'] } },
    blockExplorers: { default: { name: 'CeloScan', url: 'https://celoscan.io' } },
    tokens: { USDC: TOKENS.CELO_USDC, USDT: TOKENS.CELO_USDT },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getChainConfig(chainName: string): ChainConfig | null {
  return CHAIN_CONFIGS[chainName.toUpperCase()] || null;
}

export function getTokenConfig(chainName: string, tokenSymbol: string): TokenConfig | null {
  const chainConfig = getChainConfig(chainName);
  if (!chainConfig) return null;
  return chainConfig.tokens[tokenSymbol.toUpperCase()] || null;
}

export function getAvailableTokens(chainName: string): TokenConfig[] {
  const chainConfig = getChainConfig(chainName);
  if (!chainConfig) return [];
  return Object.values(chainConfig.tokens);
}

export function isNativeToken(chainName: string, tokenSymbol: string): boolean {
  const chainConfig = getChainConfig(chainName);
  if (!chainConfig) return false;
  return chainConfig.nativeCurrency.symbol.toUpperCase() === tokenSymbol.toUpperCase();
}

// Wagmi chain objects for wallet connection
export const supportedChains: readonly [Chain, ...Chain[]] = [base, polygon, arbitrum, mainnet, celo];

// UI list for chain selection
export const AVAILABLE_CHAINS = [
  { key: 'BASE', name: 'Base', icon: '🔵', recommended: true },
  { key: 'POLYGON', name: 'Polygon', icon: '🟣', recommended: false },
  { key: 'ARBITRUM', name: 'Arbitrum', icon: '🔷', recommended: false },
  { key: 'ETHEREUM', name: 'Ethereum', icon: '⟠', recommended: false },
  { key: 'CELO', name: 'Celo', icon: '🟡', recommended: false },
] as const;
