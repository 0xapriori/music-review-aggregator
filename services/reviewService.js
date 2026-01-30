const axios = require('axios');
const cheerio = require('cheerio');
const demoReviews = require('../data/demoReviews');

class ReviewService {
  constructor() {
    this.fantanoCache = new Map();
    this.scaruffiCache = new Map();
  }

  async getFantanoReviews({ artist, album, limit = 50 }) {
    try {
      const cacheKey = `${artist || ''}_${album || ''}_${limit}`;
      if (this.fantanoCache.has(cacheKey)) {
        return this.fantanoCache.get(cacheKey);
      }

      let reviews = demoReviews.fantano;
      
      if (artist) {
        reviews = reviews.filter(review => 
          review.artist.toLowerCase().includes(artist.toLowerCase())
        );
      }
      
      if (album) {
        reviews = reviews.filter(review => 
          review.album.toLowerCase().includes(album.toLowerCase())
        );
      }
      
      reviews = reviews.slice(0, limit);
      this.fantanoCache.set(cacheKey, reviews);
      return reviews;
    } catch (error) {
      console.error('Error fetching Fantano reviews:', error);
      return [];
    }
  }

  async getScaruffiReviews({ artist, album, limit = 50 }) {
    try {
      const cacheKey = `${artist || ''}_${album || ''}_${limit}`;
      if (this.scaruffiCache.has(cacheKey)) {
        return this.scaruffiCache.get(cacheKey);
      }

      let reviews = demoReviews.scaruffi;
      
      if (artist) {
        reviews = reviews.filter(review => 
          review.artist.toLowerCase().includes(artist.toLowerCase())
        );
      }
      
      if (album) {
        reviews = reviews.filter(review => 
          review.album.toLowerCase().includes(album.toLowerCase())
        );
      }
      
      reviews = reviews.slice(0, limit);
      this.scaruffiCache.set(cacheKey, reviews);
      return reviews;
    } catch (error) {
      console.error('Error fetching Scaruffi reviews:', error);
      return [];
    }
  }

  async getAggregatedReviews({ artist, album, limit = 100 }) {
    try {
      const [fantanoReviews, scaruffiReviews] = await Promise.all([
        this.getFantanoReviews({ artist, album, limit: limit / 2 }),
        this.getScaruffiReviews({ artist, album, limit: limit / 2 })
      ]);

      return this.mergeAndAnalyzeReviews(fantanoReviews, scaruffiReviews);
    } catch (error) {
      console.error('Error fetching aggregated reviews:', error);
      return [];
    }
  }

  async scrapeFantanoYouTube({ artist, album, limit }) {
    const searchQuery = this.buildSearchQuery(artist, album, 'fantano review');
    const videos = await this.searchYouTubeVideos(searchQuery, limit);
    
    const reviews = [];
    for (const video of videos) {
      try {
        const transcript = await this.getVideoTranscript(video.videoId);
        const analysis = this.analyzeFantanoTranscript(transcript, video);
        if (analysis) {
          reviews.push(analysis);
        }
      } catch (error) {
        console.log(`Could not process video ${video.videoId}:`, error.message);
      }
    }
    
    return reviews;
  }

  async scrapeScaruffiWebsite({ artist, album, limit }) {
    try {
      if (artist) {
        return await this.scrapeScaruffiByArtist(artist, album, limit);
      } else {
        return await this.scrapeScaruffiGeneral(limit);
      }
    } catch (error) {
      console.error('Error scraping Scaruffi website:', error);
      return [];
    }
  }

  async scrapeScaruffiByArtist(artist, album, limit) {
    const searchUrls = this.buildScaruffiSearchUrls(artist);
    const reviews = [];
    
    for (const url of searchUrls) {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReviewAggregator/1.0)' }
        });
        
        const $ = cheerio.load(response.data);
        const extractedReviews = this.extractScaruffiReviews($, artist, album);
        reviews.push(...extractedReviews);
        
        if (reviews.length >= limit) break;
      } catch (error) {
        console.log(`Could not scrape ${url}:`, error.message);
      }
    }
    
    return reviews.slice(0, limit);
  }

  async scrapeScaruffiGeneral(limit) {
    const baseUrl = 'https://www.scaruffi.com/ratings/index.html';
    try {
      const response = await axios.get(baseUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReviewAggregator/1.0)' }
      });
      
      const $ = cheerio.load(response.data);
      return this.extractScaruffiRatings($, limit);
    } catch (error) {
      console.error('Error scraping Scaruffi ratings:', error);
      return [];
    }
  }

  buildScaruffiSearchUrls(artist) {
    const baseUrl = 'https://www.scaruffi.com';
    const artistSlug = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    return [
      `${baseUrl}/vol1/${artistSlug[0]}/${artistSlug}.html`,
      `${baseUrl}/vol2/${artistSlug[0]}/${artistSlug}.html`,
      `${baseUrl}/vol3/${artistSlug[0]}/${artistSlug}.html`,
      `${baseUrl}/vol4/${artistSlug[0]}/${artistSlug}.html`,
      `${baseUrl}/vol5/${artistSlug[0]}/${artistSlug}.html`
    ];
  }

  extractScaruffiReviews($, targetArtist, targetAlbum) {
    const reviews = [];
    
    $('p, div').each((i, elem) => {
      const text = $(elem).text();
      if (this.containsAlbumInfo(text, targetArtist, targetAlbum)) {
        const review = this.parseScaruffiReview(text, $(elem));
        if (review) {
          reviews.push(review);
        }
      }
    });
    
    return reviews;
  }

  extractScaruffiRatings($, limit) {
    const reviews = [];
    
    $('table tr, p').each((i, elem) => {
      const text = $(elem).text();
      const review = this.parseScaruffiRatingText(text);
      if (review) {
        reviews.push(review);
      }
    });
    
    return reviews.slice(0, limit);
  }

  parseScaruffiReview(text, element) {
    const scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    const albumMatch = text.match(/([A-Za-z0-9\s\-&']+):\s*([A-Za-z0-9\s\-&'\.]+)\s*\((\d{4})\)/);
    
    if (albumMatch) {
      return {
        artist: albumMatch[1].trim(),
        album: albumMatch[2].trim(),
        year: parseInt(albumMatch[3]),
        scaruffi_score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
        scaruffi_summary: this.extractScaruffiSummary(text),
        source: 'scaruffi',
        source_url: 'https://www.scaruffi.com'
      };
    }
    
    return null;
  }

  parseScaruffiRatingText(text) {
    const patterns = [
      /(.+?)\s*:\s*(.+?)\s*\((\d{4})\)\s*[\-\s]*(\d+(?:\.\d+)?)/,
      /(.+?)\s*-\s*(.+?)\s*\((\d{4})\)\s*[\-\s]*(\d+(?:\.\d+)?)/
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          artist: match[1].trim(),
          album: match[2].trim(),
          year: parseInt(match[3]),
          scaruffi_score: parseFloat(match[4]),
          scaruffi_summary: null,
          source: 'scaruffi',
          source_url: 'https://www.scaruffi.com'
        };
      }
    }
    
    return null;
  }

  extractScaruffiSummary(text) {
    const sentences = text.split(/[.!?]+/);
    const relevantSentences = sentences.filter(s => 
      s.length > 20 && 
      !s.match(/^\s*\d+/) &&
      (s.includes('album') || s.includes('music') || s.includes('sound'))
    );
    
    return relevantSentences.slice(0, 2).join('. ').trim();
  }

  async searchYouTubeVideos(query, limit) {
    return [];
  }

  async getVideoTranscript(videoId) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      return transcript.map(item => item.text).join(' ');
    } catch (error) {
      throw new Error(`Could not fetch transcript: ${error.message}`);
    }
  }

  analyzeFantanoTranscript(transcript, video) {
    const scoreMatch = transcript.match(/(?:give this|rating|score).*?(\d+)(?:\/10|\..*?out of 10)/i);
    const albumMatch = video.title.match(/(.+?)\s*-\s*(.+?)\s*(?:ALBUM|EP|LP|REVIEW)/i);
    
    if (albumMatch) {
      return {
        artist: albumMatch[1].trim(),
        album: albumMatch[2].trim(),
        fantano_score: scoreMatch ? parseInt(scoreMatch[1]) : null,
        fantano_summary: this.summarizeTranscript(transcript),
        source: 'fantano',
        source_url: `https://youtube.com/watch?v=${video.videoId}`,
        year: this.extractYearFromTitle(video.title)
      };
    }
    
    return null;
  }

  summarizeTranscript(transcript) {
    const sentences = transcript.split(/[.!?]+/);
    const keyPhrases = sentences.filter(s => 
      s.length > 30 &&
      (s.includes('album') || s.includes('track') || s.includes('sound') || 
       s.includes('production') || s.includes('lyrics'))
    );
    
    return keyPhrases.slice(0, 3).join('. ').trim();
  }

  extractYearFromTitle(title) {
    const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
    return yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
  }

  buildSearchQuery(artist, album, additional = '') {
    const parts = [artist, album, additional].filter(Boolean);
    return parts.join(' ').trim();
  }

  containsAlbumInfo(text, targetArtist, targetAlbum) {
    if (targetArtist && !text.toLowerCase().includes(targetArtist.toLowerCase())) {
      return false;
    }
    if (targetAlbum && !text.toLowerCase().includes(targetAlbum.toLowerCase())) {
      return false;
    }
    return text.includes(':') && (text.includes('(') || text.includes('19') || text.includes('20'));
  }

  mergeAndAnalyzeReviews(fantanoReviews, scaruffiReviews) {
    const merged = [];
    const artistAlbumMap = new Map();
    
    for (const review of fantanoReviews) {
      const key = `${review.artist}_${review.album}`.toLowerCase();
      const mergedReview = { ...review };
      artistAlbumMap.set(key, mergedReview);
      merged.push(mergedReview);
    }
    
    for (const review of scaruffiReviews) {
      const key = `${review.artist}_${review.album}`.toLowerCase();
      if (artistAlbumMap.has(key)) {
        const existing = artistAlbumMap.get(key);
        Object.assign(existing, {
          scaruffi_score: review.scaruffi_score,
          scaruffi_summary: review.scaruffi_summary,
          overlap: true
        });
      } else {
        merged.push({ ...review });
      }
    }
    
    return merged.sort((a, b) => {
      if (a.overlap && !b.overlap) return -1;
      if (!a.overlap && b.overlap) return 1;
      return (b.year || 0) - (a.year || 0);
    });
  }
}

const reviewService = new ReviewService();

module.exports = {
  getFantanoReviews: (params) => reviewService.getFantanoReviews(params),
  getScaruffiReviews: (params) => reviewService.getScaruffiReviews(params),
  getAggregatedReviews: (params) => reviewService.getAggregatedReviews(params)
};