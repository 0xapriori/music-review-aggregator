const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS and JSON parsing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.json());

// Mock review data - expanded dataset
const reviews = [
  { id: 1, reviewer: 'fantano', artist: 'Kendrick Lamar', album: 'good kid, m.A.A.d city', year: 2012, score: 9.0, summary: 'A modern hip-hop classic with incredible storytelling and production.' },
  { id: 2, reviewer: 'scaruffi', artist: 'Kendrick Lamar', album: 'good kid, m.A.A.d city', year: 2012, score: 7.5, summary: 'Recognizes artistic merit but more reserved in praise than mainstream critics.' },
  { id: 3, reviewer: 'fantano', artist: 'Radiohead', album: 'OK Computer', year: 1997, score: 10.0, summary: 'Perfect album - innovative production and prescient themes about technology.' },
  { id: 4, reviewer: 'scaruffi', artist: 'Radiohead', album: 'OK Computer', year: 1997, score: 8.5, summary: 'Important work but not as groundbreaking as often claimed.' },
  { id: 5, reviewer: 'fantano', artist: 'Kanye West', album: 'My Beautiful Dark Twisted Fantasy', year: 2010, score: 6.0, summary: 'Technically impressive but bloated and self-indulgent.' },
  { id: 6, reviewer: 'scaruffi', artist: 'Kanye West', album: 'My Beautiful Dark Twisted Fantasy', year: 2010, score: 6.5, summary: 'Shows creativity but lacks the depth of true artistic vision.' },
  { id: 7, reviewer: 'fantano', artist: 'Death Grips', album: 'The Money Store', year: 2012, score: 9.0, summary: 'Aggressive and innovative experimental hip-hop that pushes boundaries.' },
  { id: 8, reviewer: 'fantano', artist: 'Frank Ocean', album: 'Blonde', year: 2016, score: 8.5, summary: 'Gorgeous, introspective R&B with exceptional songwriting.' },
  { id: 9, reviewer: 'scaruffi', artist: 'Sonic Youth', album: 'Daydream Nation', year: 1988, score: 9.0, summary: 'Masterpiece of noise rock that influenced countless bands.' },
  { id: 10, reviewer: 'fantano', artist: 'Swans', album: 'To Be Kind', year: 2014, score: 9.5, summary: 'Monumental post-rock epic with incredible emotional depth.' }
];

// Utility functions
const filterReviews = (reviews, params) => {
  let filtered = [...reviews];
  
  if (params.artist) {
    filtered = filtered.filter(r => r.artist.toLowerCase().includes(params.artist.toLowerCase()));
  }
  
  if (params.album) {
    filtered = filtered.filter(r => r.album.toLowerCase().includes(params.album.toLowerCase()));
  }
  
  if (params.reviewer && params.reviewer !== 'all') {
    filtered = filtered.filter(r => r.reviewer === params.reviewer);
  }
  
  if (params.min_score) {
    filtered = filtered.filter(r => r.score >= parseFloat(params.min_score));
  }
  
  if (params.max_score) {
    filtered = filtered.filter(r => r.score <= parseFloat(params.max_score));
  }
  
  const limit = parseInt(params.limit) || filtered.length;
  return filtered.slice(0, limit);
};

const findOverlaps = () => {
  const grouped = {};
  reviews.forEach(review => {
    const key = `${review.artist}-${review.album}`;
    if (!grouped[key]) {
      grouped[key] = { artist: review.artist, album: review.album, year: review.year, reviewers: {} };
    }
    grouped[key].reviewers[review.reviewer] = { score: review.score, summary: review.summary };
  });
  
  return Object.values(grouped).filter(item => Object.keys(item.reviewers).length > 1);
};

// API Routes
app.get('/api/reviews', (req, res) => {
  const filtered = filterReviews(reviews, req.query);
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/all', (req, res) => {
  const filtered = filterReviews(reviews, req.query);
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/fantano', (req, res) => {
  const filtered = filterReviews(reviews.filter(r => r.reviewer === 'fantano'), req.query);
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/scaruffi', (req, res) => {
  const filtered = filterReviews(reviews.filter(r => r.reviewer === 'scaruffi'), req.query);
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/overlap', (req, res) => {
  const overlaps = findOverlaps();
  const filtered = req.query.artist ? 
    overlaps.filter(o => o.artist.toLowerCase().includes(req.query.artist.toLowerCase())) : 
    overlaps;
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/search/artist', (req, res) => {
  const { q } = req.query;
  const filtered = q ? reviews.filter(r => r.artist.toLowerCase().includes(q.toLowerCase())) : reviews;
  res.json({ success: true, data: filtered, count: filtered.length });
});

app.get('/api/reviews/stats', (req, res) => {
  const stats = {
    totalReviews: reviews.length,
    bySource: {
      fantano: reviews.filter(r => r.reviewer === 'fantano').length,
      scaruffi: reviews.filter(r => r.reviewer === 'scaruffi').length
    },
    overlappingReviews: findOverlaps().length,
    averageScores: {
      fantano: (reviews.filter(r => r.reviewer === 'fantano').reduce((sum, r) => sum + r.score, 0) / 
               reviews.filter(r => r.reviewer === 'fantano').length).toFixed(1),
      scaruffi: (reviews.filter(r => r.reviewer === 'scaruffi').reduce((sum, r) => sum + r.score, 0) / 
                reviews.filter(r => r.reviewer === 'scaruffi').length).toFixed(1)
    }
  };
  res.json({ success: true, data: stats });
});

app.get('/api/reviews/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files
app.use(express.static('public'));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎵 Music Review Aggregator running on port ${PORT}`);
  console.log(`📊 Loaded ${reviews.length} reviews`);
  console.log(`🔄 ${findOverlaps().length} overlapping albums found`);
});