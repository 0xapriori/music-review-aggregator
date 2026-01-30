const TurboScrapers = require('./scrapers/turboScrapers');
const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function testTurboScraping() {
  console.log('🚀 TESTING TURBO MODE - MAXIMUM SPEED!');
  
  try {
    const db = new SimplifiedDatabase();
    await db.initialize();
    
    const scraper = new TurboScrapers(db);
    
    const startCount = db.getReviews({}).length;
    console.log(`📊 Starting with: ${startCount} reviews`);
    
    const startTime = Date.now();
    
    console.log('\n🔥 TURBO MODE ACTIVATED - GOING FULL SPEED!');
    const results = await scraper.turboScrapeAll();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    const finalCount = db.getReviews({}).length;
    const added = finalCount - startCount;
    
    console.log(`\n🎯 TURBO RESULTS:`);
    console.log(`⚡ Time taken: ${duration.toFixed(1)} seconds`);
    console.log(`📈 Reviews added: ${added}`);
    console.log(`📊 Total reviews: ${finalCount}`);
    console.log(`🚀 Speed: ${(added / duration).toFixed(1)} reviews per second`);
    console.log(`📺 Fantano: ${results.fantano.length} reviews`);
    console.log(`📚 Scaruffi: ${results.scaruffi.length} reviews`);
    
    // Show some examples
    console.log('\n🎵 Sample new reviews:');
    const newReviews = db.getReviews({}).filter(r => r.scraped_at).slice(0, 15);
    newReviews.forEach((review, i) => {
      console.log(`  ${String(i+1).padStart(2)}. ${review.reviewer.padEnd(8)} | ${review.artist} - ${review.album} (${review.year}) - ${review.score}/10`);
    });
    
    // Project to 1000
    const remaining = Math.max(0, 1000 - finalCount);
    const timeToReach1000 = remaining / (added / duration);
    
    console.log(`\n📈 PROJECTION TO 1000 REVIEWS:`);
    console.log(`   Remaining needed: ${remaining}`);
    console.log(`   At this rate: ${(timeToReach1000 / 60).toFixed(1)} minutes`);
    
    if (finalCount >= 1000) {
      console.log('\n🎉 WE DID IT! 1000+ REVIEWS ACHIEVED!');
    }
    
    db.close();
    
  } catch (error) {
    console.error('❌ Turbo test failed:', error.message);
  }
}

testTurboScraping();