const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const WorkingReviewService = require('../services/workingReviewService');

// Initialize service
const reviewService = new WorkingReviewService();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});

const searchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // limit search requests
  message: { error: 'Search rate limit exceeded, please wait.' }
});

router.use(limiter);

// Middleware to ensure service is initialized
router.use(async (req, res, next) => {
  try {
    await reviewService.ensureInitialized();
    next();
  } catch (error) {
    console.error('Service initialization error:', error);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

// Get Fantano reviews
router.get('/fantano', async (req, res) => {
  try {
    const { artist, album, limit = 50, fresh = false } = req.query;
    const reviews = await reviewService.getFantanoReviews({ 
      artist, 
      album, 
      limit: parseInt(limit),
      useCache: fresh !== 'true'
    });
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      source: 'fantano'
    });
  } catch (error) {
    console.error('Error fetching Fantano reviews:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch Fantano reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get Scaruffi reviews
router.get('/scaruffi', async (req, res) => {
  try {
    const { artist, album, limit = 50, fresh = false } = req.query;
    const reviews = await reviewService.getScaruffiReviews({ 
      artist, 
      album, 
      limit: parseInt(limit),
      useCache: fresh !== 'true'
    });
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      source: 'scaruffi'
    });
  } catch (error) {
    console.error('Error fetching Scaruffi reviews:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch Scaruffi reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get aggregated reviews
router.get('/all', async (req, res) => {
  try {
    const { artist, album, limit = 100, overlap_only = false } = req.query;
    const reviews = await reviewService.getAggregatedReviews({ 
      artist, 
      album, 
      limit: parseInt(limit),
      includeOverlapOnly: overlap_only === 'true'
    });
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      source: 'aggregated'
    });
  } catch (error) {
    console.error('Error fetching aggregated reviews:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch aggregated reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search by artist
router.get('/search/artist/:artistName', searchLimiter, async (req, res) => {
  try {
    const { artistName } = req.params;
    const { limit = 25 } = req.query;
    
    if (!artistName || artistName.length < 2) {
      return res.status(400).json({ 
        success: false,
        error: 'Artist name must be at least 2 characters' 
      });
    }
    
    const reviews = await reviewService.searchByArtist(artistName, { limit: parseInt(limit) });
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      artist: artistName,
      message: reviews.length < 3 ? 'Background search initiated for more results' : undefined
    });
  } catch (error) {
    console.error('Error searching for artist:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to search for artist',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get review statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await reviewService.getReviewStats();
    
    res.json({
      success: true,
      data: stats,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Trigger manual scraping (admin endpoint)
router.post('/admin/scrape/:source', async (req, res) => {
  try {
    const { source } = req.params;
    const { max_videos, max_pages, type } = req.body;
    
    if (!['fantano', 'scaruffi'].includes(source)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid source. Must be "fantano" or "scaruffi"' 
      });
    }
    
    const options = {};
    if (source === 'fantano') {
      options.maxVideos = parseInt(max_videos) || 25;
    } else {
      options.maxPages = parseInt(max_pages) || 10;
      options.type = type || 'incremental';
    }
    
    const result = await reviewService.triggerScraping(source, options);
    
    res.json({
      success: true,
      message: `Scraping job queued for ${source}`,
      job: result
    });
  } catch (error) {
    console.error('Error triggering scraping:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to trigger scraping',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get scraping job status
router.get('/admin/scrape/:queue/:jobId/status', async (req, res) => {
  try {
    const { queue, jobId } = req.params;
    
    const status = await reviewService.getScrapingStatus(jobId, queue);
    
    res.json({
      success: true,
      job_id: jobId,
      queue: queue,
      status: status
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get job status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Advanced search with multiple filters
router.get('/search/advanced', searchLimiter, async (req, res) => {
  try {
    const { 
      artist, 
      album, 
      min_score, 
      max_score, 
      year_from, 
      year_to, 
      reviewer,
      limit = 50,
      sort_by = 'year',
      order = 'desc'
    } = req.query;
    
    // Build search parameters
    const searchParams = {
      artist,
      album,
      reviewer: reviewer && ['fantano', 'scaruffi'].includes(reviewer) ? reviewer : undefined,
      limit: parseInt(limit)
    };
    
    // Get base results
    let reviews = await reviewService.getAggregatedReviews(searchParams);
    
    // Apply advanced filters
    if (min_score || max_score || year_from || year_to) {
      reviews = reviews.filter(review => {
        // Score filtering
        const score = review.fantano_score || review.scaruffi_score;
        if (min_score && score < parseFloat(min_score)) return false;
        if (max_score && score > parseFloat(max_score)) return false;
        
        // Year filtering
        if (year_from && review.year < parseInt(year_from)) return false;
        if (year_to && review.year > parseInt(year_to)) return false;
        
        return true;
      });
    }
    
    // Apply sorting
    if (sort_by === 'score') {
      reviews.sort((a, b) => {
        const aScore = a.fantano_score || a.scaruffi_score || 0;
        const bScore = b.fantano_score || b.scaruffi_score || 0;
        return order === 'desc' ? bScore - aScore : aScore - bScore;
      });
    } else if (sort_by === 'artist') {
      reviews.sort((a, b) => {
        const result = a.artist.localeCompare(b.artist);
        return order === 'desc' ? -result : result;
      });
    }
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      filters: {
        artist, album, min_score, max_score, year_from, year_to, reviewer
      },
      sort: { sort_by, order }
    });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ 
      success: false,
      error: 'Advanced search failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get overlapping reviews only
router.get('/overlap', async (req, res) => {
  try {
    const { artist, album, limit = 50 } = req.query;
    
    const reviews = await reviewService.getAggregatedReviews({ 
      artist, 
      album, 
      limit: parseInt(limit),
      includeOverlapOnly: true
    });
    
    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
      type: 'overlap_only'
    });
  } catch (error) {
    console.error('Error fetching overlapping reviews:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch overlapping reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const stats = await reviewService.getReviewStats();
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      total_reviews: stats.totalReviews || 0,
      sources: stats.bySource || {},
      recent_activity: stats.recentReviews || 0
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Service health check failed'
    });
  }
});

// Manual scraping endpoints
router.post('/scrape/fantano', async (req, res) => {
  try {
    const { maxVideos = 20 } = req.body;
    
    // Import scraping service
    const SimplifiedScrapers = require('../scrapers/simplifiedScrapers');
    const scraper = new SimplifiedScrapers(reviewService.database);
    
    const results = await scraper.scrapeFantanoRSS();
    
    res.json({
      success: true,
      scraped: results.length,
      message: `Scraped ${results.length} new Fantano reviews`,
      data: results
    });
  } catch (error) {
    console.error('Error scraping Fantano:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to scrape Fantano reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/scrape/scaruffi', async (req, res) => {
  try {
    const { maxPages = 5 } = req.body;
    
    // Import scraping service
    const SimplifiedScrapers = require('../scrapers/simplifiedScrapers');
    const scraper = new SimplifiedScrapers(reviewService.database);
    
    const results = await scraper.scrapeScaruffi();
    
    res.json({
      success: true,
      scraped: results.length,
      message: `Scraped ${results.length} new Scaruffi reviews`,
      data: results
    });
  } catch (error) {
    console.error('Error scraping Scaruffi:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to scrape Scaruffi reviews',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/scrape/all', async (req, res) => {
  try {
    const results = { fantano: 0, scaruffi: 0, total: 0 };
    
    // Use simplified scrapers
    const SimplifiedScrapers = require('../scrapers/simplifiedScrapers');
    const scraper = new SimplifiedScrapers(reviewService.database);
    
    const scrapingResults = await scraper.scrapeAll();
    results.fantano = scrapingResults.fantano.length;
    results.scaruffi = scrapingResults.scaruffi.length;
    results.total = scrapingResults.total;
    
    res.json({
      success: true,
      scraped: results.total,
      breakdown: results,
      message: `Scraped ${results.total} total reviews (${results.fantano} Fantano, ${results.scaruffi} Scaruffi)`
    });
  } catch (error) {
    console.error('Error in bulk scraping:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to perform bulk scraping',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;