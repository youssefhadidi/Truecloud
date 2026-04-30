'use client';

import { useState } from 'react';

export default function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  suffix,
  prefix,
  autoFocus,
  disabled,
  readOnly,
  name,
  id,
  required,
  autoComplete,
  onKeyDown,
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-2)',
            marginBottom: 6,
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--surface-2)',
          border: `1.5px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--r-md)',
          padding: '0 12px',
          transition: 'border 150ms',
          boxShadow: focused ? '0 0 0 3px var(--accent-light)' : 'none',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {prefix}
        <input
          id={id}
          name={name}
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          autoComplete={autoComplete}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            padding: '10px 0',
            outline: 'none',
            color: 'var(--text)',
            fontFamily: 'inherit',
            minWidth: 0,
          }}
        />
        {suffix}
      </div>
    </div>
  );
}
