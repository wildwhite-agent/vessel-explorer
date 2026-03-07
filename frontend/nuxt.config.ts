export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['@1001-digital/layers.evm'],
  ssr: false,
  devtools: { enabled: true },

  app: {
    head: {
      title: 'vessel explorer',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
        { name: 'description', content: 'explore THE_VESSEL on-chain storage protocol on ethereum' },
        { property: 'og:title', content: 'vessel explorer' },
        { property: 'og:description', content: 'explore THE_VESSEL on-chain storage protocol on ethereum' },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: 'vessel explorer' },
        { name: 'twitter:description', content: 'explore THE_VESSEL on-chain storage protocol on ethereum' },
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
