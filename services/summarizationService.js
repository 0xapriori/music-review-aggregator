const natural = require('natural');
const compromise = require('compromise');
const { removeStopwords, eng } = require('stopword');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/summarization.log' })
  ]
});

class SummarizationService {
  constructor() {
    this.stemmer = natural.PorterStemmer;
    this.tokenizer = new natural.WordTokenizer();
    this.sentenceTokenizer = new natural.SentenceTokenizer();
    
    // Music-specific keywords for relevance scoring
    this.musicKeywords = [
      'album', 'track', 'song', 'music', 'sound', 'production', 'vocal', 'vocals',
      'guitar', 'bass', 'drums', 'piano', 'synthesizer', 'melody', 'rhythm',
      'beat', 'tempo', 'harmony', 'chord', 'verse', 'chorus', 'bridge',
      'recording', 'studio', 'mix', 'mastering', 'arrangement', 'composition',
      'performance', 'instrumentation', 'genre', 'style', 'influence',
      'lyrics', 'songwriting', 'artist', 'musician', 'band', 'singer'
    ];
    
    // Quality indicators for review content
    this.qualityIndicators = [
      'outstanding', 'excellent', 'brilliant', 'masterpiece', 'innovative',
      'groundbreaking', 'unique', 'creative', 'original', 'impressive',
      'disappointing', 'weak', 'poor', 'lacking', 'repetitive', 'boring',
      'generic', 'uninspired', 'cohesive', 'dynamic', 'atmospheric',
      'emotional', 'powerful', 'subtle', 'complex', 'sophisticated'
    ];
    
    // Fantano-specific phrases
    this.fantanoIndicators = [
      'feeling a', 'strong', 'decent', 'light', 'tran-', 'sition',
      'best teeth', 'worst teeth', 'needle drop', 'anthony fantano',
      'melon', 'thicc', 'boi'
    ];
  }

  summarizeTranscript(transcript, title = '', maxSentences = 3) {
    if (!transcript || transcript.length < 100) {
      return this.generateFallbackSummary(title);
    }

    try {
      // Clean and prepare text
      const cleanText = this.cleanTranscript(transcript);
      
      // Extract sentences
      const sentences = this.sentenceTokenizer.tokenize(cleanText);
      
      if (sentences.length <= maxSentences) {
        return sentences.join('. ').trim();
      }

      // Score sentences by relevance
      const scoredSentences = sentences.map(sentence => ({
        text: sentence,
        score: this.scoreSentence(sentence, title),
        length: sentence.length
      }));

      // Filter and sort sentences
      const filteredSentences = scoredSentences
        .filter(s => s.length > 30 && s.length < 300)
        .filter(s => this.isRelevantSentence(s.text))
        .sort((a, b) => b.score - a.score);

      // Select top sentences while maintaining variety
      const selectedSentences = this.selectDiverseSentences(filteredSentences, maxSentences);
      
      // Order by original position in text
      const orderedSentences = this.orderByPosition(selectedSentences, sentences);
      
      const summary = orderedSentences.map(s => s.text).join('. ').trim();
      
      return summary || this.generateFallbackSummary(title);
    } catch (error) {
      logger.error('Error summarizing transcript:', error);
      return this.generateFallbackSummary(title);
    }
  }

  cleanTranscript(transcript) {
    return transcript
      // Remove common YouTube auto-captions artifacts
      .replace(/\[Music\]/g, '')
      .replace(/\[Applause\]/g, '')
      .replace(/\[Laughter\]/g, '')
      
      // Remove repeated phrases common in spoken content
      .replace(/\b(um|uh|like|you know|so)\b/g, '')
      
      // Clean up spacing and punctuation
      .replace(/\s+/g, ' ')
      .replace(/([.!?])\s*([.!?])/g, '$1')
      .trim();
  }

  scoreSentence(sentence, title = '') {
    let score = 0;
    const sentenceLower = sentence.toLowerCase();
    const titleLower = title.toLowerCase();
    
    // Base score for sentence length (prefer moderate length)
    const length = sentence.length;
    if (length > 50 && length < 200) {
      score += 2;
    } else if (length > 200 && length < 300) {
      score += 1;
    }
    
    // Score for music-related keywords
    const musicScore = this.musicKeywords.reduce((acc, keyword) => {
      return acc + (sentenceLower.includes(keyword) ? 1 : 0);
    }, 0);
    score += musicScore * 2;
    
    // Score for quality indicators
    const qualityScore = this.qualityIndicators.reduce((acc, indicator) => {
      return acc + (sentenceLower.includes(indicator) ? 1 : 0);
    }, 0);
    score += qualityScore * 1.5;
    
    // Bonus for sentences that mention specific aspects
    if (sentenceLower.match(/\b(production|mix|sound|vocal|performance)\b/)) {
      score += 3;
    }
    
    // Bonus for sentences with scores or ratings
    if (sentenceLower.match(/\b(score|rating|\d+\/10|out of 10)\b/)) {
      score += 2;
    }
    
    // Penalty for Fantano-specific memes that don't add value
    const fantanoMemes = this.fantanoIndicators.reduce((acc, indicator) => {
      return acc + (sentenceLower.includes(indicator) ? 1 : 0);
    }, 0);
    score -= fantanoMemes * 0.5;
    
    // Bonus for sentences that relate to title
    if (title) {
      const titleWords = this.tokenizer.tokenize(titleLower);
      const sentenceWords = this.tokenizer.tokenize(sentenceLower);
      const overlap = titleWords.filter(word => sentenceWords.includes(word)).length;
      score += overlap * 0.5;
    }
    
    // Penalty for very common phrases
    const commonPhrases = [
      'hey everyone', 'anthony fantano here', 'what did you think',
      'let me know', 'in the comments', 'subscribe', 'like and subscribe'
    ];
    const commonPenalty = commonPhrases.reduce((acc, phrase) => {
      return acc + (sentenceLower.includes(phrase) ? 1 : 0);
    }, 0);
    score -= commonPenalty * 3;
    
    return score;
  }

  isRelevantSentence(sentence) {
    const sentenceLower = sentence.toLowerCase();
    
    // Must contain at least one music-related term
    const hasMusicTerm = this.musicKeywords.some(keyword => 
      sentenceLower.includes(keyword)
    );
    
    // Exclude pure introductory/outro sentences
    const excludePatterns = [
      /^(hey|hi|hello|what's up)/,
      /^(thanks for watching|see you next time|don't forget)/,
      /(subscribe|like|comment|notification bell)/,
      /^(so|well|anyway|alright),?\s/
    ];
    
    const shouldExclude = excludePatterns.some(pattern => 
      pattern.test(sentenceLower.trim())
    );
    
    return hasMusicTerm && !shouldExclude;
  }

  selectDiverseSentences(scoredSentences, maxSentences) {
    if (scoredSentences.length <= maxSentences) {
      return scoredSentences;
    }

    const selected = [];
    const usedTopics = new Set();
    
    // First pass: select highest scoring sentences from different topics
    for (const sentence of scoredSentences) {
      if (selected.length >= maxSentences) break;
      
      const topic = this.extractTopic(sentence.text);
      if (!usedTopics.has(topic)) {
        selected.push(sentence);
        usedTopics.add(topic);
      }
    }
    
    // Second pass: fill remaining slots with highest scoring
    if (selected.length < maxSentences) {
      for (const sentence of scoredSentences) {
        if (selected.length >= maxSentences) break;
        if (!selected.includes(sentence)) {
          selected.push(sentence);
        }
      }
    }
    
    return selected.slice(0, maxSentences);
  }

  extractTopic(sentence) {
    const sentenceLower = sentence.toLowerCase();
    
    if (sentenceLower.match(/\b(vocal|voice|singing)\b/)) return 'vocals';
    if (sentenceLower.match(/\b(production|mix|sound|recording)\b/)) return 'production';
    if (sentenceLower.match(/\b(lyric|word|message|story)\b/)) return 'lyrics';
    if (sentenceLower.match(/\b(instrument|guitar|drum|bass)\b/)) return 'instruments';
    if (sentenceLower.match(/\b(song|track|composition)\b/)) return 'songwriting';
    if (sentenceLower.match(/\b(album|record|release)\b/)) return 'album';
    if (sentenceLower.match(/\b(style|genre|influence)\b/)) return 'style';
    
    return 'general';
  }

  orderByPosition(selectedSentences, originalSentences) {
    return selectedSentences.sort((a, b) => {
      const indexA = originalSentences.indexOf(a.text);
      const indexB = originalSentences.indexOf(b.text);
      return indexA - indexB;
    });
  }

  generateFallbackSummary(title = '') {
    if (title) {
      const albumInfo = this.extractAlbumFromTitle(title);
      if (albumInfo) {
        return `Review discussion of ${albumInfo.album} by ${albumInfo.artist}.`;
      }
      return `Music review content from "${title}".`;
    }
    return 'Review content and analysis of the album.';
  }

  extractAlbumFromTitle(title) {
    // Parse common title formats for album info
    const patterns = [
      /^(.+?)\s*-\s*(.+?)\s+(?:ALBUM|EP|LP|MIXTAPE)?\s*REVIEW/i,
      /^(.+?)\s*:\s*(.+?)\s+REVIEW/i,
      /^(.+?)\s+by\s+(.+?)\s+REVIEW/i
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        if (pattern.source.includes('by')) {
          return { album: match[1].trim(), artist: match[2].trim() };
        } else {
          return { artist: match[1].trim(), album: match[2].trim() };
        }
      }
    }
    
    return null;
  }

  summarizeWithKeyPhrases(text, maxLength = 300) {
    try {
      // Use compromise for better NLP parsing
      const doc = compromise(text);
      
      // Extract key phrases about the music
      const musicPhrases = doc.match('#Adjective* #Noun+')
        .filter(phrase => {
          const text = phrase.text().toLowerCase();
          return this.musicKeywords.some(keyword => text.includes(keyword));
        })
        .out('array');

      // Extract sentiment phrases
      const sentimentPhrases = doc.match('#Adverb* #Adjective+')
        .filter(phrase => {
          const text = phrase.text().toLowerCase();
          return this.qualityIndicators.some(indicator => text.includes(indicator));
        })
        .out('array');

      // Combine and create summary
      const keyPhrases = [...new Set([...musicPhrases, ...sentimentPhrases])];
      
      if (keyPhrases.length > 0) {
        const summary = keyPhrases.slice(0, 3).join(', ');
        return this.truncateToLength(summary, maxLength);
      }
      
      return this.summarizeTranscript(text, '', 2);
    } catch (error) {
      logger.error('Error in key phrase summarization:', error);
      return this.summarizeTranscript(text, '', 2);
    }
  }

  truncateToLength(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  extractKeywords(text, maxKeywords = 10) {
    try {
      // Tokenize and clean
      let words = this.tokenizer.tokenize(text.toLowerCase());
      
      // Remove stop words
      words = removeStopwords(words, eng);
      
      // Calculate TF-IDF-like scores
      const wordFreq = {};
      words.forEach(word => {
        if (word.length > 3) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
      
      // Score words
      const scoredWords = Object.entries(wordFreq).map(([word, freq]) => {
        let score = freq;
        
        // Boost music-related terms
        if (this.musicKeywords.includes(word)) {
          score *= 2;
        }
        
        // Boost quality indicators
        if (this.qualityIndicators.includes(word)) {
          score *= 1.5;
        }
        
        return { word, score };
      });
      
      return scoredWords
        .sort((a, b) => b.score - a.score)
        .slice(0, maxKeywords)
        .map(item => item.word);
    } catch (error) {
      logger.error('Error extracting keywords:', error);
      return [];
    }
  }
}

module.exports = SummarizationService;