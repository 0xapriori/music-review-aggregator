const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/database.log' })
  ]
});

class SimplifiedDatabase {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, 'reviews.db');
    this.cache = new Map();
    this.cacheExpiry = new Map();
  }

  async initialize() {
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      
      await this.createTables();
      
      logger.info('Simplified database initialized');
      return true;
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        year INTEGER,
        reviewer TEXT NOT NULL,
        score REAL,
        summary TEXT,
        full_text TEXT,
        source_url TEXT,
        video_id TEXT,
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(artist, album, reviewer) ON CONFLICT REPLACE
      )`,
      
      `CREATE TABLE IF NOT EXISTS youtube_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        published_at DATETIME,
        transcript TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      this.db.exec(sql);
    }

    this.createIndexes();
  }

  createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_reviews_artist ON reviews(artist)',
      'CREATE INDEX IF NOT EXISTS idx_reviews_album ON reviews(album)', 
      'CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer)',
      'CREATE INDEX IF NOT EXISTS idx_reviews_year ON reviews(year)',
      'CREATE INDEX IF NOT EXISTS idx_youtube_videos_video_id ON youtube_videos(video_id)',
      'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)'
    ];

    for (const sql of indexes) {
      this.db.exec(sql);
    }
  }

  insertReview(reviewData) {
    const { artist, album, year, reviewer, score, summary, full_text, source_url, video_id } = reviewData;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO reviews 
      (artist, album, year, reviewer, score, summary, full_text, source_url, video_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    return stmt.run(artist, album, year, reviewer, score, summary, full_text, source_url, video_id);
  }

  insertYouTubeVideo(videoData) {
    const { video_id, title, description, published_at, transcript } = videoData;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO youtube_videos 
      (video_id, title, description, published_at, transcript)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(video_id, title, description, published_at, transcript);
  }

  getReviews({ artist, album, reviewer, limit = 100, offset = 0 } = {}) {
    let sql = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];

    if (artist) {
      sql += ' AND LOWER(artist) LIKE ?';
      params.push(`%${artist.toLowerCase()}%`);
    }

    if (album) {
      sql += ' AND LOWER(album) LIKE ?';
      params.push(`%${album.toLowerCase()}%`);
    }

    if (reviewer) {
      sql += ' AND reviewer = ?';
      params.push(reviewer);
    }

    sql += ' ORDER BY year DESC, artist, album LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  getOverlappingReviews({ artist, album, limit = 100 } = {}) {
    let sql = `
      SELECT 
        r1.artist,
        r1.album,
        r1.year,
        r1.score as fantano_score,
        r1.summary as fantano_summary,
        r1.source_url as fantano_url,
        r2.score as scaruffi_score,
        r2.summary as scaruffi_summary,
        r2.source_url as scaruffi_url
      FROM reviews r1
      JOIN reviews r2 ON LOWER(r1.artist) = LOWER(r2.artist) 
                      AND LOWER(r1.album) = LOWER(r2.album)
      WHERE r1.reviewer = 'fantano' AND r2.reviewer = 'scaruffi'
    `;
    
    const params = [];

    if (artist) {
      sql += ' AND LOWER(r1.artist) LIKE ?';
      params.push(`%${artist.toLowerCase()}%`);
    }

    if (album) {
      sql += ' AND LOWER(r1.album) LIKE ?';
      params.push(`%${album.toLowerCase()}%`);
    }

    sql += ' ORDER BY r1.year DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  // In-memory cache for speed
  cacheSet(key, value, ttlSeconds = 3600) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, value);
    this.cacheExpiry.set(key, expiresAt);
    
    // Also store in database for persistence
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO cache (key, value, expires_at)
        VALUES (?, ?, ?)
      `);
      const expiresISO = new Date(expiresAt).toISOString();
      stmt.run(key, JSON.stringify(value), expiresISO);
    } catch (error) {
      logger.warn('Cache database write failed:', error);
    }
  }

  cacheGet(key) {
    // Check in-memory first
    const expiry = this.cacheExpiry.get(key);
    if (expiry && Date.now() < expiry) {
      return this.cache.get(key);
    }

    // Clean expired in-memory cache
    if (expiry) {
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
    }

    // Check database
    try {
      const stmt = this.db.prepare(`
        SELECT value FROM cache 
        WHERE key = ? AND expires_at > datetime('now')
      `);
      const row = stmt.get(key);
      if (row) {
        const value = JSON.parse(row.value);
        // Restore to in-memory cache
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + 3600000); // 1 hour default
        return value;
      }
    } catch (error) {
      logger.warn('Cache database read failed:', error);
    }

    return null;
  }

  cleanupExpiredCache() {
    // Clean in-memory cache
    const now = Date.now();
    for (const [key, expiry] of this.cacheExpiry.entries()) {
      if (now >= expiry) {
        this.cache.delete(key);
        this.cacheExpiry.delete(key);
      }
    }

    // Clean database cache
    try {
      const stmt = this.db.prepare('DELETE FROM cache WHERE expires_at <= datetime("now")');
      const result = stmt.run();
      logger.debug(`Cleaned ${result.changes} expired cache entries`);
    } catch (error) {
      logger.warn('Cache cleanup failed:', error);
    }
  }

  getAllStats() {
    try {
      const totalReviews = this.db.prepare('SELECT COUNT(*) as count FROM reviews').get();
      
      const reviewsBySource = this.db.prepare(`
        SELECT reviewer, COUNT(*) as count FROM reviews GROUP BY reviewer
      `).all();
      
      const recentReviews = this.db.prepare(`
        SELECT COUNT(*) as count FROM reviews 
        WHERE scraped_at > datetime('now', '-7 days')
      `).get();
      
      const overlaps = this.db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT r1.artist, r1.album 
          FROM reviews r1 
          JOIN reviews r2 ON LOWER(r1.artist) = LOWER(r2.artist) 
                          AND LOWER(r1.album) = LOWER(r2.album)
          WHERE r1.reviewer = 'fantano' AND r2.reviewer = 'scaruffi'
        )
      `).get();
      
      const avgScores = this.db.prepare(`
        SELECT reviewer, AVG(score) as avg_score 
        FROM reviews 
        WHERE score IS NOT NULL 
        GROUP BY reviewer
      `).all();
      
      return {
        totalReviews: totalReviews.count,
        bySource: reviewsBySource.reduce((acc, row) => {
          acc[row.reviewer] = row.count;
          return acc;
        }, {}),
        recentReviews: recentReviews.count,
        overlappingReviews: overlaps.count,
        averageScores: avgScores.reduce((acc, row) => {
          acc[row.reviewer] = Math.round(row.avg_score * 100) / 100;
          return acc;
        }, {})
      };
    } catch (error) {
      logger.error('Error calculating stats:', error);
      return {};
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }
}

module.exports = SimplifiedDatabase;