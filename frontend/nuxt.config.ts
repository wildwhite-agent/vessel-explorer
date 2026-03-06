export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['@1001-digital/layers.evm'],
  ssr: false,
  devtools: { enabled: true },

  css: ['~/assets/css/main.pcss'],

  postcss: {
    plugins: {
      'postcss-nesting': {},
    },
  },

  runtimeConfig: {
    public: {
      etherscanKey: '',
      evm: {
        walletConnectProjectId: '',
        chains: {
          mainnet: { rpc1: '', rpc2: '', rpc3: '' },
        },
      },
    },
  },
})
