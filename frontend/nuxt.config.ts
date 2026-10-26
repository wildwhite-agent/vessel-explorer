export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['@1001-digital/layers.evm'],
  ssr: false,
  typescript: { tsConfig: { compilerOptions: { allowImportingTsExtensions: true } } },
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  devServer: {
    host: '127.0.0.1',
    port: 3001,
  },

  nitro: {
    preset: process.env.NITRO_PRESET || 'vercel',
  },

  app: {
    head: {
      title: 'vessel explorer',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
        { name: 'description', content: 'explore THE_VESSEL on-chain storage protocol on ethereum' },
        { name: 'theme-color', content: '#000000' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  css: ['~/assets/css/main.pcss'],

  postcss: {
    plugins: {
      'postcss-nesting': {},
    },
  },

  runtimeConfig: {
    indexerUrl: '',
    public: {
      artworkOrigin: '',
      machineRpcUrl: '',
      evm: {
        walletConnectProjectId: '',
        chains: {
          mainnet: {
            rpcs: process.env.NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPCS
              || process.env.NUXT_PUBLIC_MACHINE_RPC_URL
              || 'https://ethereum-rpc.publicnode.com',
          },
        },
        ens: {
          indexers: '',
        },
      },
    },
  },
})
