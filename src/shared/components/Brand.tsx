interface BrandProps {
  showName?: boolean;
}

export function Brand({ showName = true }: BrandProps) {
  return (
    <div className="brand" aria-label="BlinkBreak">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M3.7 16c3.2-5.3 7.3-8 12.3-8s9.1 2.7 12.3 8c-3.2 5.3-7.3 8-12.3 8S6.9 21.3 3.7 16Z"
            fill="currentColor"
          />
          <circle cx="16" cy="16" r="5.2" fill="var(--accent)" />
          <path d="M14 13.5v5M18 13.5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
      {showName && <span className="brand-name">BlinkBreak</span>}
    </div>
  );
}
