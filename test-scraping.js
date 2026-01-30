const SimplifiedScrapers = require('./scrapers/simplifiedScrapers');
const SimplifiedDatabase = require('./database/simplifiedDatabase');

async function testScraping() {
  console.log('🚀 Testing real scraping functionality...');
  
  try {
    // Initialize database
    const db = new SimplifiedDatabase();
    await db.initialize();
    
    // Initialize scraper
    const scraper = new SimplifiedScrapers(db);
    
    console.log('📊 Current review count:', db.getReviews({}).length);
    
    // Test Scaruffi scraping
    console.log('\n🎼 Scraping Scaruffi reviews...');
    const scaruffiResults = await scraper.scrapeScaruffi();
    console.log(`✅ Scraped ${scaruffiResults.length} Scaruffi reviews`);
    
    // Test Fantano scraping  
    console.log('\n📺 Scraping Fantano reviews...');
    const fantanoResults = await scraper.scrapeFantanoRSS();
    console.log(`✅ Scraped ${fantanoResults.length} Fantano reviews`);
    
    // Show final stats
    const finalCount = db.getReviews({}).length;
    console.log(`\n🎯 Final review count: ${finalCount}`);
    console.log(`📈 Added ${finalCount - 10} new real reviews!`);
    
    // Show some sample results
    const allReviews = db.getReviews({ limit: 20 });
    console.log('\n🎵 Sample reviews:');
    allReviews.slice(0, 5).forEach(review => {
      console.log(`  - ${review.artist} - ${review.album} (${review.year}) - ${review.score}/10 by ${review.reviewer}`);
    });
    
    db.close();
    
  } catch (error) {
    console.error('❌ Scraping test failed:', error);
  }
}

testScraping();