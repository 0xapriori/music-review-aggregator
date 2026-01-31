const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Logger setup
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database class using JSON data
class CompactDatabase {
  constructor() {
    this.reviews = [];
    this.cache = new Map();
    this.cacheExpiry = new Map();
  }

  initialize() {
    try {
      // Load reviews from JSON file
      const jsonPath = path.join(__dirname, 'database', 'reviews.json');
      const rawData = fs.readFileSync(jsonPath, 'utf8');
      this.reviews = JSON.parse(rawData);
      logger.info(`Database initialized with ${this.reviews.length} reviews from JSON`);
      return true;
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  getReviews(filters = {}) {
    let filtered = [...this.reviews];

    if (filters.artist) {
      const artist = filters.artist.toLowerCase();
      filtered = filtered.filter(r => r.artist.toLowerCase().includes(artist));
    }
    if (filters.album) {
      const album = filters.album.toLowerCase();
      filtered = filtered.filter(r => r.album.toLowerCase().includes(album));
    }
    if (filters.reviewer) {
      filtered = filtered.filter(r => r.reviewer === filters.reviewer);
    }
    if (filters.min_score) {
      filtered = filtered.filter(r => r.score >= parseFloat(filters.min_score));
    }
    if (filters.max_score) {
      filtered = filtered.filter(r => r.score <= parseFloat(filters.max_score));
    }

    // Sort by year DESC, then score DESC
    filtered.sort((a, b) => {
      const yearDiff = (b.year || 0) - (a.year || 0);
      if (yearDiff !== 0) return yearDiff;
      return (b.score || 0) - (a.score || 0);
    });

    const offset = parseInt(filters.offset) || 0;
    const limit = parseInt(filters.limit) || 100;
    return filtered.slice(offset, offset + limit);
  }

  getOverlaps() {
    const fantanoReviews = this.reviews.filter(r => r.reviewer === 'fantano');
    const scaruffiReviews = this.reviews.filter(r => r.reviewer === 'scaruffi');
    const overlaps = [];

    for (const fantano of fantanoReviews) {
      const scaruffi = scaruffiReviews.find(s => 
        s.artist.toLowerCase() === fantano.artist.toLowerCase() && 
        s.album.toLowerCase() === fantano.album.toLowerCase()
      );
      
      if (scaruffi) {
        overlaps.push({
          artist: fantano.artist,
          album: fantano.album,
          year: fantano.year,
          fantano_score: fantano.score,
          fantano_summary: fantano.summary,
          fantano_url: fantano.source_url,
          scaruffi_score: scaruffi.score,
          scaruffi_summary: scaruffi.summary,
          scaruffi_url: scaruffi.source_url
        });
      }
    }

    // Sort by year DESC
    return overlaps.sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  getStats() {
    const totalReviews = this.reviews.length;
    
    // Group by reviewer
    const bySource = {};
    for (const review of this.reviews) {
      bySource[review.reviewer] = (bySource[review.reviewer] || 0) + 1;
    }
    
    // Count overlaps
    const overlappingReviews = this.getOverlaps().length;
    
    // Calculate average scores
    const averageScores = {};
    const reviewerGroups = {};
    for (const review of this.reviews) {
      if (!reviewerGroups[review.reviewer]) {
        reviewerGroups[review.reviewer] = [];
      }
      if (review.score !== null && review.score !== undefined) {
        reviewerGroups[review.reviewer].push(review.score);
      }
    }
    
    for (const [reviewer, scores] of Object.entries(reviewerGroups)) {
      if (scores.length > 0) {
        const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        averageScores[reviewer] = Math.round(avg * 10) / 10;
      }
    }

    return {
      totalReviews,
      bySource,
      overlappingReviews,
      averageScores
    };
  }
}

// Initialize database
const database = new CompactDatabase();
database.initialize();

// Middleware
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Utility functions
const generateComparison = (fantano, scaruffi) => {
  if (!fantano || !scaruffi) return null;
  
  const diff = Math.abs(fantano - scaruffi);
  const avg = (fantano + scaruffi) / 2;
  
  let agreement = 'similar';
  if (diff > 3) agreement = 'disagree';
  else if (diff < 1) agreement = 'agree';
  
  return {
    score_difference: Math.round(diff * 10) / 10,
    average_score: Math.round(avg * 10) / 10,
    agreement_level: agreement,
    higher_rating: fantano > scaruffi ? 'fantano' : 'scaruffi',
    summary: agreement === 'agree' ? 
      `Both critics agree (${fantano} vs ${scaruffi})` :
      `${agreement === 'disagree' ? 'Strong disagreement' : 'Mild difference'}: ${fantano} vs ${scaruffi}`
  };
};

// API Routes
app.get('/api/reviews', (req, res) => {
  try {
    const reviews = database.getReviews(req.query);
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    logger.error('Error fetching reviews:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/all', (req, res) => {
  try {
    const reviews = database.getReviews(req.query);
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    logger.error('Error fetching all reviews:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/fantano', (req, res) => {
  try {
    const reviews = database.getReviews({ ...req.query, reviewer: 'fantano' });
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/scaruffi', (req, res) => {
  try {
    const reviews = database.getReviews({ ...req.query, reviewer: 'scaruffi' });
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/overlap', (req, res) => {
  try {
    const overlaps = database.getOverlaps();
    const enhanced = overlaps.map(overlap => ({
      ...overlap,
      overlap: true,
      comparison: generateComparison(overlap.fantano_score, overlap.scaruffi_score)
    }));
    
    const filtered = req.query.artist ? 
      enhanced.filter(o => o.artist.toLowerCase().includes(req.query.artist.toLowerCase())) : 
      enhanced;
      
    res.json({ success: true, data: filtered, count: filtered.length });
  } catch (error) {
    logger.error('Error fetching overlaps:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/search/artist', (req, res) => {
  try {
    const { q } = req.query;
    const reviews = database.getReviews({ artist: q, limit: parseInt(req.query.limit) || 50 });
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/search/advanced', (req, res) => {
  try {
    const filters = {
      min_score: req.query.min_score ? parseFloat(req.query.min_score) : undefined,
      max_score: req.query.max_score ? parseFloat(req.query.max_score) : undefined,
      artist: req.query.artist,
      album: req.query.album,
      reviewer: req.query.reviewer,
      limit: parseInt(req.query.limit) || 100
    };
    
    const reviews = database.getReviews(filters);
    
    // Sort by score if requested
    if (req.query.sort_by === 'score') {
      reviews.sort((a, b) => {
        const order = req.query.order === 'desc' ? -1 : 1;
        return order * (b.score - a.score);
      });
    }
    
    res.json({ success: true, data: reviews, count: reviews.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/stats', (req, res) => {
  try {
    const stats = database.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/reviews/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: 'connected',
    reviews: database.getStats().totalReviews
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route specifically for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Catch-all handler for frontend (but not API routes)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  const stats = database.getStats();
  console.log(`🎵 Music Review Aggregator running on port ${PORT}`);
  console.log(`📊 ${stats.totalReviews} reviews loaded`);
  console.log(`🔄 ${stats.overlappingReviews} overlapping albums found`);
  console.log(`📈 Average scores: Fantano ${stats.averageScores.fantano || 'N/A'}, Scaruffi ${stats.averageScores.scaruffi || 'N/A'}`);
});

module.exports = app;