const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
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

// Database class integrated
class CompactDatabase {
  constructor() {
    this.db = null;
    this.cache = new Map();
    this.cacheExpiry = new Map();
  }

  initialize() {
    try {
      // Use the existing database file with real scraped data
      const dbPath = path.join(__dirname, 'database', 'reviews.db');
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      logger.info('Database initialized with existing scraped data');
      return true;
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  // No need to create tables or seed data - using existing scraped database

  getReviews(filters = {}) {
    let sql = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];

    if (filters.artist) {
      sql += ' AND LOWER(artist) LIKE ?';
      params.push(`%${filters.artist.toLowerCase()}%`);
    }
    if (filters.album) {
      sql += ' AND LOWER(album) LIKE ?';
      params.push(`%${filters.album.toLowerCase()}%`);
    }
    if (filters.reviewer) {
      sql += ' AND reviewer = ?';
      params.push(filters.reviewer);
    }
    if (filters.min_score) {
      sql += ' AND score >= ?';
      params.push(filters.min_score);
    }
    if (filters.max_score) {
      sql += ' AND score <= ?';
      params.push(filters.max_score);
    }

    sql += ' ORDER BY year DESC, score DESC LIMIT ?';
    params.push(filters.limit || 100);

    return this.db.prepare(sql).all(...params);
  }

  getOverlaps() {
    const sql = `
      SELECT 
        r1.artist, r1.album, r1.year,
        r1.score as fantano_score, r1.summary as fantano_summary, r1.source_url as fantano_url,
        r2.score as scaruffi_score, r2.summary as scaruffi_summary, r2.source_url as scaruffi_url
      FROM reviews r1
      JOIN reviews r2 ON LOWER(r1.artist) = LOWER(r2.artist) AND LOWER(r1.album) = LOWER(r2.album)
      WHERE r1.reviewer = 'fantano' AND r2.reviewer = 'scaruffi'
      ORDER BY r1.year DESC
    `;
    return this.db.prepare(sql).all();
  }

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM reviews').get();
    const byReviewer = this.db.prepare('SELECT reviewer, COUNT(*) as count FROM reviews GROUP BY reviewer').all();
    const overlaps = this.db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT r1.artist, r1.album FROM reviews r1
        JOIN reviews r2 ON LOWER(r1.artist) = LOWER(r2.artist) AND LOWER(r1.album) = LOWER(r2.album)
        WHERE r1.reviewer = 'fantano' AND r2.reviewer = 'scaruffi'
      )
    `).get();
    const avgScores = this.db.prepare('SELECT reviewer, AVG(score) as avg FROM reviews GROUP BY reviewer').all();

    return {
      totalReviews: total.count,
      bySource: byReviewer.reduce((acc, row) => ({ ...acc, [row.reviewer]: row.count }), {}),
      overlappingReviews: overlaps.count,
      averageScores: avgScores.reduce((acc, row) => ({ ...acc, [row.reviewer]: Math.round(row.avg * 10) / 10 }), {})
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

// Serve static files from client build
app.use(express.static(path.join(__dirname, 'client/build')));

// Catch-all handler for React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build/index.html'));
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