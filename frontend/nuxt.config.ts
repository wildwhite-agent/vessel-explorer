export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['@1001-digital/layers.evm'],
  ssr: false,
  devtools: { enabled: true },

  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
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
    // Server-only (not shipped to browser)
    etherscanKey: '',
    public: {
      evm: {
        walletConnectProjectId: '',
        chains: {
          mainnet: { rpc1: '', rpc2: '', rpc3: '' },
        },
      },
    },
  },
})
