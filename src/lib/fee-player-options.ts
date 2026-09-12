export type FeePlayerSearchOption = {
  id: string;
  displayName: string;
  outstandingMinor: number;
};

const playerCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function normalizeFeePlayerSearch(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}

export function sortFeePlayerOptions(options: readonly FeePlayerSearchOption[]) {
  return [...options].sort((left, right) => playerCollator.compare(left.displayName, right.displayName) || left.id.localeCompare(right.id));
}

export function filterFeePlayerOptions(options: readonly FeePlayerSearchOption[], query: string) {
  const normalizedQuery = normalizeFeePlayerSearch(query);
  if (!normalizedQuery) return [...options];
  return options.filter((option) => normalizeFeePlayerSearch(option.displayName).includes(normalizedQuery));
}
