const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

class Database {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, 'reviews.db');
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Database connection error:', err);
          reject(err);
        } else {
          logger.info('Connected to SQLite database');
          this.createTables()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
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
        UNIQUE(artist, album, reviewer)
      )`,
      
      `CREATE TABLE IF NOT EXISTS youtube_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        published_at DATETIME,
        duration INTEGER,
        view_count INTEGER,
        channel_id TEXT,
        transcript TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS scraping_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        data TEXT,
        error_message TEXT,
        started_at DATETIME,
        completed_at DATETIME,
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
      await this.run(sql);
    }

    await this.createIndexes();
  }

  async createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_reviews_artist ON reviews(artist)',
      'CREATE INDEX IF NOT EXISTS idx_reviews_album ON reviews(album)', 
      'CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer)',
      'CREATE INDEX IF NOT EXISTS idx_reviews_year ON reviews(year)',
      'CREATE INDEX IF NOT EXISTS idx_youtube_videos_video_id ON youtube_videos(video_id)',
      'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)'
    ];

    for (const sql of indexes) {
      await this.run(sql);
    }
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database run error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async insertReview(reviewData) {
    const { artist, album, year, reviewer, score, summary, full_text, source_url, video_id } = reviewData;
    
    const sql = `
      INSERT OR REPLACE INTO reviews 
      (artist, album, year, reviewer, score, summary, full_text, source_url, video_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    
    return this.run(sql, [artist, album, year, reviewer, score, summary, full_text, source_url, video_id]);
  }

  async insertYouTubeVideo(videoData) {
    const { video_id, title, description, published_at, duration, view_count, channel_id, transcript } = videoData;
    
    const sql = `
      INSERT OR REPLACE INTO youtube_videos 
      (video_id, title, description, published_at, duration, view_count, channel_id, transcript)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return this.run(sql, [video_id, title, description, published_at, duration, view_count, channel_id, transcript]);
  }

  async getReviews({ artist, album, reviewer, limit = 100, offset = 0 } = {}) {
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

    return this.all(sql, params);
  }

  async getOverlappingReviews({ artist, album, limit = 100 } = {}) {
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

    return this.all(sql, params);
  }

  async cacheSet(key, value, ttlSeconds = 3600) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const sql = `
      INSERT OR REPLACE INTO cache (key, value, expires_at)
      VALUES (?, ?, ?)
    `;
    return this.run(sql, [key, JSON.stringify(value), expiresAt.toISOString()]);
  }

  async cacheGet(key) {
    const sql = `
      SELECT value FROM cache 
      WHERE key = ? AND expires_at > CURRENT_TIMESTAMP
    `;
    const row = await this.get(sql, [key]);
    return row ? JSON.parse(row.value) : null;
  }

  async cleanupExpiredCache() {
    const sql = 'DELETE FROM cache WHERE expires_at <= CURRENT_TIMESTAMP';
    return this.run(sql);
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Database close error:', err);
          } else {
            logger.info('Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;