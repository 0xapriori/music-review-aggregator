const RealScrapers = require('./scrapers/realScrapers');
const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function testRealScraping() {
  console.log('🎯 Testing REAL scraping functionality...');
  
  try {
    // Initialize database
    const db = new SimplifiedDatabase();
    await db.initialize();
    
    // Initialize scraper
    const scraper = new RealScrapers(db);
    
    console.log('📊 Current review count:', db.getReviews({}).length);
    
    // Test full scraping
    console.log('\n🚀 Running full scraping...');
    const results = await scraper.scrapeAll();
    
    console.log(`✅ Scraping complete!`);
    console.log(`📺 Fantano: ${results.fantano.length} reviews`);
    console.log(`📚 Scaruffi: ${results.scaruffi.length} reviews`);
    console.log(`🎯 Total new: ${results.total} reviews`);
    
    // Show final stats
    const finalReviews = db.getReviews({});
    console.log(`\n📈 Final database count: ${finalReviews.length} total reviews`);
    
    // Show some examples
    console.log('\n🎵 Sample of new reviews:');
    const newReviews = finalReviews.filter(r => r.scraped_at).slice(0, 8);
    newReviews.forEach(review => {
      console.log(`  ${review.reviewer.padEnd(8)} | ${review.artist} - ${review.album} (${review.year}) - ${review.score}/10`);
    });
    
    // Show overlaps
    const overlaps = db.getOverlappingReviews({});
    console.log(`\n🔗 Found ${overlaps.length} overlapping albums reviewed by both critics`);
    overlaps.forEach(overlap => {
      console.log(`  🎼 ${overlap.artist} - ${overlap.album}: Fantano ${overlap.fantano_score}/10, Scaruffi ${overlap.scaruffi_score}/10`);
    });
    
    db.close();
    console.log('\n✨ Real scraping test complete!');
    
  } catch (error) {
    console.error('❌ Real scraping test failed:', error.message);
  }
}

testRealScraping();