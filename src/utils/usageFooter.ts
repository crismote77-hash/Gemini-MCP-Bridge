function formatUsd(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.replace(/\.?0+$/, "");
}

export function formatUsageFooter(
  requestTokens: number,
  usage: { usedTokens: number; maxTokens: number; estimatedCostUsd?: number },
  opts: { requestEstimatedCostUsd?: number } = {},
): string {
  const parts = [
    `[usage] request_tokens=${requestTokens}`,
    `day_used=${usage.usedTokens}`,
    `day_limit=${usage.maxTokens}`,
  ];
  if (
    typeof opts.requestEstimatedCostUsd === "number" &&
    Number.isFinite(opts.requestEstimatedCostUsd)
  ) {
    parts.push(
      `request_est_cost_usd=${formatUsd(opts.requestEstimatedCostUsd)}`,
    );
  }
  if (
    typeof usage.estimatedCostUsd === "number" &&
    Number.isFinite(usage.estimatedCostUsd)
  ) {
    parts.push(`day_est_cost_usd=${formatUsd(usage.estimatedCostUsd)}`);
  }
  return parts.join(" ");
}
