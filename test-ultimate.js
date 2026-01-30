const UltimateScrapers = require('./scrapers/ultimateScrapers');
const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function testUltimateScraping() {
  console.log('🚀🚀🚀 ULTIMATE MODE: INSTANT 1000+ REVIEWS! 🚀🚀🚀');
  
  try {
    const db = new SimplifiedDatabase();
    await db.initialize();
    
    const scraper = new UltimateScrapers(db);
    
    const startTime = Date.now();
    const results = await scraper.ultimate1000ReviewScrape();
    const endTime = Date.now();
    
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n⚡ ULTIMATE PERFORMANCE:`);
    console.log(`   Time taken: ${duration.toFixed(1)} seconds`);
    console.log(`   Speed: ${(results.added / duration).toFixed(1)} reviews per second`);
    
    // Show final statistics
    const allReviews = db.getReviews({});
    const byReviewer = {};
    allReviews.forEach(r => {
      byReviewer[r.reviewer] = (byReviewer[r.reviewer] || 0) + 1;
    });
    
    console.log(`\n📊 FINAL REVIEWER BREAKDOWN:`);
    Object.entries(byReviewer).forEach(([reviewer, count]) => {
      console.log(`   ${reviewer.padEnd(12)}: ${count.toString().padStart(4)} reviews`);
    });
    
    // Check for overlaps
    const overlaps = db.getOverlappingReviews({});
    console.log(`\n🔗 Found ${overlaps.length} overlapping albums`);
    
    if (results.finalCount >= 1000) {
      console.log('\n🎉🎉🎉 MISSION ACCOMPLISHED! 🎉🎉🎉');
      console.log('✅ 1000+ REVIEWS ACHIEVED IN SECONDS!');
    } else {
      console.log(`\n📊 Almost there: ${results.finalCount}/1000 reviews`);
    }
    
    db.close();
    
  } catch (error) {
    console.error('❌ Ultimate scraping failed:', error);
  }
}

testUltimateScraping();