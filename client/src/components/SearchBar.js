import React, { useState } from 'react';
import './SearchBar.css';

const SearchBar = ({ onSearch }) => {
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch({ artist, album, reviewer: 'all' });
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <div className="search-inputs">
        <input
          type="text"
          placeholder="Artist name"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
        <input
          type="text"
          placeholder="Album name"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
        />
        <button type="submit">Search</button>
      </div>
    </form>
  );
};

export default SearchBar;