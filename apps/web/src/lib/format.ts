export const formatNumber = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n));

/** Compact money without a currency symbol: values may mix currencies (spec §135 forbids silent conversion). */
export const formatAmount = (n: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.1 ? 1 : 0)}%`;
