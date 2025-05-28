// src/components/AdBanner.tsx
import React from 'react';

export interface AdBannerProps {
  side: 'left' | 'right';
  imageUrl?: string;
  href?: string;
}

export const AdBanner: React.FC<AdBannerProps> = ({ side, imageUrl, href }) => {
  if (!imageUrl) return null;
  return (
    <div
      style={{
        zIndex: 9999,
        position: 'fixed',
        [side]: 0,
        top: 0,
        height: '100vh',
        width: '210px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        cursor: href ? 'pointer' : 'default'
      }}
      onClick={() => href && window.open(href, '_blank')}
      className="hidden lg:flex"
    >
      <img
        src={imageUrl}
        alt={`Banner ${side}`}
        style={{
          maxWidth: '90%',
          maxHeight: '90%',
          objectFit: 'contain',
          borderRadius: 8,
        }}
        onError={e => (e.currentTarget.style.display = 'none')}
      />
    </div>
  );
};
