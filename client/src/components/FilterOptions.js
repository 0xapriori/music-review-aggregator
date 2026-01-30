import React from 'react';
import './FilterOptions.css';

const FilterOptions = ({ currentFilter, onFilterChange }) => {
  return (
    <div className="filter-options">
      <label>Show reviews from:</label>
      <div className="filter-buttons">
        <button 
          className={currentFilter === 'all' ? 'active' : ''}
          onClick={() => onFilterChange('all')}
        >
          Both Reviewers
        </button>
        <button 
          className={currentFilter === 'fantano' ? 'active' : ''}
          onClick={() => onFilterChange('fantano')}
        >
          Anthony Fantano
        </button>
        <button 
          className={currentFilter === 'scaruffi' ? 'active' : ''}
          onClick={() => onFilterChange('scaruffi')}
        >
          Pierre Scaruffi
        </button>
        <button 
          className={currentFilter === 'overlap' ? 'active' : ''}
          onClick={() => onFilterChange('overlap')}
        >
          Overlap Only
        </button>
      </div>
    </div>
  );
};

export default FilterOptions;