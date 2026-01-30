const Database = require('../database/database');
const YouTubeService = require('../scrapers/youtubeService');
const ScaruffiService = require('../scrapers/scaruffiService');
const SummarizationService = require('./summarizationService');
const ScrapingScheduler = require('../jobs/scrapingScheduler');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/review-service.log' })
  ]
});

class EnhancedReviewService {
  constructor() {
    this.database = null;
    this.youtubeService = null;
    this.scaruffiService = null;
    this.summarizationService = null;
    this.scheduler = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize database
      this.database = new Database();
      await this.database.initialize();

      // Initialize services
      this.youtubeService = new YouTubeService(this.database);
      this.scaruffiService = new ScaruffiService(this.database);
      this.summarizationService = new SummarizationService();
      this.scheduler = new ScrapingScheduler();
      await this.scheduler.initialize();

      // Start background jobs
      this.scheduler.scheduleJobs();

      logger.info('Enhanced review service initialized');
      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize enhanced review service:', error);
      throw error;
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
        const cached = await this.database.cacheGet(cacheKey);
        if (cached) {
          logger.debug(`Returning cached Fantano reviews: ${cached.length} results`);
          return cached;
        }
      }

      const reviews = await this.database.getReviews({
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
      await this.database.cacheSet(cacheKey, transformedReviews, 3600);

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
        const cached = await this.database.cacheGet(cacheKey);
        if (cached) {
          logger.debug(`Returning cached Scaruffi reviews: ${cached.length} results`);
          return cached;
        }
      }

      const reviews = await this.database.getReviews({
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
      await this.database.cacheSet(cacheKey, transformedReviews, 3600);

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
      const cached = await this.database.cacheGet(cacheKey);
      if (cached) {
        logger.debug(`Returning cached aggregated reviews: ${cached.length} results`);
        return cached;
      }

      if (includeOverlapOnly) {
        // Get only overlapping reviews
        const overlappingReviews = await this.database.getOverlappingReviews({
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

        await this.database.cacheSet(cacheKey, transformedOverlaps, 1800);
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
      await this.database.cacheSet(cacheKey, mergedReviews, 1800);

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

  async searchByArtist(artistName, options = {}) {
    await this.ensureInitialized();

    try {
      // Trigger background search if not enough results
      const existingReviews = await this.getAggregatedReviews({
        artist: artistName,
        limit: 10
      });

      if (existingReviews.length < 3) {
        // Queue background search for more data
        await this.scheduler.searchArtist(artistName);
        logger.info(`Queued background search for artist: ${artistName}`);
      }

      return existingReviews;
    } catch (error) {
      logger.error(`Error searching for artist ${artistName}:`, error);
      throw error;
    }
  }

  async getReviewStats() {
    await this.ensureInitialized();

    try {
      // Check cache first
      const cached = await this.database.cacheGet('review_stats');
      if (cached) {
        return cached;
      }

      const stats = await this.scheduler.calculateStats();
      
      // Add additional computed stats
      stats.dataFreshness = await this.calculateDataFreshness();
      stats.topArtists = await this.getTopReviewedArtists();
      stats.scoreDistribution = await this.getScoreDistribution();
      
      // Cache for 1 hour
      await this.database.cacheSet('review_stats', stats, 3600);
      
      return stats;
    } catch (error) {
      logger.error('Error calculating review stats:', error);
      throw error;
    }
  }

  async calculateDataFreshness() {
    try {
      const recentCounts = await this.database.all(`
        SELECT 
          reviewer,
          COUNT(*) as count
        FROM reviews 
        WHERE scraped_at > date('now', '-7 days')
        GROUP BY reviewer
      `);
      
      return recentCounts.reduce((acc, row) => {
        acc[row.reviewer] = row.count;
        return acc;
      }, {});
    } catch (error) {
      logger.error('Error calculating data freshness:', error);
      return {};
    }
  }

  async getTopReviewedArtists(limit = 10) {
    try {
      const topArtists = await this.database.all(`
        SELECT 
          artist,
          COUNT(*) as review_count,
          COUNT(DISTINCT reviewer) as reviewer_count,
          AVG(score) as avg_score
        FROM reviews 
        WHERE score IS NOT NULL
        GROUP BY LOWER(artist)
        HAVING review_count > 1
        ORDER BY review_count DESC, reviewer_count DESC
        LIMIT ?
      `, [limit]);
      
      return topArtists.map(artist => ({
        ...artist,
        avg_score: Math.round(artist.avg_score * 10) / 10
      }));
    } catch (error) {
      logger.error('Error getting top artists:', error);
      return [];
    }
  }

  async getScoreDistribution() {
    try {
      const distribution = await this.database.all(`
        SELECT 
          reviewer,
          CASE 
            WHEN score >= 9 THEN '9-10'
            WHEN score >= 7 THEN '7-8'
            WHEN score >= 5 THEN '5-6'
            WHEN score >= 3 THEN '3-4'
            ELSE '0-2'
          END as score_range,
          COUNT(*) as count
        FROM reviews 
        WHERE score IS NOT NULL
        GROUP BY reviewer, score_range
        ORDER BY reviewer, score_range DESC
      `);
      
      const formatted = {};
      for (const row of distribution) {
        if (!formatted[row.reviewer]) {
          formatted[row.reviewer] = {};
        }
        formatted[row.reviewer][row.score_range] = row.count;
      }
      
      return formatted;
    } catch (error) {
      logger.error('Error calculating score distribution:', error);
      return {};
    }
  }

  async triggerScraping(source, options = {}) {
    await this.ensureInitialized();

    try {
      const result = await this.scheduler.manualScrape(source, options);
      logger.info(`Triggered manual scraping for ${source}:`, result);
      return result;
    } catch (error) {
      logger.error(`Error triggering scraping for ${source}:`, error);
      throw error;
    }
  }

  async getScrapingStatus(jobId, queue) {
    await this.ensureInitialized();

    try {
      return await this.scheduler.getJobStatus(queue, jobId);
    } catch (error) {
      logger.error(`Error getting scraping status:`, error);
      throw error;
    }
  }

  async close() {
    if (this.scheduler) {
      await this.scheduler.stop();
    }
    if (this.database) {
      await this.database.close();
    }
    logger.info('Enhanced review service closed');
  }
}

module.exports = EnhancedReviewService;