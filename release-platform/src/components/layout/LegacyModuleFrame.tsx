import React, { useEffect, useMemo, useState } from 'react';
import type { ModuleDefinition } from '../../config/modules';
import { useSettings } from '../../context/SettingsContext';
import { buildLegacyModuleUrl } from '../../services/legacy';

export function LegacyModuleFrame({ module, refreshKey }: { module: ModuleDefinition; refreshKey: number }) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const src = useMemo(() => buildLegacyModuleUrl(module, settings), [module, settings]);

  useEffect(() => {
    setLoading(true);
    setError('');
  }, [src, refreshKey, module.id]);

  return (
    <div style={{
      position: 'relative',
      height: '100%',
      minHeight: 520,
      borderRadius: 24,
      overflow: 'hidden',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      boxShadow: '0 20px 60px rgba(0,0,0,.35)',
    }}>
      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
          color: 'var(--text-2)',
          fontSize: 13,
          zIndex: 2,
          backdropFilter: 'blur(8px)',
        }}>
          Загрузка модуля…
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          left: 16,
          padding: '12px 14px',
          borderRadius: 14,
          background: 'rgba(239,68,68,.12)',
          border: '1px solid rgba(239,68,68,.2)',
          color: '#FCA5A5',
          fontSize: 12,
          zIndex: 3,
        }}>
          {error}
        </div>
      )}

      <iframe
        key={`${module.id}:${refreshKey}:${src}`}
        title={module.label}
        src={src}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(`Не удалось загрузить ${module.label}`);
        }}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: 'var(--bg)',
        }}
      />
    </div>
  );
}
