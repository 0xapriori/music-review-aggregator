// API Configuration
const config = {
  development: {
    apiBaseUrl: 'http://localhost:3001'
  },
  production: {
    apiBaseUrl: 'https://music-review-aggregator-production.up.railway.app'
  }
};

const environment = process.env.NODE_ENV || 'development';

export const API_BASE_URL = config[environment].apiBaseUrl;
export const API_ENDPOINTS = {
  all: '/api/reviews/all',
  fantano: '/api/reviews/fantano',
  scaruffi: '/api/reviews/scaruffi',
  overlap: '/api/reviews/overlap',
  searchAdvanced: '/api/reviews/search/advanced',
  searchArtist: '/api/reviews/search/artist',
  stats: '/api/reviews/stats',
  health: '/api/reviews/health'
};

export default config;