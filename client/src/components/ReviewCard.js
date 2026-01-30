import React from 'react';
import './ReviewCard.css';

const ReviewCard = ({ review }) => {
  const { artist, album, fantano_score, fantano_summary, scaruffi_score, scaruffi_summary, 
          year, source_url, overlap } = review;

  return (
    <div className={`review-card ${overlap ? 'overlap' : ''}`}>
      <div className="album-info">
        <h3>{artist}</h3>
        <h4>{album}</h4>
        {year && <span className="year">({year})</span>}
      </div>
      
      <div className="reviews-container">
        {fantano_score !== undefined && (
          <div className="review-section fantano">
            <div className="reviewer-header">
              <span className="reviewer-name">Anthony Fantano</span>
              <span className="score">{fantano_score}/10</span>
            </div>
            {fantano_summary && (
              <p className="summary">{fantano_summary}</p>
            )}
          </div>
        )}
        
        {scaruffi_score !== undefined && (
          <div className="review-section scaruffi">
            <div className="reviewer-header">
              <span className="reviewer-name">Pierre Scaruffi</span>
              <span className="score">{scaruffi_score}/10</span>
            </div>
            {scaruffi_summary && (
              <p className="summary">{scaruffi_summary}</p>
            )}
          </div>
        )}
      </div>
      
      {overlap && (
        <div className="overlap-indicator">
          <span>🎯 Both reviewers covered this album</span>
        </div>
      )}
      
      {source_url && (
        <div className="source-link">
          <a href={source_url} target="_blank" rel="noopener noreferrer">
            View Original Review
          </a>
        </div>
      )}
    </div>
  );
};

export default ReviewCard;