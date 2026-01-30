const { google } = require('googleapis');
const axios = require('axios');
const { YoutubeTranscript } = require('youtube-transcript');
const ytdl = require('ytdl-core');
const winston = require('winston');
const pLimit = require('p-limit');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/youtube.log' })
  ]
});

class YouTubeService {
  constructor(database) {
    this.db = database;
    this.youtube = null;
    this.apiKey = process.env.YOUTUBE_API_KEY;
    this.limit = pLimit(2); // Limit concurrent requests
    
    if (this.apiKey) {
      this.youtube = google.youtube({
        version: 'v3',
        auth: this.apiKey
      });
    }

    // The Needle Drop channel ID
    this.fantanoChannelId = 'UCt7fwAhXDy3oNFTAzF2o8Pw';
    
    // Keywords that indicate album reviews
    this.albumReviewKeywords = [
      'album review', 'ep review', 'lp review', 'mixtape review',
      'track review', 'single review', 'classic review'
    ];
    
    // Keywords to exclude (not music reviews)
    this.excludeKeywords = [
      'weekly track roundup', 'meme review', 'reaction',
      'interview', 'let\'s argue', 'best teeth', 'worst teeth'
    ];
  }

  async getChannelVideos(maxResults = 200) {
    if (!this.youtube) {
      logger.warn('YouTube API not configured, using fallback method');
      return this.getVideosWithoutAPI();
    }

    try {
      const videos = [];
      let pageToken = null;
      
      do {
        const response = await this.youtube.search.list({
          part: 'snippet',
          channelId: this.fantanoChannelId,
          maxResults: Math.min(50, maxResults - videos.length),
          order: 'date',
          type: 'video',
          pageToken: pageToken
        });

        for (const item of response.data.items) {
          if (this.isAlbumReview(item.snippet.title, item.snippet.description)) {
            videos.push({
              videoId: item.id.videoId,
              title: item.snippet.title,
              description: item.snippet.description,
              publishedAt: item.snippet.publishedAt,
              thumbnails: item.snippet.thumbnails
            });
          }
        }

        pageToken = response.data.nextPageToken;
      } while (pageToken && videos.length < maxResults);

      logger.info(`Found ${videos.length} album review videos`);
      return videos;
    } catch (error) {
      logger.error('Error fetching channel videos:', error);
      return [];
    }
  }

  async getVideosWithoutAPI() {
    // Fallback method using RSS feed or web scraping
    try {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${this.fantanoChannelId}`;
      const response = await axios.get(rssUrl);
      
      // Parse RSS XML and extract video information
      const videoIds = this.parseRSSForVideoIds(response.data);
      
      const videos = [];
      for (const videoId of videoIds.slice(0, 50)) {
        try {
          const videoInfo = await this.getVideoInfo(videoId);
          if (videoInfo && this.isAlbumReview(videoInfo.title, videoInfo.description)) {
            videos.push(videoInfo);
          }
        } catch (error) {
          logger.warn(`Could not fetch info for video ${videoId}:`, error.message);
        }
      }
      
      return videos;
    } catch (error) {
      logger.error('Fallback video fetching failed:', error);
      return [];
    }
  }

  parseRSSForVideoIds(rssXml) {
    const videoIds = [];
    const entryPattern = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
    let match;
    
    while ((match = entryPattern.exec(rssXml)) !== null) {
      videoIds.push(match[1]);
    }
    
    return videoIds;
  }

  async getVideoInfo(videoId) {
    try {
      const info = await ytdl.getInfo(videoId);
      return {
        videoId: videoId,
        title: info.videoDetails.title,
        description: info.videoDetails.description,
        publishedAt: info.videoDetails.publishDate,
        duration: parseInt(info.videoDetails.lengthSeconds),
        viewCount: parseInt(info.videoDetails.viewCount),
        channelId: info.videoDetails.channelId
      };
    } catch (error) {
      logger.warn(`Could not get info for video ${videoId}:`, error.message);
      return null;
    }
  }

  isAlbumReview(title, description = '') {
    const titleLower = title.toLowerCase();
    const descLower = (description || '').toLowerCase();
    
    // Check if it contains album review keywords
    const hasReviewKeywords = this.albumReviewKeywords.some(keyword => 
      titleLower.includes(keyword)
    );
    
    // Check if it should be excluded
    const shouldExclude = this.excludeKeywords.some(keyword => 
      titleLower.includes(keyword)
    );
    
    // Additional patterns for Fantano's style
    const fantanoPatterns = [
      /- .*?(album|ep|lp|mixtape)/i,
      /\b(album|ep|lp) review\b/i,
      /\b\d+\/10\b/,
      /\bstrong \d+\b/i,
      /\blight \d+\b/i,
      /\bdecent \d+\b/i
    ];
    
    const hasFantanoPattern = fantanoPatterns.some(pattern => 
      pattern.test(titleLower) || pattern.test(descLower)
    );
    
    return (hasReviewKeywords || hasFantanoPattern) && !shouldExclude;
  }

  async getTranscript(videoId, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        return transcript.map(item => item.text).join(' ');
      } catch (error) {
        logger.warn(`Transcript attempt ${i + 1} failed for ${videoId}:`, error.message);
        if (i === retries - 1) {
          throw error;
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  async processVideo(videoData) {
    try {
      // Check if already processed
      const existing = await this.db.get(
        'SELECT id FROM youtube_videos WHERE video_id = ?',
        [videoData.videoId]
      );

      if (existing) {
        logger.debug(`Video ${videoData.videoId} already processed`);
        return null;
      }

      // Get transcript
      let transcript = '';
      try {
        transcript = await this.getTranscript(videoData.videoId);
        logger.info(`Got transcript for ${videoData.videoId}: ${transcript.length} characters`);
      } catch (error) {
        logger.warn(`No transcript for ${videoData.videoId}:`, error.message);
      }

      // Save video data
      await this.db.insertYouTubeVideo({
        ...videoData,
        transcript: transcript
      });

      // Extract review information
      const reviewData = this.extractReviewData(videoData, transcript);
      
      if (reviewData) {
        // Save review
        await this.db.insertReview({
          ...reviewData,
          reviewer: 'fantano',
          source_url: `https://www.youtube.com/watch?v=${videoData.videoId}`,
          video_id: videoData.videoId
        });
        
        logger.info(`Processed review: ${reviewData.artist} - ${reviewData.album}`);
        return reviewData;
      }

      return null;
    } catch (error) {
      logger.error(`Error processing video ${videoData.videoId}:`, error);
      return null;
    }
  }

  extractReviewData(videoData, transcript) {
    const title = videoData.title;
    const description = videoData.description || '';
    
    // Extract artist and album from title
    const albumInfo = this.parseAlbumInfo(title);
    if (!albumInfo) {
      logger.debug(`Could not parse album info from: ${title}`);
      return null;
    }

    // Extract score from transcript and title
    const score = this.extractScore(transcript, title, description);
    
    // Generate summary from transcript
    const summary = this.generateSummary(transcript, title);
    
    // Extract year
    const year = this.extractYear(title, description, videoData.publishedAt);

    return {
      artist: albumInfo.artist,
      album: albumInfo.album,
      year: year,
      score: score,
      summary: summary,
      full_text: transcript
    };
  }

  parseAlbumInfo(title) {
    // Common Fantano title patterns:
    // "Artist - Album ALBUM REVIEW"
    // "Artist - Album EP REVIEW"
    // "Album by Artist REVIEW"
    
    const patterns = [
      /^(.+?)\s*-\s*(.+?)\s+(?:ALBUM|EP|LP|MIXTAPE)\s+REVIEW/i,
      /^(.+?)\s*-\s*(.+?)\s+REVIEW/i,
      /^(.+?)\s+by\s+(.+?)\s+REVIEW/i,
      /^(.+?):\s*(.+?)\s+(?:ALBUM|EP|LP|MIXTAPE)\s+REVIEW/i,
      /^(.+?)\s*–\s*(.+?)\s+(?:ALBUM|EP|LP|MIXTAPE)\s+REVIEW/i
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        let artist, album;
        
        if (pattern.source.includes('by')) {
          // "Album by Artist" format
          album = match[1].trim();
          artist = match[2].trim();
        } else {
          // "Artist - Album" format
          artist = match[1].trim();
          album = match[2].trim();
        }
        
        return {
          artist: this.cleanString(artist),
          album: this.cleanString(album)
        };
      }
    }

    return null;
  }

  extractScore(transcript, title, description) {
    const text = `${title} ${description} ${transcript}`.toLowerCase();
    
    // Fantano's scoring patterns
    const scorePatterns = [
      /(?:i'm feeling a|i give this|rating of|score of)\s*(?:a\s*)?(?:strong|decent|light)?\s*(\d+)(?:\s*out of 10|\/10)/i,
      /(?:strong|decent|light)\s+(\d+)/i,
      /(\d+)(?:\s*out of 10|\/10)/i,
      /i'm feeling a (?:strong\s+)?(\d+)/i,
      /(?:this is a|it's a)\s*(?:strong\s+)?(\d+)/i
    ];

    for (const pattern of scorePatterns) {
      const match = text.match(pattern);
      if (match) {
        const score = parseInt(match[1]);
        if (score >= 0 && score <= 10) {
          // Check for modifiers
          if (text.includes('strong')) {
            return score + 0.3;
          } else if (text.includes('light')) {
            return score - 0.3;
          } else if (text.includes('decent')) {
            return score;
          }
          return score;
        }
      }
    }

    return null;
  }

  generateSummary(transcript, title) {
    if (!transcript || transcript.length < 100) {
      return this.generateTitleSummary(title);
    }

    // Find key sentences about the album
    const sentences = transcript.split(/[.!?]+/);
    const keySentences = [];

    // Look for sentences containing important keywords
    const keywordSets = [
      ['album', 'sound', 'music'],
      ['production', 'mix', 'mastering'],
      ['lyrics', 'vocal', 'performance'],
      ['track', 'song', 'standout'],
      ['overall', 'conclusion', 'final']
    ];

    for (const keywords of keywordSets) {
      const sentence = sentences.find(s => 
        keywords.some(keyword => s.toLowerCase().includes(keyword)) &&
        s.length > 20 && s.length < 200
      );
      
      if (sentence && !keySentences.includes(sentence.trim())) {
        keySentences.push(sentence.trim());
      }
    }

    if (keySentences.length > 0) {
      return keySentences.slice(0, 3).join('. ').trim();
    }

    // Fallback: use first substantial sentences
    const substantialSentences = sentences.filter(s => 
      s.length > 30 && s.length < 200 && 
      !s.toLowerCase().includes('hey everyone') &&
      !s.toLowerCase().includes('anthony fantano')
    );

    return substantialSentences.slice(0, 2).join('. ').trim();
  }

  generateTitleSummary(title) {
    // Generate a basic summary from the title
    if (title.toLowerCase().includes('review')) {
      return `Anthony Fantano's review of this album from his video "${title}".`;
    }
    return `Review content extracted from "${title}".`;
  }

  extractYear(title, description, publishedAt) {
    // Look for year in title or description
    const text = `${title} ${description}`;
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    
    if (yearMatch) {
      return parseInt(yearMatch[0]);
    }
    
    // Fallback to published year
    if (publishedAt) {
      return new Date(publishedAt).getFullYear();
    }
    
    return null;
  }

  cleanString(str) {
    return str
      .replace(/[^\w\s\-&']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async scrapeLatestReviews(maxVideos = 50) {
    logger.info(`Starting YouTube scrape for ${maxVideos} videos`);
    
    try {
      const videos = await this.getChannelVideos(maxVideos);
      const results = [];
      
      // Process videos with rate limiting
      for (const video of videos) {
        const result = await this.limit(() => this.processVideo(video));
        if (result) {
          results.push(result);
        }
        
        // Small delay between processing
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      logger.info(`Scraped ${results.length} reviews from ${videos.length} videos`);
      return results;
    } catch (error) {
      logger.error('YouTube scraping failed:', error);
      throw error;
    }
  }
}

module.exports = YouTubeService;