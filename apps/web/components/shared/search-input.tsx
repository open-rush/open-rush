'use client';

import { SearchIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchInput({
  placeholder = '搜索...',
  value,
  onChange,
  className = '',
}: SearchInputProps) {
  const [composing, setComposing] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
      if (!composing) onChange(e.target.value);
    },
    [composing, onChange]
  );

  return (
    <div className={`relative min-w-[200px] max-w-sm flex-1 ${className}`}>
      <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        value={composing ? localValue : value}
        onChange={handleChange}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          onChange((e.target as HTMLInputElement).value);
        }}
        className="h-9 w-full rounded-lg pl-9 pr-3 border-0 bg-muted text-sm shadow-none hover:bg-muted/80 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none transition-all duration-200"
      />
    </div>
  );
}
