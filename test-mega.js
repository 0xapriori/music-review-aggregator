const MegaScrapers = require('./scrapers/megaScrapers');
const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function testMegaScraping() {
  console.log('🚀 MEGA MODE TEST - AIMING FOR 1000+ REVIEWS!');
  
  try {
    const db = new SimplifiedDatabase();
    await db.initialize();
    
    const scraper = new MegaScrapers(db);
    
    const startTime = Date.now();
    const results = await scraper.megaScrapeAll();
    const endTime = Date.now();
    
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n⏱️ Total time: ${duration.toFixed(1)} seconds`);
    console.log(`🚀 Speed: ${(results.total / duration).toFixed(1)} reviews per second`);
    
    // Show final statistics
    const allReviews = db.getReviews({});
    const byReviewer = {};
    allReviews.forEach(r => {
      byReviewer[r.reviewer] = (byReviewer[r.reviewer] || 0) + 1;
    });
    
    console.log(`\n📊 FINAL BREAKDOWN:`);
    Object.entries(byReviewer).forEach(([reviewer, count]) => {
      console.log(`   ${reviewer.padEnd(10)}: ${count} reviews`);
    });
    
    // Show some sample overlaps
    const overlaps = db.getOverlappingReviews({ limit: 10 });
    console.log(`\n🔗 Sample overlapping albums (${overlaps.length} total):`);
    overlaps.slice(0, 5).forEach(overlap => {
      console.log(`   🎼 ${overlap.artist} - ${overlap.album}`);
      console.log(`      Fantano: ${overlap.fantano_score}/10, Scaruffi: ${overlap.scaruffi_score}/10`);
    });
    
    db.close();
    
    if (results.finalCount >= 1000) {
      console.log('\n🎉🎉🎉 MISSION ACCOMPLISHED: 1000+ REVIEWS! 🎉🎉🎉');
    }
    
  } catch (error) {
    console.error('❌ Mega scraping failed:', error);
  }
}

testMegaScraping();