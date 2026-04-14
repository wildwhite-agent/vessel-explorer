export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['@1001-digital/layers.evm'],
  ssr: false,
  devtools: { enabled: true },
  devServer: {
    host: '127.0.0.1',
    port: 3001,
  },

  nitro: {
    preset: 'vercel',
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
    // Server-only (not shipped to browser)
    etherscanKey: '',
    public: {
      evm: {

        chains: {
          mainnet: { rpc1: '', rpc2: '', rpc3: '' },
        },
      },
    },
  },
})
