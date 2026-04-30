/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import { FiMusic } from 'react-icons/fi';

export function AudioPlayer({ file, getFileUrl }) {
  const audioRef = useRef(null);
  const loadVersionRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    loadVersionRef.current += 1;
    setPlaying(false);
    return () => {
      if (audioRef.current) {
        audioRef.current.src = '';
        audioRef.current.load();
      }
    };
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        className="mv-audio-card"
        style={{
          padding: '32px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          minWidth: 340,
          maxWidth: 480,
          width: '100%',
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 'var(--r-xl)',
            background: 'linear-gradient(135deg, #fce7f3, #fbcfe8)',
            color: '#9d174d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
          }}
        >
          <FiMusic size={36} />
        </div>

        {/* Waveform visualization (decorative) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 4,
            height: 40,
            width: '100%',
          }}
        >
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className={playing ? 'mv-audio-bar' : ''}
              style={{
                width: 4,
                height: `${(Math.sin(i * 0.7) + 1.2) * 14 + 6}px`,
                background: playing ? 'var(--accent)' : 'var(--border-strong)',
                animationDelay: `${i * 60}ms`,
                transition: 'background 200ms',
              }}
            />
          ))}
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textAlign: 'center', wordBreak: 'break-word' }}>
          {file.name}
        </div>

        <audio
          ref={audioRef}
          src={getFileUrl(file, 'audio')}
          controls
          autoPlay
          style={{ width: '100%' }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadStart={() => {
            if (loadVersionRef.current !== currentVersion) {
              audioRef.current.pause();
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
