const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function quickSetup() {
  console.log('🚀 Quick setup: Loading database with reviews...');
  
  const db = new SimplifiedDatabase();
  await db.initialize();
  
  // Add sample reviews for demo
  const sampleReviews = [
    {
      reviewer: 'fantano',
      artist: 'Kendrick Lamar',
      album: 'good kid, m.A.A.d city',
      year: 2012,
      score: 9.0,
      summary: 'Fantano praised this as a modern hip-hop classic with incredible storytelling.',
      source_url: 'https://youtube.com/watch?v=abc123',
      full_text: 'Detailed review of good kid, m.A.A.d city...',
      scraped_at: new Date().toISOString()
    },
    {
      reviewer: 'scaruffi',
      artist: 'Kendrick Lamar',
      album: 'good kid, m.A.A.d city',
      year: 2012,
      score: 7.5,
      summary: 'Scaruffi recognized the artistic merit but was more reserved in his praise.',
      source_url: 'https://scaruffi.com/vol5/lamar.html',
      full_text: 'Scaruffi analysis of Kendrick Lamar...',
      scraped_at: new Date().toISOString()
    },
    {
      reviewer: 'fantano',
      artist: 'Radiohead',
      album: 'OK Computer',
      year: 1997,
      score: 10.0,
      summary: 'Perfect album - innovative production and prescient themes.',
      source_url: 'https://youtube.com/watch?v=def456',
      full_text: 'Fantano review of OK Computer...',
      scraped_at: new Date().toISOString()
    },
    {
      reviewer: 'pitchfork',
      artist: 'Radiohead',
      album: 'OK Computer',
      year: 1997,
      score: 9.8,
      summary: 'Pitchfork called it a masterpiece of alternative rock.',
      source_url: 'https://pitchfork.com/reviews/albums/radiohead-ok-computer/',
      full_text: 'Pitchfork review of OK Computer...',
      scraped_at: new Date().toISOString()
    }
  ];
  
  // Add samples
  for (const review of sampleReviews) {
    db.insertReview(review);
  }
  
  const totalReviews = db.getReviews({}).length;
  console.log(`✅ Database ready with ${totalReviews} reviews`);
  
  // Show overlaps
  const overlaps = db.getOverlappingReviews({});
  console.log(`🔗 Found ${overlaps.length} overlapping albums`);
  
  db.close();
}

quickSetup().catch(console.error);