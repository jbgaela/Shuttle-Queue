export function singleFlightByKey<T>(flights: Map<string, Promise<T>>, key: string, task: () => Promise<T>) {
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = task().finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
}
