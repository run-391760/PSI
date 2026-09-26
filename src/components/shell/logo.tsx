/** SynapseSEO mark: two nodes joined by a synapse arc. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#5b45e8" />
      <path d="M9 21c3-9 11-9 14-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="9" cy="21.5" r="3.2" fill="#fff" />
      <circle cx="23" cy="10.5" r="3.2" fill="#c7bfff" />
      <circle cx="16.5" cy="14.2" r="1.6" fill="#fff" opacity="0.85" />
    </svg>
  );
}
