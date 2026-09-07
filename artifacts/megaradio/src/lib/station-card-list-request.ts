/** Card/search lists do not consume articles; other API clients keep full records. */
export function fetchStationCardList(params: URLSearchParams, init?: RequestInit): Promise<Response> {
  const compactParams = new URLSearchParams(params);
  compactParams.set('slim', '1');
  return fetch(`/api/stations?${compactParams}`, init);
}
