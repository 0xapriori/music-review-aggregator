const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const winston = require('winston');
const pLimit = require('p-limit');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/scaruffi.log' })
  ]
});

class ScaruffiService {
  constructor(database) {
    this.db = database;
    this.baseUrl = 'https://www.scaruffi.com';
    this.limit = pLimit(1); // More conservative rate limiting for Scaruffi
    this.browser = null;
    
    // Request headers to appear more human
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    };

    // Main sections of Scaruffi's site
    this.mainSections = [
      '/ratings/index.html',
      '/vol1/index.html',
      '/vol2/index.html', 
      '/vol3/index.html',
      '/vol4/index.html',
      '/vol5/index.html',
      '/jazz/index.html',
      '/blues/index.html'
    ];
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async makeRequest(url, options = {}) {
    const delay = 1000 + Math.random() * 2000; // 1-3 second delay
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 15000,
        ...options
      });
      
      logger.debug(`Successfully fetched ${url}`);
      return response.data;
    } catch (error) {
      logger.warn(`Failed to fetch ${url}: ${error.message}`);
      throw error;
    }
  }

  async scrapeRatingsPage() {
    logger.info('Scraping main ratings page');
    
    try {
      const html = await this.makeRequest(`${this.baseUrl}/ratings/index.html`);
      const $ = cheerio.load(html);
      const reviews = [];

      // Find rating tables and lists
      $('table tr, p, div').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 10) {
          const review = this.parseRatingText(text, $(elem));
          if (review) {
            reviews.push(review);
          }
        }
      });

      // Also look for specific rating patterns
      const ratingPatterns = this.extractRatingPatterns(html);
      reviews.push(...ratingPatterns);

      logger.info(`Found ${reviews.length} reviews from ratings page`);
      return reviews;
    } catch (error) {
      logger.error('Error scraping ratings page:', error);
      return [];
    }
  }

  async scrapeVolumePages() {
    logger.info('Scraping volume pages');
    const allReviews = [];
    
    for (const section of this.mainSections) {
      if (section === '/ratings/index.html') continue; // Already processed
      
      try {
        await this.limit(async () => {
          logger.info(`Scraping section: ${section}`);
          const reviews = await this.scrapeSection(section);
          allReviews.push(...reviews);
        });
      } catch (error) {
        logger.error(`Error scraping section ${section}:`, error);
      }
    }

    return allReviews;
  }

  async scrapeSection(sectionPath) {
    const url = `${this.baseUrl}${sectionPath}`;
    
    try {
      const html = await this.makeRequest(url);
      const $ = cheerio.load(html);
      const reviews = [];

      // Find links to artist/album pages
      const links = [];
      $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href && this.isArtistLink(href)) {
          links.push({
            url: this.resolveUrl(href, url),
            text: $(elem).text().trim()
          });
        }
      });

      // Sample a subset of links to avoid overloading
      const selectedLinks = this.sampleLinks(links, 20);
      
      for (const link of selectedLinks) {
        try {
          await this.limit(async () => {
            const artistReviews = await this.scrapeArtistPage(link.url);
            reviews.push(...artistReviews);
          });
        } catch (error) {
          logger.warn(`Error scraping artist page ${link.url}:`, error);
        }
      }

      return reviews;
    } catch (error) {
      logger.error(`Error scraping section ${sectionPath}:`, error);
      return [];
    }
  }

  async scrapeArtistPage(url) {
    try {
      const html = await this.makeRequest(url);
      const $ = cheerio.load(html);
      const reviews = [];

      // Extract artist name from URL or page
      const artist = this.extractArtistName(url, $);
      
      // Look for album reviews in various formats
      $('p, div, table tr').each((i, elem) => {
        const text = $(elem).text().trim();
        const review = this.parseAlbumReview(text, artist, url);
        if (review) {
          reviews.push(review);
        }
      });

      // Look for discography sections
      const discographyReviews = this.parseDiscography($, artist, url);
      reviews.push(...discographyReviews);

      return reviews.filter(r => r.album && r.album.length > 1);
    } catch (error) {
      logger.warn(`Error scraping artist page ${url}:`, error);
      return [];
    }
  }

  parseRatingText(text, element) {
    // Patterns for Scaruffi's rating format
    const patterns = [
      // "Artist: Album (Year) - Rating"
      /^(.+?):\s*(.+?)\s*\((\d{4})\)\s*[-–]\s*(\d+(?:\.\d+)?)/,
      // "Artist - Album (Year) Rating"
      /^(.+?)\s*[-–]\s*(.+?)\s*\((\d{4})\)\s*(\d+(?:\.\d+)?)/,
      // "Album by Artist (Year) Rating"
      /^(.+?)\s+by\s+(.+?)\s*\((\d{4})\)\s*(\d+(?:\.\d+)?)/,
      // Rating followed by album info
      /(\d+(?:\.\d+)?)\s*[-–]\s*(.+?):\s*(.+?)\s*\((\d{4})\)/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let artist, album, year, score;
        
        if (pattern.source.includes('by')) {
          // "Album by Artist" format
          album = match[1].trim();
          artist = match[2].trim();
          year = parseInt(match[3]);
          score = parseFloat(match[4]);
        } else if (pattern.source.startsWith('(')) {
          // Rating first format
          score = parseFloat(match[1]);
          artist = match[2].trim();
          album = match[3].trim();
          year = parseInt(match[4]);
        } else {
          // Standard format
          artist = match[1].trim();
          album = match[2].trim();
          year = parseInt(match[3]);
          score = parseFloat(match[4]);
        }
        
        if (this.isValidReview({ artist, album, year, score })) {
          return {
            artist: this.cleanString(artist),
            album: this.cleanString(album),
            year: year,
            score: score,
            summary: this.extractSummaryFromElement(element),
            source_url: this.baseUrl
          };
        }
      }
    }

    return null;
  }

  parseAlbumReview(text, artist, sourceUrl) {
    // More flexible parsing for individual album pages
    const albumPatterns = [
      // Album title followed by year and rating
      /^(.+?)\s*\((\d{4})\)\s*[-–]?\s*(\d+(?:\.\d+)?)/,
      // Rating: Album (Year)
      /(\d+(?:\.\d+)?)\s*:\s*(.+?)\s*\((\d{4})\)/,
      // Album (Year) gets rating
      /^(.+?)\s*\((\d{4})\).*?(\d+(?:\.\d+)?)(?:\s*\/\s*10)?/
    ];

    for (const pattern of albumPatterns) {
      const match = text.match(pattern);
      if (match) {
        let album, year, score;
        
        if (pattern.source.startsWith('(')) {
          // Rating first
          score = parseFloat(match[1]);
          album = match[2].trim();
          year = parseInt(match[3]);
        } else {
          // Album first
          album = match[1].trim();
          year = parseInt(match[2]);
          score = parseFloat(match[3]);
        }
        
        if (this.isValidReview({ artist, album, year, score })) {
          return {
            artist: artist,
            album: this.cleanString(album),
            year: year,
            score: score,
            summary: this.generateSummaryFromContext(text),
            source_url: sourceUrl
          };
        }
      }
    }

    return null;
  }

  parseDiscography($, artist, sourceUrl) {
    const reviews = [];
    
    // Look for discography tables or lists
    $('table tr').each((i, elem) => {
      const $row = $(elem);
      const cells = $row.find('td');
      
      if (cells.length >= 3) {
        // Table format: Album | Year | Rating
        const album = cells.eq(0).text().trim();
        const year = parseInt(cells.eq(1).text().trim());
        const scoreText = cells.eq(2).text().trim();
        const score = parseFloat(scoreText);
        
        if (this.isValidReview({ artist, album, year, score })) {
          reviews.push({
            artist: artist,
            album: this.cleanString(album),
            year: year,
            score: score,
            summary: this.generateBasicSummary(album, score),
            source_url: sourceUrl
          });
        }
      }
    });

    return reviews;
  }

  extractRatingPatterns(html) {
    const reviews = [];
    
    // Look for structured rating data in the HTML
    const ratingRegex = /<[^>]*>([^<]+?)\s*\((\d{4})\)[^<]*?(\d+(?:\.\d+)?)[^<]*?<\/[^>]*>/g;
    let match;
    
    while ((match = ratingRegex.exec(html)) !== null) {
      const text = match[1].trim();
      const year = parseInt(match[2]);
      const score = parseFloat(match[3]);
      
      // Try to parse artist and album
      const parts = text.split(/[-:]/);
      if (parts.length >= 2) {
        const artist = parts[0].trim();
        const album = parts[1].trim();
        
        if (this.isValidReview({ artist, album, year, score })) {
          reviews.push({
            artist: this.cleanString(artist),
            album: this.cleanString(album),
            year: year,
            score: score,
            summary: this.generateBasicSummary(album, score),
            source_url: this.baseUrl
          });
        }
      }
    }
    
    return reviews;
  }

  isArtistLink(href) {
    // Identify links that lead to artist pages
    return href.match(/\/vol\d+\/[a-z]\/[^\/]+\.html$/) ||
           href.match(/\/[a-z]+\/[^\/]+\.html$/) ||
           href.includes('music') && href.endsWith('.html');
  }

  resolveUrl(href, baseUrl) {
    if (href.startsWith('http')) {
      return href;
    }
    if (href.startsWith('/')) {
      return `${this.baseUrl}${href}`;
    }
    return new URL(href, baseUrl).toString();
  }

  sampleLinks(links, maxCount) {
    if (links.length <= maxCount) {
      return links;
    }
    
    // Randomly sample links but prefer those with interesting names
    const scored = links.map(link => ({
      ...link,
      score: this.scoreLink(link)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxCount);
  }

  scoreLink(link) {
    let score = 0;
    const text = link.text.toLowerCase();
    const url = link.url.toLowerCase();
    
    // Prefer well-known artists
    const famousArtists = ['beatles', 'dylan', 'velvet', 'radiohead', 'nirvana', 'hendrix'];
    if (famousArtists.some(artist => text.includes(artist) || url.includes(artist))) {
      score += 10;
    }
    
    // Prefer links with substantial text
    if (text.length > 10) score += 2;
    if (text.length > 20) score += 2;
    
    // Prefer certain URL patterns
    if (url.includes('/vol')) score += 3;
    
    return score + Math.random(); // Add randomness
  }

  extractArtistName(url, $) {
    // Try to extract from URL first
    const urlMatch = url.match(/\/([^\/]+)\.html$/);
    if (urlMatch) {
      const name = urlMatch[1].replace(/[-_]/g, ' ');
      return this.capitalizeWords(name);
    }
    
    // Try to find in page title or heading
    const title = $('title').text();
    if (title && !title.includes('Scaruffi')) {
      return title.trim();
    }
    
    const h1 = $('h1').first().text();
    if (h1) {
      return h1.trim();
    }
    
    return 'Unknown Artist';
  }

  extractSummaryFromElement(element) {
    // Try to find nearby text that might be a summary
    const $elem = element;
    let summary = '';
    
    // Check next siblings for review text
    $elem.nextAll().slice(0, 3).each((i, sibling) => {
      const text = $(sibling).text().trim();
      if (text.length > 50 && text.length < 500 && !text.match(/^\d/)) {
        summary = text;
        return false; // Break
      }
    });
    
    if (!summary) {
      // Check parent element
      const parentText = $elem.parent().text().trim();
      if (parentText.length > 50 && parentText.length < 500) {
        summary = parentText;
      }
    }
    
    return summary || this.generateBasicSummary('this album');
  }

  generateSummaryFromContext(text) {
    // Extract meaningful sentences from surrounding text
    const sentences = text.split(/[.!?]+/);
    const meaningful = sentences.filter(s => 
      s.length > 30 && s.length < 200 &&
      (s.includes('album') || s.includes('music') || s.includes('sound'))
    );
    
    return meaningful.slice(0, 2).join('. ').trim() || 
           this.generateBasicSummary('this album');
  }

  generateBasicSummary(album, score) {
    const scoreDescriptions = {
      10: 'A perfect masterpiece',
      9: 'Outstanding and groundbreaking',
      8: 'Excellent and highly recommended',
      7: 'Very good with notable qualities',
      6: 'Good but with some limitations',
      5: 'Average or mixed quality',
      4: 'Below average',
      3: 'Poor quality',
      2: 'Very poor',
      1: 'Terrible'
    };
    
    if (score >= 8) {
      return `${scoreDescriptions[Math.floor(score)]} album that showcases exceptional artistic merit.`;
    } else if (score >= 6) {
      return `${scoreDescriptions[Math.floor(score)]} album with interesting musical ideas.`;
    } else {
      return `${scoreDescriptions[Math.floor(score)]} album according to Scaruffi's analysis.`;
    }
  }

  isValidReview(data) {
    return data.artist && data.album && 
           data.artist.length > 1 && data.album.length > 1 &&
           data.year >= 1950 && data.year <= new Date().getFullYear() + 1 &&
           data.score >= 0 && data.score <= 10;
  }

  cleanString(str) {
    return str
      .replace(/[^\w\s\-&'.,()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  capitalizeWords(str) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
  }

  async scrapeAllData() {
    logger.info('Starting comprehensive Scaruffi scrape');
    
    try {
      // Start with ratings page (most structured)
      const ratingsReviews = await this.scrapeRatingsPage();
      
      // Then scrape volume pages for more detailed reviews
      const volumeReviews = await this.scrapeVolumePages();
      
      const allReviews = [...ratingsReviews, ...volumeReviews];
      
      // Remove duplicates
      const uniqueReviews = this.removeDuplicates(allReviews);
      
      // Save to database
      for (const review of uniqueReviews) {
        try {
          await this.db.insertReview({
            ...review,
            reviewer: 'scaruffi',
            full_text: review.summary
          });
        } catch (error) {
          logger.warn('Error saving review:', error);
        }
      }
      
      logger.info(`Completed Scaruffi scrape: ${uniqueReviews.length} reviews`);
      return uniqueReviews;
    } catch (error) {
      logger.error('Scaruffi scraping failed:', error);
      throw error;
    } finally {
      await this.closeBrowser();
    }
  }

  removeDuplicates(reviews) {
    const seen = new Set();
    return reviews.filter(review => {
      const key = `${review.artist}_${review.album}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async searchArtistReviews(artistName) {
    // Search for specific artist reviews
    logger.info(`Searching for ${artistName} reviews`);
    
    try {
      // Try different URL patterns for the artist
      const searchUrls = this.buildArtistSearchUrls(artistName);
      let reviews = [];
      
      for (const url of searchUrls) {
        try {
          const artistReviews = await this.scrapeArtistPage(url);
          reviews.push(...artistReviews);
        } catch (error) {
          logger.debug(`Artist page not found: ${url}`);
        }
      }
      
      return this.removeDuplicates(reviews);
    } catch (error) {
      logger.error(`Error searching for ${artistName}:`, error);
      return [];
    }
  }

  buildArtistSearchUrls(artistName) {
    const cleanName = artistName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const firstLetter = cleanName[0] || 'a';
    
    return [
      `${this.baseUrl}/vol1/${firstLetter}/${cleanName}.html`,
      `${this.baseUrl}/vol2/${firstLetter}/${cleanName}.html`,
      `${this.baseUrl}/vol3/${firstLetter}/${cleanName}.html`,
      `${this.baseUrl}/vol4/${firstLetter}/${cleanName}.html`,
      `${this.baseUrl}/vol5/${firstLetter}/${cleanName}.html`
    ];
  }
}

module.exports = ScaruffiService;