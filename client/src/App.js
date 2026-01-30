import React, { useState, useEffect } from 'react';
import './App.css';
import SearchBar from './components/SearchBar';
import ReviewCard from './components/ReviewCard';
import FilterOptions from './components/FilterOptions';
import { API_BASE_URL } from './config';

function App() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState({
    artist: '',
    album: '',
    reviewer: 'all'
  });

  const fetchReviews = async (params) => {
    setLoading(true);
    try {
      let endpoint;
      if (params.reviewer === 'all') {
        endpoint = '/api/reviews/all';
      } else if (params.reviewer === 'overlap') {
        endpoint = '/api/reviews/overlap';
      } else {
        endpoint = `/api/reviews/${params.reviewer}`;
      }
      
      const queryParams = new URLSearchParams({
        ...(params.artist && { artist: params.artist }),
        ...(params.album && { album: params.album }),
        limit: 100
      });
      
      const response = await fetch(`${API_BASE_URL}${endpoint}?${queryParams}`);
      const result = await response.json();
      
      if (result.success) {
        setReviews(result.data);
      } else {
        console.error('API Error:', result.error);
        setReviews([]);
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
      setReviews([]);
    }
    setLoading(false);
  };

  const handleSearch = (params) => {
    setSearchParams(params);
    fetchReviews(params);
  };

  useEffect(() => {
    fetchReviews({ reviewer: 'all' });
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Music Review Aggregator</h1>
        <p>Anthony Fantano & Pierre Scaruffi Reviews</p>
      </header>
      
      <main className="App-main">
        <div className="search-section">
          <SearchBar onSearch={handleSearch} />
          <FilterOptions 
            currentFilter={searchParams.reviewer}
            onFilterChange={(reviewer) => handleSearch({...searchParams, reviewer})}
          />
        </div>
        
        <div className="results-section">
          {loading ? (
            <div className="loading">Loading reviews...</div>
          ) : (
            <div className="reviews-grid">
              {reviews.length > 0 ? (
                reviews.map((review, index) => (
                  <ReviewCard key={index} review={review} />
                ))
              ) : (
                <div className="no-results">No reviews found. Try adjusting your search criteria.</div>
              )}
            </div>
          )}
        </div>
      </main>
      
      <footer className="App-footer">
        <p>Aggregating reviews from Anthony Fantano (The Needle Drop) and Pierre Scaruffi</p>
      </footer>
    </div>
  );
}

export default App;
