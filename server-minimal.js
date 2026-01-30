const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for GitHub Pages
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json());

// Sample review data
const reviews = [
  {
    id: 1,
    reviewer: 'fantano',
    artist: 'Kendrick Lamar',
    album: 'good kid, m.A.A.d city',
    year: 2012,
    score: 9.0,
    summary: 'Fantano praised this as a modern hip-hop classic with incredible storytelling.',
    source_url: 'https://youtube.com/watch?v=abc123'
  },
  {
    id: 2,
    reviewer: 'scaruffi',
    artist: 'Kendrick Lamar',
    album: 'good kid, m.A.A.d city',
    year: 2012,
    score: 7.5,
    summary: 'Scaruffi recognized the artistic merit but was more reserved in his praise.',
    source_url: 'https://scaruffi.com/vol5/lamar.html'
  },
  {
    id: 3,
    reviewer: 'fantano',
    artist: 'Radiohead',
    album: 'OK Computer',
    year: 1997,
    score: 10.0,
    summary: 'Perfect album - innovative production and prescient themes.',
    source_url: 'https://youtube.com/watch?v=def456'
  }
];

// API routes that match frontend expectations
app.get('/api/reviews', (req, res) => {
  res.json({
    reviews: reviews,
    total: reviews.length
  });
});

app.get('/api/reviews/all', (req, res) => {
  res.json({
    reviews: reviews,
    total: reviews.length
  });
});

app.get('/api/reviews/fantano', (req, res) => {
  const fantanoReviews = reviews.filter(r => r.reviewer === 'fantano');
  res.json({
    reviews: fantanoReviews,
    total: fantanoReviews.length
  });
});

app.get('/api/reviews/scaruffi', (req, res) => {
  const scaruffiReviews = reviews.filter(r => r.reviewer === 'scaruffi');
  res.json({
    reviews: scaruffiReviews,
    total: scaruffiReviews.length
  });
});

app.get('/api/reviews/overlap', (req, res) => {
  const overlaps = {};
  reviews.forEach(review => {
    const key = `${review.artist}-${review.album}`;
    if (!overlaps[key]) {
      overlaps[key] = {
        artist: review.artist,
        album: review.album,
        year: review.year,
        reviewers: {}
      };
    }
    overlaps[key].reviewers[review.reviewer] = {
      score: review.score,
      summary: review.summary
    };
  });
  
  const overlapArray = Object.values(overlaps).filter(item => 
    Object.keys(item.reviewers).length > 1
  );
  
  res.json({
    overlaps: overlapArray,
    total: overlapArray.length
  });
});

app.get('/api/reviews/stats', (req, res) => {
  const stats = {
    total: reviews.length,
    by_reviewer: {
      fantano: reviews.filter(r => r.reviewer === 'fantano').length,
      scaruffi: reviews.filter(r => r.reviewer === 'scaruffi').length
    },
    overlaps: Object.values(reviews.reduce((acc, review) => {
      const key = `${review.artist}-${review.album}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(review);
      return acc;
    }, {})).filter(group => group.length > 1).length
  };
  res.json(stats);
});

app.get('/api/reviews/search/artist', (req, res) => {
  const { q } = req.query;
  const filtered = q ? reviews.filter(r => 
    r.artist.toLowerCase().includes(q.toLowerCase())
  ) : reviews;
  res.json({
    reviews: filtered,
    total: filtered.length
  });
});

app.get('/api/reviews/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Minimal server running on port ${PORT}`);
});