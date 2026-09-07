import { useCallback, useEffect, useState, type SetStateAction } from 'react';

interface RelatedStation { _id: string; country?: string; tags?: string; [key: string]: any }
interface ListState { scope: string; stations: RelatedStation[]; loading: boolean; total: number }
const emptyStations: RelatedStation[] = [];

export function useStationRelatedStations(station: RelatedStation | undefined, targetCountry?: string, routeIdentity?: string) {
  const id = station?._id;
  const country = station?.country;
  const tags = station?.tags;
  const similarScope = JSON.stringify([routeIdentity, id, targetCountry, tags]);
  const countryScope = JSON.stringify([routeIdentity, id, country]);
  const [similar, setSimilar] = useState<ListState>({ scope: '', stations: [], loading: false, total: 0 });
  const [countryList, setCountryList] = useState<ListState>({ scope: '', stations: [], loading: false, total: 0 });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSimilar({ scope: similarScope, stations: [], loading: !!id, total: 0 });
    if (!id) return () => { active = false; controller.abort(); };

    const load = async () => {
      try {
        const currentTags = (tags || '').split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean);
        const filterByTags = (stations: RelatedStation[]) => stations.filter(candidate => {
          if (candidate._id === id) return false;
          const stationTags = (candidate.tags || '').split(',').map(tag => tag.trim().toLowerCase());
          return currentTags.some(tag => stationTags.includes(tag));
        });
        let stations: RelatedStation[] = [];
        if (targetCountry) {
          const params = new URLSearchParams({ countryName: targetCountry === 'all' ? 'global' : targetCountry, page: '1', limit: '30' });
          const response = await fetch(`/api/stations/precomputed?${params}&slim=1`, { signal: controller.signal });
          if (!active) return;
          if (response.ok) {
            const result = await response.json();
            if (!active) return;
            const countryStations = result.data || [];
            stations = filterByTags(countryStations);
            // Keep the original country-first ranking and <6-match fallback.
            if (stations.length < 6) stations = countryStations.filter((candidate: RelatedStation) => candidate._id !== id);
          }
        }
        if (stations.length < 12 && currentTags.length > 0) {
          const params = new URLSearchParams({ countryName: 'global', page: '1', limit: '200' });
          const response = await fetch(`/api/stations/precomputed?${params}&slim=1`, { signal: controller.signal });
          if (!active) return;
          if (response.ok) {
            const result = await response.json();
            if (!active) return;
            const existingIds = new Set(stations.map(candidate => candidate._id));
            const additional = filterByTags(result.data || []).filter(candidate => !existingIds.has(candidate._id));
            stations = [...stations, ...additional].slice(0, 12);
          }
        }
        if (active) setSimilar({ scope: similarScope, stations: stations.slice(0, 12), loading: false, total: 0 });
      } catch {
        if (active) setSimilar({ scope: similarScope, stations: [], loading: false, total: 0 });
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [similarScope, id, targetCountry, tags]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCountryList({ scope: countryScope, stations: [], loading: !!id && !!country, total: 0 });
    if (!id || !country) return () => { active = false; controller.abort(); };

    const load = async () => {
      try {
        const params = new URLSearchParams({ countryName: country, page: '1', limit: '60' });
        const response = await fetch(`/api/stations/precomputed?${params}&slim=1`, { signal: controller.signal });
        if (!active) return;
        if (!response.ok) throw new Error('Failed to fetch country stations');
        const result = await response.json();
        if (!active) return;
        const stations = (result.data || []).filter((candidate: RelatedStation) => candidate._id !== id);
        setCountryList({ scope: countryScope, stations, loading: false, total: result.pagination?.total || stations.length });
      } catch {
        if (active) setCountryList({ scope: countryScope, stations: [], loading: false, total: 0 });
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [countryScope, id, country]);

  // Effects run after render: never expose a previous scope's rows/count even
  // for the first paint of the next station, country, or tag selection.
  return {
    allSimilarStations: similar.scope === similarScope ? similar.stations : emptyStations,
    loadingSimilar: similar.scope === similarScope ? similar.loading : !!id,
    allCountryStations: countryList.scope === countryScope ? countryList.stations : emptyStations,
    loadingCountry: countryList.scope === countryScope ? countryList.loading : !!id && !!country,
    countryStationsTotal: countryList.scope === countryScope ? countryList.total : 0,
  };
}

export function useStationDetailExpansion(routeIdentity?: string, stationId?: string) {
  const scope = JSON.stringify([routeIdentity, stationId]);
  const [state, setState] = useState({ scope, about: false, more: 0 });
  const current = state.scope === scope ? state : { scope, about: false, more: 0 };
  useEffect(() => {
    setState(previous => previous.scope === scope ? previous : { scope, about: false, more: 0 });
  }, [scope]);
  const setIsAboutExpanded = useCallback((value: SetStateAction<boolean>) => {
    setState(previous => {
      const current = previous.scope === scope ? previous : { scope, about: false, more: 0 };
      return { ...current, about: typeof value === 'function' ? value(current.about) : value };
    });
  }, [scope]);
  const setShowMoreCountryCount = useCallback((value: SetStateAction<number>) => {
    setState(previous => {
      const current = previous.scope === scope ? previous : { scope, about: false, more: 0 };
      return { ...current, more: typeof value === 'function' ? value(current.more) : value };
    });
  }, [scope]);
  return { isAboutExpanded: current.about, setIsAboutExpanded, showMoreCountryCount: current.more, setShowMoreCountryCount };
}
