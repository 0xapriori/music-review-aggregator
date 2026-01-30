const cron = require('node-cron');
const Bull = require('bull');
const winston = require('winston');
const Database = require('../database/database');
const YouTubeService = require('../scrapers/youtubeService');
const ScaruffiService = require('../scrapers/scaruffiService');
const SummarizationService = require('../services/summarizationService');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/jobs.log' })
  ]
});

class ScrapingScheduler {
  constructor() {
    this.database = null;
    this.youtubeService = null;
    this.scaruffiService = null;
    this.summarizationService = null;
    this.isInitialized = false;
    
    // Create job queues
    this.youtubeQueue = new Bull('youtube scraping', {
      redis: { port: 6379, host: '127.0.0.1' },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        delay: 1000
      }
    });
    
    this.scaruffiQueue = new Bull('scaruffi scraping', {
      redis: { port: 6379, host: '127.0.0.1' },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        delay: 2000
      }
    });
    
    this.processingQueue = new Bull('content processing', {
      redis: { port: 6379, host: '127.0.0.1' },
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 10
      }
    });

    this.setupJobProcessors();
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
      
      logger.info('Scraping scheduler initialized');
      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize scraping scheduler:', error);
      throw error;
    }
  }

  setupJobProcessors() {
    // YouTube video processing
    this.youtubeQueue.process('scrape-latest', 1, async (job) => {
      const { maxVideos = 50 } = job.data;
      logger.info(`Starting YouTube scraping job: ${maxVideos} videos`);
      
      try {
        const reviews = await this.youtubeService.scrapeLatestReviews(maxVideos);
        
        // Queue content processing for each review
        for (const review of reviews) {
          await this.processingQueue.add('process-review', {
            reviewId: review.id,
            type: 'fantano'
          });
        }
        
        return { success: true, count: reviews.length };
      } catch (error) {
        logger.error('YouTube scraping job failed:', error);
        throw error;
      }
    });

    // YouTube channel monitoring
    this.youtubeQueue.process('monitor-channel', 1, async (job) => {
      logger.info('Monitoring YouTube channel for new videos');
      
      try {
        // Get latest videos and check against database
        const latestVideos = await this.youtubeService.getChannelVideos(10);
        const newVideos = [];
        
        for (const video of latestVideos) {
          const existing = await this.database.get(
            'SELECT id FROM youtube_videos WHERE video_id = ?',
            [video.videoId]
          );
          
          if (!existing) {
            newVideos.push(video);
          }
        }
        
        // Process new videos
        for (const video of newVideos) {
          await this.youtubeQueue.add('process-video', { video });
        }
        
        return { success: true, newVideos: newVideos.length };
      } catch (error) {
        logger.error('YouTube monitoring job failed:', error);
        throw error;
      }
    });

    // Individual video processing
    this.youtubeQueue.process('process-video', 2, async (job) => {
      const { video } = job.data;
      logger.info(`Processing video: ${video.videoId}`);
      
      try {
        const review = await this.youtubeService.processVideo(video);
        
        if (review) {
          await this.processingQueue.add('enhance-summary', {
            reviewId: review.id,
            type: 'fantano'
          });
        }
        
        return { success: true, review: !!review };
      } catch (error) {
        logger.error(`Video processing failed for ${video.videoId}:`, error);
        throw error;
      }
    });

    // Scaruffi scraping
    this.scaruffiQueue.process('scrape-scaruffi', 1, async (job) => {
      const { type = 'incremental', maxPages = 50 } = job.data;
      logger.info(`Starting Scaruffi scraping: ${type}`);
      
      try {
        let reviews = [];
        
        if (type === 'full') {
          reviews = await this.scaruffiService.scrapeAllData();
        } else {
          // Incremental scraping - focus on main ratings pages
          reviews = await this.scaruffiService.scrapeRatingsPage();
        }
        
        // Queue content processing
        for (const review of reviews) {
          await this.processingQueue.add('process-review', {
            reviewId: review.id,
            type: 'scaruffi'
          });
        }
        
        return { success: true, count: reviews.length };
      } catch (error) {
        logger.error('Scaruffi scraping job failed:', error);
        throw error;
      }
    });

    // Search specific artist on Scaruffi
    this.scaruffiQueue.process('search-artist', 1, async (job) => {
      const { artistName } = job.data;
      logger.info(`Searching Scaruffi for artist: ${artistName}`);
      
      try {
        const reviews = await this.scaruffiService.searchArtistReviews(artistName);
        
        for (const review of reviews) {
          await this.database.insertReview({
            ...review,
            reviewer: 'scaruffi',
            full_text: review.summary
          });
        }
        
        return { success: true, count: reviews.length };
      } catch (error) {
        logger.error(`Artist search failed for ${artistName}:`, error);
        throw error;
      }
    });

    // Content processing and enhancement
    this.processingQueue.process('enhance-summary', 5, async (job) => {
      const { reviewId, type } = job.data;
      
      try {
        const review = await this.database.get(
          'SELECT * FROM reviews WHERE id = ?',
          [reviewId]
        );
        
        if (!review) {
          throw new Error(`Review ${reviewId} not found`);
        }
        
        // Enhance summary using AI
        let enhancedSummary = review.summary;
        
        if (review.full_text && review.full_text.length > 100) {
          enhancedSummary = this.summarizationService.summarizeTranscript(
            review.full_text,
            `${review.artist} - ${review.album}`,
            3
          );
        }
        
        // Extract keywords
        const keywords = this.summarizationService.extractKeywords(
          review.full_text || review.summary || '',
          10
        );
        
        // Update review with enhanced content
        await this.database.run(
          'UPDATE reviews SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [enhancedSummary, reviewId]
        );
        
        return { success: true, keywordCount: keywords.length };
      } catch (error) {
        logger.error(`Content enhancement failed for review ${reviewId}:`, error);
        throw error;
      }
    });

    // Data cleanup and maintenance
    this.processingQueue.process('cleanup', 1, async (job) => {
      logger.info('Running data cleanup');
      
      try {
        // Clean expired cache
        await this.database.cleanupExpiredCache();
        
        // Remove old processing logs
        await this.database.run(
          'DELETE FROM scraping_jobs WHERE created_at < date("now", "-7 days")'
        );
        
        // Update statistics
        const stats = await this.calculateStats();
        await this.database.cacheSet('site_stats', stats, 3600);
        
        return { success: true, stats };
      } catch (error) {
        logger.error('Cleanup job failed:', error);
        throw error;
      }
    });
  }

  scheduleJobs() {
    if (!this.isInitialized) {
      throw new Error('Scheduler not initialized');
    }

    // Daily YouTube scraping at 2 AM
    cron.schedule('0 2 * * *', async () => {
      logger.info('Scheduled YouTube scraping started');
      await this.youtubeQueue.add('scrape-latest', { maxVideos: 100 });
    });

    // YouTube channel monitoring every 4 hours
    cron.schedule('0 */4 * * *', async () => {
      logger.info('Scheduled YouTube monitoring started');
      await this.youtubeQueue.add('monitor-channel', {});
    });

    // Weekly Scaruffi scraping on Sundays at 3 AM
    cron.schedule('0 3 * * 0', async () => {
      logger.info('Scheduled Scaruffi scraping started');
      await this.scaruffiQueue.add('scrape-scaruffi', { 
        type: 'incremental', 
        maxPages: 30 
      });
    });

    // Monthly full Scaruffi scraping
    cron.schedule('0 4 1 * *', async () => {
      logger.info('Scheduled full Scaruffi scraping started');
      await this.scaruffiQueue.add('scrape-scaruffi', { 
        type: 'full', 
        maxPages: 100 
      });
    });

    // Daily cleanup at 1 AM
    cron.schedule('0 1 * * *', async () => {
      logger.info('Scheduled cleanup started');
      await this.processingQueue.add('cleanup', {});
    });

    logger.info('Cron jobs scheduled successfully');
  }

  async manualScrape(source, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      if (source === 'fantano') {
        const job = await this.youtubeQueue.add('scrape-latest', {
          maxVideos: options.maxVideos || 25
        });
        return { jobId: job.id, source: 'fantano' };
      } else if (source === 'scaruffi') {
        const job = await this.scaruffiQueue.add('scrape-scaruffi', {
          type: options.type || 'incremental',
          maxPages: options.maxPages || 20
        });
        return { jobId: job.id, source: 'scaruffi' };
      } else {
        throw new Error(`Unknown source: ${source}`);
      }
    } catch (error) {
      logger.error(`Manual scrape failed for ${source}:`, error);
      throw error;
    }
  }

  async searchArtist(artistName) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Queue searches on both platforms
      const fantanoJob = await this.youtubeQueue.add('search-artist', { artistName });
      const scaruffiJob = await this.scaruffiQueue.add('search-artist', { artistName });
      
      return {
        fantanoJobId: fantanoJob.id,
        scaruffiJobId: scaruffiJob.id
      };
    } catch (error) {
      logger.error(`Artist search failed for ${artistName}:`, error);
      throw error;
    }
  }

  async getJobStatus(queue, jobId) {
    try {
      const queueInstance = this[`${queue}Queue`];
      if (!queueInstance) {
        throw new Error(`Unknown queue: ${queue}`);
      }
      
      const job = await queueInstance.getJob(jobId);
      if (!job) {
        return { status: 'not_found' };
      }
      
      return {
        status: await job.getState(),
        progress: job.progress(),
        data: job.data,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason
      };
    } catch (error) {
      logger.error(`Error getting job status:`, error);
      throw error;
    }
  }

  async calculateStats() {
    try {
      const stats = {};
      
      // Total reviews
      const totalReviews = await this.database.get(
        'SELECT COUNT(*) as count FROM reviews'
      );
      stats.totalReviews = totalReviews.count;
      
      // Reviews by source
      const reviewsBySource = await this.database.all(
        'SELECT reviewer, COUNT(*) as count FROM reviews GROUP BY reviewer'
      );
      stats.bySource = reviewsBySource.reduce((acc, row) => {
        acc[row.reviewer] = row.count;
        return acc;
      }, {});
      
      // Recent activity
      const recentReviews = await this.database.get(
        'SELECT COUNT(*) as count FROM reviews WHERE scraped_at > date("now", "-7 days")'
      );
      stats.recentReviews = recentReviews.count;
      
      // Overlapping reviews
      const overlaps = await this.database.all(`
        SELECT COUNT(*) as count FROM (
          SELECT r1.artist, r1.album 
          FROM reviews r1 
          JOIN reviews r2 ON LOWER(r1.artist) = LOWER(r2.artist) 
                          AND LOWER(r1.album) = LOWER(r2.album)
          WHERE r1.reviewer = 'fantano' AND r2.reviewer = 'scaruffi'
        )
      `);
      stats.overlappingReviews = overlaps[0].count;
      
      // Average scores
      const avgScores = await this.database.all(
        'SELECT reviewer, AVG(score) as avg_score FROM reviews WHERE score IS NOT NULL GROUP BY reviewer'
      );
      stats.averageScores = avgScores.reduce((acc, row) => {
        acc[row.reviewer] = Math.round(row.avg_score * 100) / 100;
        return acc;
      }, {});
      
      return stats;
    } catch (error) {
      logger.error('Error calculating stats:', error);
      return {};
    }
  }

  async stop() {
    try {
      await this.youtubeQueue.close();
      await this.scaruffiQueue.close();
      await this.processingQueue.close();
      
      if (this.database) {
        await this.database.close();
      }
      
      logger.info('Scraping scheduler stopped');
    } catch (error) {
      logger.error('Error stopping scheduler:', error);
    }
  }
}

module.exports = ScrapingScheduler;