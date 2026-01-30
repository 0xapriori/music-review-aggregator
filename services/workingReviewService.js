const SimplifiedDatabase = require('../database/simplifiedDatabase');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

class WorkingReviewService {
  constructor() {
    this.database = null;
    this.isInitialized = false;
    this.demoData = this.loadDemoData();
  }

  loadDemoData() {
    return {
      fantano: [
        {
          artist: "Kendrick Lamar",
          album: "To Pimp a Butterfly",
          year: 2015,
          score: 10,
          summary: "A masterpiece that explores complex themes of race, identity, and social justice through innovative jazz-influenced production. Every track serves the album's cohesive narrative.",
          source_url: "https://www.youtube.com/watch?v=qTmHuavOXNg"
        },
        {
          artist: "Death Grips",
          album: "The Money Store",
          year: 2012,
          score: 10,
          summary: "Aggressive experimental hip-hop that pushes boundaries with abrasive production and MC Ride's intense vocal delivery. Influential and uncompromising.",
          source_url: "https://www.youtube.com/watch?v=2MHhLDCJ57E"
        },
        {
          artist: "Radiohead",
          album: "Kid A",
          year: 2000,
          score: 9,
          summary: "A bold reinvention that abandons traditional rock structures for electronic experimentation. Paranoid and beautiful exploration of digital alienation.",
          source_url: "https://www.youtube.com/channel/UCt7fwAhXDy3oNFTAzF2o8Pw"
        },
        {
          artist: "Kanye West",
          album: "My Beautiful Dark Twisted Fantasy",
          year: 2010,
          score: 10,
          summary: "A maximalist opus showcasing Kanye's production genius and introspective lyricism. Each track is meticulously crafted with lavish orchestration.",
          source_url: "https://www.youtube.com/watch?v=example4"
        },
        {
          artist: "Swans",
          album: "The Seer",
          year: 2012,
          score: 9,
          summary: "A transcendent journey through experimental rock territories. Gira's commanding vocals guide listeners through dynamic soundscapes.",
          source_url: "https://www.youtube.com/watch?v=example5"
        }
      ],
      
      scaruffi: [
        {
          artist: "Can",
          album: "Tago Mago",
          year: 1971,
          score: 9.5,
          summary: "Groundbreaking krautrock that influenced countless experimental musicians. Hypnotic rhythms and innovative studio techniques create a psychedelic masterpiece.",
          source_url: "https://www.scaruffi.com"
        },
        {
          artist: "Radiohead", 
          album: "Kid A",
          year: 2000,
          score: 8.5,
          summary: "Important transition from traditional rock to electronic music. While influential, the execution lacks the revolutionary impact of earlier experimental works.",
          source_url: "https://www.scaruffi.com"
        },
        {
          artist: "The Velvet Underground",
          album: "White Light/White Heat", 
          year: 1968,
          score: 9,
          summary: "Brutal and uncompromising noise rock that predates punk by nearly a decade. Raw production and feedback create an assault on conventional music.",
          source_url: "https://www.scaruffi.com"
        },
        {
          artist: "Swans",
          album: "The Seer",
          year: 2012,
          score: 8,
          summary: "Monumental achievement in post-rock experimentation. Gira's vision realizes ambitious sonic landscapes with impressive scope.",
          source_url: "https://www.scaruffi.com"
        },
        {
          artist: "Sonic Youth",
          album: "Daydream Nation",
          year: 1988,
          score: 9,
          summary: "Defining moment in alternative rock history. Innovative guitar work and noise experimentation that influenced generations of musicians.",
          source_url: "https://www.scaruffi.com"
        }
      ]
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.database = new SimplifiedDatabase();
      await this.database.initialize();

      // Populate with demo data if database is empty
      await this.populateDemoData();

      logger.info('Working review service initialized');
      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize working review service:', error);
      throw error;
    }
  }

  async populateDemoData() {
    try {
      // Check if we already have data
      const existingReviews = this.database.getReviews({ limit: 1 });
      if (existingReviews.length > 0) {
        logger.debug('Database already has data, skipping demo population');
        return;
      }

      logger.info('Populating database with demo data');

      // Insert Fantano reviews
      for (const review of this.demoData.fantano) {
        this.database.insertReview({
          ...review,
          reviewer: 'fantano',
          full_text: review.summary
        });
      }

      // Insert Scaruffi reviews
      for (const review of this.demoData.scaruffi) {
        this.database.insertReview({
          ...review,
          reviewer: 'scaruffi',
          full_text: review.summary
        });
      }

      logger.info(`Populated database with ${this.demoData.fantano.length + this.demoData.scaruffi.length} demo reviews`);
    } catch (error) {
      logger.error('Error populating demo data:', error);
    }
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async getFantanoReviews({ artist, album, limit = 50, useCache = true } = {}) {
    await this.ensureInitialized();

    try {
      const cacheKey = `fantano_${artist || 'all'}_${album || 'all'}_${limit}`;
      
      if (useCache) {
        const cached = this.database.cacheGet(cacheKey);
        if (cached) {
          logger.debug(`Returning cached Fantano reviews: ${cached.length} results`);
          return cached;
        }
      }

      const reviews = this.database.getReviews({
        artist,
        album,
        reviewer: 'fantano',
        limit
      });

      // Transform database results to API format
      const transformedReviews = reviews.map(review => ({
        artist: review.artist,
        album: review.album,
        year: review.year,
        fantano_score: review.score,
        fantano_summary: review.summary,
        source: 'fantano',
        source_url: review.source_url,
        scraped_at: review.scraped_at
      }));

      // Cache results for 1 hour
      this.database.cacheSet(cacheKey, transformedReviews, 3600);

      logger.info(`Retrieved ${transformedReviews.length} Fantano reviews`);
      return transformedReviews;
    } catch (error) {
      logger.error('Error fetching Fantano reviews:', error);
      throw error;
    }
  }

  async getScaruffiReviews({ artist, album, limit = 50, useCache = true } = {}) {
    await this.ensureInitialized();

    try {
      const cacheKey = `scaruffi_${artist || 'all'}_${album || 'all'}_${limit}`;
      
      if (useCache) {
        const cached = this.database.cacheGet(cacheKey);
        if (cached) {
          logger.debug(`Returning cached Scaruffi reviews: ${cached.length} results`);
          return cached;
        }
      }

      const reviews = this.database.getReviews({
        artist,
        album,
        reviewer: 'scaruffi',
        limit
      });

      // Transform database results to API format
      const transformedReviews = reviews.map(review => ({
        artist: review.artist,
        album: review.album,
        year: review.year,
        scaruffi_score: review.score,
        scaruffi_summary: review.summary,
        source: 'scaruffi',
        source_url: review.source_url,
        scraped_at: review.scraped_at
      }));

      // Cache results for 1 hour
      this.database.cacheSet(cacheKey, transformedReviews, 3600);

      logger.info(`Retrieved ${transformedReviews.length} Scaruffi reviews`);
      return transformedReviews;
    } catch (error) {
      logger.error('Error fetching Scaruffi reviews:', error);
      throw error;
    }
  }

  async getAggregatedReviews({ artist, album, limit = 100, includeOverlapOnly = false } = {}) {
    await this.ensureInitialized();

    try {
      const cacheKey = `aggregated_${artist || 'all'}_${album || 'all'}_${limit}_${includeOverlapOnly}`;
      
      // Check cache first
      const cached = this.database.cacheGet(cacheKey);
      if (cached) {
        logger.debug(`Returning cached aggregated reviews: ${cached.length} results`);
        return cached;
      }

      if (includeOverlapOnly) {
        // Get only overlapping reviews
        const overlappingReviews = this.database.getOverlappingReviews({
          artist,
          album,
          limit
        });

        const transformedOverlaps = overlappingReviews.map(review => ({
          artist: review.artist,
          album: review.album,
          year: review.year,
          fantano_score: review.fantano_score,
          fantano_summary: review.fantano_summary,
          fantano_url: review.fantano_url,
          scaruffi_score: review.scaruffi_score,
          scaruffi_summary: review.scaruffi_summary,
          scaruffi_url: review.scaruffi_url,
          overlap: true,
          comparison: this.generateComparison(review)
        }));

        this.database.cacheSet(cacheKey, transformedOverlaps, 1800);
        return transformedOverlaps;
      }

      // Get reviews from both sources
      const [fantanoReviews, scaruffiReviews] = await Promise.all([
        this.getFantanoReviews({ artist, album, limit: Math.ceil(limit * 0.6), useCache: false }),
        this.getScaruffiReviews({ artist, album, limit: Math.ceil(limit * 0.6), useCache: false })
      ]);

      // Merge reviews intelligently
      const mergedReviews = this.mergeReviews(fantanoReviews, scaruffiReviews, limit);

      // Cache results for 30 minutes
      this.database.cacheSet(cacheKey, mergedReviews, 1800);

      logger.info(`Generated ${mergedReviews.length} aggregated reviews`);
      return mergedReviews;
    } catch (error) {
      logger.error('Error fetching aggregated reviews:', error);
      throw error;
    }
  }

  mergeReviews(fantanoReviews, scaruffiReviews, maxResults) {
    const merged = [];
    const artistAlbumMap = new Map();

    // Index Fantano reviews
    for (const review of fantanoReviews) {
      const key = this.createAlbumKey(review.artist, review.album);
      artistAlbumMap.set(key, { ...review });
      merged.push({ ...review });
    }

    // Merge Scaruffi reviews
    for (const review of scaruffiReviews) {
      const key = this.createAlbumKey(review.artist, review.album);
      
      if (artistAlbumMap.has(key)) {
        // Found overlap - merge the reviews
        const existing = artistAlbumMap.get(key);
        Object.assign(existing, {
          scaruffi_score: review.scaruffi_score,
          scaruffi_summary: review.scaruffi_summary,
          scaruffi_url: review.source_url,
          overlap: true,
          comparison: this.generateComparison({
            fantano_score: existing.fantano_score,
            fantano_summary: existing.fantano_summary,
            scaruffi_score: review.scaruffi_score,
            scaruffi_summary: review.scaruffi_summary
          })
        });
      } else {
        // New review - add to merged list
        merged.push({ ...review });
      }
    }

    // Sort by priority: overlaps first, then by year/score
    merged.sort((a, b) => {
      if (a.overlap && !b.overlap) return -1;
      if (!a.overlap && b.overlap) return 1;
      
      // For overlaps, sort by score difference
      if (a.overlap && b.overlap) {
        const aScoreDiff = Math.abs((a.fantano_score || 0) - (a.scaruffi_score || 0));
        const bScoreDiff = Math.abs((b.fantano_score || 0) - (b.scaruffi_score || 0));
        return bScoreDiff - aScoreDiff; // Larger differences first
      }
      
      // Standard sorting
      return (b.year || 0) - (a.year || 0);
    });

    return merged.slice(0, maxResults);
  }

  createAlbumKey(artist, album) {
    return `${this.normalizeText(artist)}_${this.normalizeText(album)}`;
  }

  normalizeText(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  generateComparison(review) {
    const fantanoScore = review.fantano_score;
    const scaruffiScore = review.scaruffi_score;
    
    if (!fantanoScore || !scaruffiScore) {
      return null;
    }

    const scoreDiff = Math.abs(fantanoScore - scaruffiScore);
    const avgScore = (fantanoScore + scaruffiScore) / 2;
    
    let agreement = 'similar';
    if (scoreDiff > 3) {
      agreement = 'disagree';
    } else if (scoreDiff < 1) {
      agreement = 'agree';
    }

    const higherRating = fantanoScore > scaruffiScore ? 'fantano' : 'scaruffi';
    
    return {
      score_difference: Math.round(scoreDiff * 10) / 10,
      average_score: Math.round(avgScore * 10) / 10,
      agreement_level: agreement,
      higher_rating: scoreDiff > 0.5 ? higherRating : 'similar',
      summary: this.generateComparisonSummary(fantanoScore, scaruffiScore, agreement)
    };
  }

  generateComparisonSummary(fantanoScore, scaruffiScore, agreement) {
    const scoreDiff = Math.abs(fantanoScore - scaruffiScore);
    
    if (agreement === 'agree') {
      return `Both critics give similar ratings (${fantanoScore} vs ${scaruffiScore}), suggesting strong consensus.`;
    } else if (agreement === 'disagree') {
      const higher = fantanoScore > scaruffiScore ? 'Fantano' : 'Scaruffi';
      const lower = fantanoScore > scaruffiScore ? 'Scaruffi' : 'Fantano';
      return `Strong disagreement: ${higher} rates it ${Math.max(fantanoScore, scaruffiScore)}/10 while ${lower} gives it ${Math.min(fantanoScore, scaruffiScore)}/10.`;
    } else {
      return `Mild difference in ratings (${fantanoScore} vs ${scaruffiScore}) suggests nuanced perspectives on the album.`;
    }
  }

  async getReviewStats() {
    await this.ensureInitialized();

    try {
      // Check cache first
      const cached = this.database.cacheGet('review_stats');
      if (cached) {
        return cached;
      }

      const stats = this.database.getAllStats();
      
      // Cache for 1 hour
      this.database.cacheSet('review_stats', stats, 3600);
      
      return stats;
    } catch (error) {
      logger.error('Error calculating review stats:', error);
      throw error;
    }
  }

  async searchByArtist(artistName, options = {}) {
    await this.ensureInitialized();

    try {
      const reviews = await this.getAggregatedReviews({
        artist: artistName,
        limit: options.limit || 25
      });

      return reviews;
    } catch (error) {
      logger.error(`Error searching for artist ${artistName}:`, error);
      throw error;
    }
  }

  async close() {
    if (this.database) {
      this.database.close();
    }
    logger.info('Working review service closed');
  }
}

module.exports = WorkingReviewService;