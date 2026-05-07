import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, type StationFilters } from "@/lib/api";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Users, Merge, Check, X, ChevronDown, ChevronUp, Trash2, Crown, Sparkles, AlertTriangle, Tag } from "lucide-react";
import StationTable from "@/components/stations/station-table";
import StationForm from "@/components/stations/station-form";
import Filters from "@/components/stations/filters";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Remove PostgreSQL import - we're using MongoDB now
// import { type StationWithCountry } from "@shared/schema";
import { useDebounce } from "@/hooks/use-debounce";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";

function TagsStatusBadge({ onClick }: { onClick: () => void }) {
  const { data } = useQuery({
    queryKey: ['/api/admin/stations/tags-status-summary'],
    queryFn: () => api.getStationsTagsStatusSummary(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!data || data.emptyCooldown <= 0) return null;

  const formatted = data.emptyCooldown.toLocaleString();
  return (
    <button
      type="button"
      onClick={onClick}
      title="Stations with no tags whose latest Radio-Browser re-check came back empty and are still inside the 30-day cooldown. Click to filter."
      data-testid="badge-empty-tags-cooldown"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
    >
      <Tag className="w-3.5 h-3.5" />
      <span>{formatted} stuck on empty (cooldown)</span>
    </button>
  );
}

function NeverCheckedTagsBadge({ onClick }: { onClick: () => void }) {
  const { data } = useQuery({
    queryKey: ['/api/admin/stations/tags-status-summary'],
    queryFn: () => api.getStationsTagsStatusSummary(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!data || data.neverChecked <= 0) return null;

  const formatted = data.neverChecked.toLocaleString();
  return (
    <button
      type="button"
      onClick={onClick}
      title="Stations with no tags that have never been checked against Radio-Browser. Click to filter."
      data-testid="badge-never-checked-tags"
      className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 transition-colors"
    >
      <Tag className="w-3.5 h-3.5" />
      <span>{formatted} never checked</span>
    </button>
  );
}

export default function Stations() {
  const { toast } = useToast();
  const { playStation, nextStation, previousStation } = useGlobalPlayer();

  // Restore job ID from localStorage on mount (keep 24-hour cache)
  useEffect(() => {
    const savedJobId = localStorage.getItem('bulkAiJobId');
    if (savedJobId) {
      setBulkAiJobId(savedJobId);
      setShowAiDialog(true);
    }
    const savedRecheckJobId = localStorage.getItem('recheckTagsJobId');
    if (savedRecheckJobId) {
      setRecheckTagsJobId(savedRecheckJobId);
    }
  }, []);

  const [filters, setFilters] = useState<StationFilters>({
    page: 1,
    limit: 50, // Changed default from 25 to 50
    search: '',
    country: '',
    language: '',
    genre: '',
    sortBy: 'favicon',
    sortOrder: 'desc',
    hasDescriptions: 'all',
    tagsStatus: 'all',
  });
  
  const [editingStation, setEditingStation] = useState<any | undefined>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showBlacklisted, setShowBlacklisted] = useState(false);
  const [selectedDuplicates, setSelectedDuplicates] = useState<Record<string, string[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [bulkAiJobId, setBulkAiJobId] = useState<string | null>(null);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [generatingStationId, setGeneratingStationId] = useState<string | null>(null);
  const [generatingStationName, setGeneratingStationName] = useState<string>('');
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set());
  const [recheckingTagsStationId, setRecheckingTagsStationId] = useState<string | null>(null);
  const [isBulkRecheckingTags, setIsBulkRecheckingTags] = useState(false);
  const [recheckTagsJobId, setRecheckTagsJobId] = useState<string | null>(null);
  const recheckJobCompletedRef = useRef<Set<string>>(new Set());
  const [selectedLanguages, setSelectedLanguages] = useState<Set<string>>(new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he']));
  
  // Persist job ID to localStorage for recovery after navigation
  useEffect(() => {
    if (bulkAiJobId) {
      localStorage.setItem('bulkAiJobId', bulkAiJobId);
    } else {
      localStorage.removeItem('bulkAiJobId');
    }
  }, [bulkAiJobId]);

  // Persist tag re-check job ID for recovery after page reload
  useEffect(() => {
    if (recheckTagsJobId) {
      localStorage.setItem('recheckTagsJobId', recheckTagsJobId);
    } else {
      localStorage.removeItem('recheckTagsJobId');
    }
  }, [recheckTagsJobId]);
  
  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(filters.search, 300);
  
  const finalFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
  }), [filters, debouncedSearch]);

  const { data: stationsData, isLoading, error, refetch } = useQuery({
    queryKey: showBlacklisted ? ['/api/admin/blacklisted-stations', finalFilters] : 
              showDuplicates ? ['/api/admin/stations/duplicates', finalFilters] : 
              ['/api/admin/stations', finalFilters],
    queryFn: () => {
      if (showBlacklisted) {
        // Fetching blacklisted stations with filters
        const params = new URLSearchParams();
        if (finalFilters.search) params.set('search', finalFilters.search);
        if (finalFilters.page) params.set('page', finalFilters.page.toString());
        if (finalFilters.limit) params.set('limit', finalFilters.limit.toString());
        
        const url = `/api/admin/blacklisted-stations${params.toString() ? '?' + params.toString() : ''}`;
        return fetch(url).then(res => res.json());
      } else if (showDuplicates) {
        // Fetching duplicate stations with filters
        // Pass filters as query parameters to the duplicates endpoint
        const params = new URLSearchParams();
        if (finalFilters.search) params.set('search', finalFilters.search);
        if (finalFilters.country) params.set('country', finalFilters.country);
        if (finalFilters.language) params.set('language', finalFilters.language);
        if (finalFilters.genre) params.set('genre', finalFilters.genre);
        
        const url = `/api/admin/stations/duplicates${params.toString() ? '?' + params.toString() : ''}`;
        return fetch(url).then(res => res.json());
      } else {
        // Calling api.getAdminStations with filters
        return api.getAdminStations(finalFilters);
      }
    },
    staleTime: 86400000, // 24 hours - radio stations don't change frequently
    gcTime: 172800000,   // 48 hours - keep data in memory for 2 days
  });

  // Debug the query result
  // Query result logged

  const createMutation = useMutation({
    mutationFn: api.createStation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Station Created",
        description: "The station has been created successfully.",
      });
      setIsFormOpen(false);
      setEditingStation(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create station.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string | number; data: any }) => api.updateStation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Station Updated",
        description: "The station has been updated successfully.",
      });
      setIsFormOpen(false);
      setEditingStation(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update station.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteStation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Station Deleted",
        description: "The station has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete station.",
        variant: "destructive",
      });
    },
  });

  // Merge stations mutation
  const mergeMutation = useMutation({
    mutationFn: async ({ primaryStationId, duplicateStationIds, mergeData }: { primaryStationId: string, duplicateStationIds: string[], mergeData: any }) => {
      const response = await fetch('/api/admin/stations/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ primaryStationId, duplicateStationIds, mergeData }),
      });
      if (!response.ok) throw new Error('Failed to merge stations');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations/duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      setSelectedDuplicates({});
      toast({
        title: "Stations Merged",
        description: "Selected duplicate stations have been merged successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Merge Failed",
        description: error.message || "Failed to merge stations.",
        variant: "destructive",
      });
    },
  });

  // Restore blacklisted station mutation
  const restoreMutation = useMutation({
    mutationFn: async (blacklistId: string) => {
      const response = await fetch(`/api/admin/blacklisted-stations/${blacklistId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to restore station');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/blacklisted-stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      
      toast({
        title: "Station Restored",
        description: data.warning ? `${data.message}. ${data.warning}` : data.message,
        variant: data.warning ? "default" : "default"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Restore Failed",
        description: error.message || "Failed to restore station.",
        variant: "destructive",
      });
    },
  });

  // Bulk AI description generation mutation
  const bulkAiMutation = useMutation({
    mutationFn: async ({ filterByCountry, skipExisting, limit, selectedStationIds, languages }: { filterByCountry?: string; skipExisting?: boolean; limit?: number; selectedStationIds?: string[]; languages?: string[] }) => {
      const response = await fetch('/api/admin/stations/bulk-generate-descriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterByCountry, skipExisting, limit, selectedStationIds, languages: languages || Array.from(selectedLanguages) })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start bulk AI generation');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Handle "No stations found" response
      if (!data.success) {
        toast({
          title: "No Stations to Process",
          description: data.message || "All selected stations have already been translated or match the filter criteria.",
          variant: "default",
        });
        return;
      }
      
      setBulkAiJobId(data.jobId);
      setShowAiDialog(true);
      toast({
        title: "AI Generation Started",
        description: `Started generating descriptions for ${data.total} stations`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Start",
        description: error.message || "Failed to start bulk AI generation.",
        variant: "destructive",
      });
    },
  });

  // Poll for AI job status
  const { data: aiJobStatus } = useQuery({
    queryKey: ['/api/admin/stations/description-job-status', bulkAiJobId],
    queryFn: async () => {
      if (!bulkAiJobId) return null;
      const response = await fetch(`/api/admin/stations/description-job-status/${bulkAiJobId}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!bulkAiJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' ? 2000 : false; // Poll every 2s if running
    },
  });

  // Poll progress for the bulk tag re-check job. The server keeps an
  // in-memory job record updated by the hydration sweep; we stop
  // polling once it transitions to completed/failed and surface a
  // toast (once per jobId) so the admin can see the outcome without
  // refreshing the page.
  const [isCancellingRecheck, setIsCancellingRecheck] = useState(false);
  const { data: recheckTagsJobStatus } = useQuery<{
    success: boolean;
    job?: {
      jobId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      total: number;
      processed: number;
      hydrated: number;
      emptyUpstream: number;
      failed: number;
      cleared: number;
      matched: number;
      scope?: string;
      error?: string;
      cancelRequested?: boolean;
      cancellable?: boolean;
    };
  } | null>({
    queryKey: ['/api/admin/stations/recheck-tags-job-status', recheckTagsJobId],
    queryFn: async () => {
      if (!recheckTagsJobId) return null;
      const response = await fetch(
        `/api/admin/stations/recheck-tags-job-status/${recheckTagsJobId}`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        // Job is no longer known to the server (expired/evicted after a
        // reload). Clear the persisted id so the stale indicator goes away.
        return { success: false } as const;
      }
      return response.json();
    },
    enabled: !!recheckTagsJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === 'running' ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!recheckTagsJobId) return;
    if (recheckTagsJobStatus === undefined) return;
    const job = recheckTagsJobStatus?.job;
    if (!job) {
      // Server has no record of this job (likely expired after a reload).
      // Drop the persisted id so the indicator clears gracefully.
      if (recheckTagsJobStatus && recheckTagsJobStatus.success === false) {
        setRecheckTagsJobId(null);
      }
      return;
    }
    if (job.status === 'running') return;
    if (recheckJobCompletedRef.current.has(job.jobId)) return;
    recheckJobCompletedRef.current.add(job.jobId);
    if (job.status === 'completed') {
      toast({
        title: 'Tag re-check complete',
        description: `Processed ${job.processed}/${job.total}: ${job.hydrated} hydrated, ${job.emptyUpstream} empty upstream, ${job.failed} failed.`,
      });
    } else if (job.status === 'cancelled') {
      toast({
        title: 'Tag re-check cancelled',
        description: `Stopped after ${job.processed}/${job.total}: ${job.hydrated} hydrated, ${job.emptyUpstream} empty upstream, ${job.failed} failed.`,
      });
    } else {
      toast({
        title: 'Tag re-check failed',
        description: job.error || 'Background hydration job failed.',
        variant: 'destructive',
      });
    }
    queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
    queryClient.invalidateQueries({
      queryKey: ['/api/admin/stations/tags-status-summary'],
    });
    // Keep the jobId for a short moment so the indicator can show the
    // final counts; clearing it immediately would hide the summary.
    const timer = setTimeout(() => setRecheckTagsJobId(null), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recheckTagsJobStatus, recheckTagsJobId]);

  // Handle AI generation start
  const handleStartBulkAi = () => {
    const stationIds = selectedStations.size > 0 ? Array.from(selectedStations) : undefined;
    const countryFilter = selectedStations.size === 0 ? filters.country : undefined; // Use country only if no specific stations selected
    bulkAiMutation.mutate({
      filterByCountry: countryFilter || undefined,
      skipExisting: true,
      limit: undefined,
      selectedStationIds: stationIds,
      languages: Array.from(selectedLanguages)
    });
  };

  // Handle refresh of skipped stations
  const handleRefreshSkipped = async () => {
    try {
      const response = await fetch('/api/admin/stations/clear-skipped-flags', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clear skip flags');
      }

      const data = await response.json();
      toast({
        title: "Skip Flags Cleared",
        description: `Cleared flags for ${data.clearedCount} stations. Starting regeneration...`
      });

      // Start bulk generation after clearing flags
      setTimeout(() => {
        handleStartBulkAi();
      }, 500);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to clear skip flags",
        variant: "destructive"
      });
    }
  };

  // Handle fix missing English descriptions
  const handleFixMissingEnglish = async () => {
    try {
      // If stations are selected, only fix those; otherwise fix all
      const stationIds = selectedStations.size > 0 ? Array.from(selectedStations) : undefined;
      
      const response = await fetch('/api/admin/stations/fix-missing-english', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedStationIds: stationIds })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Failed to start fix job');
      }

      const data = await response.json();
      
      if (!data.success) {
        toast({
          title: "No Stations to Fix",
          description: data.message || "All stations already have English descriptions.",
        });
        return;
      }
      
      setBulkAiJobId(data.jobId);
      setShowAiDialog(true);
      toast({
        title: "Fix English Started",
        description: `Started fixing English descriptions for ${data.total} station${data.total !== 1 ? 's' : ''}`
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start fix job",
        variant: "destructive"
      });
    }
  };

  // Handle fix translated station names - detect and regenerate
  const [translatedNamesData, setTranslatedNamesData] = useState<{ total: number; stations: any[] } | null>(null);
  const [showTranslatedNamesDialog, setShowTranslatedNamesDialog] = useState(false);
  const [isDetectingTranslated, setIsDetectingTranslated] = useState(false);

  const handleDetectTranslatedNames = async () => {
    setIsDetectingTranslated(true);
    try {
      const response = await fetch('/api/admin/stations/detect-translated-names?limit=1000', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to detect translated names');
      }
      
      const data = await response.json();
      setTranslatedNamesData(data);
      setShowTranslatedNamesDialog(true);
      
      if (data.total === 0) {
        toast({
          title: "No Issues Found",
          description: "All station names are properly preserved in descriptions.",
        });
      } else {
        toast({
          title: "Issues Detected",
          description: `Found ${data.total} stations with translated/missing station names.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to detect translated names",
        variant: "destructive"
      });
    } finally {
      setIsDetectingTranslated(false);
    }
  };

  const handleFixTranslatedNames = async (stationIds: string[]) => {
    // Close detection dialog immediately
    setShowTranslatedNamesDialog(false);
    
    try {
      const response = await fetch('/api/admin/stations/fix-translated-names', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          stationIds, 
          languages: Array.from(selectedLanguages) 
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start fix job');
      }
      
      const data = await response.json();
      
      // Open progress dialog immediately after getting job ID
      setBulkAiJobId(data.jobId);
      setShowAiDialog(true);
      
      toast({
        title: "Fix Started",
        description: `Started regenerating descriptions for ${data.total} stations from their native language.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start fix job",
        variant: "destructive"
      });
    }
  };

  const handleFilterChange = (key: keyof StationFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: key === 'limit' ? parseInt(value) : value,
      page: 1, // Reset to first page when filters change
    }));
  };

  const handleSort = (field: string) => {
    setFilters(prev => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field && prev.sortOrder === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleAddStation = () => {
    setEditingStation(undefined);
    setIsFormOpen(true);
  };

  const handleEditStation = async (station: any) => {
    // Edit button clicked for station
    try {
      // Fetch fresh station data to ensure we have latest descriptions
      const response = await fetch(`/api/admin/stations/${station._id}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const freshStation = await response.json();
        setEditingStation(freshStation);
      } else {
        // Fallback to passed station if fetch fails
        setEditingStation(station);
      }
    } catch (error) {
      // Fallback to passed station if fetch fails
      setEditingStation(station);
    }
    setIsFormOpen(true);
  };

  const handleDeleteStation = (station: any) => {
    if (confirm(`Are you sure you want to delete "${station.name}"?`)) {
      deleteMutation.mutate(station._id || station.id);
    }
  };

  const handleGenerateAiDescription = (station: any) => {
    // Add the station to the selection and open the bulk AI dialog
    setSelectedStations(new Set([station._id]));
    setShowAiDialog(true);
    setGeneratingStationName(station.name);
  };

  const handleTranslateDescriptions = async (station: any) => {
    if (!station?.descriptions || Object.keys(station.descriptions).length === 0) {
      toast({
        title: "No Description",
        description: "Generate a description first before translating",
        variant: "destructive"
      });
      return;
    }

    try {
      const response = await fetch(`/api/admin/stations/${station._id}/translate-descriptions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'tr', 'ru', 'ar', 'zh', 'ja', 'he']
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to translate descriptions');
      }
      
      const data = await response.json();
      toast({
        title: "✨ Descriptions Translated",
        description: `Successfully translated to ${data.translationsCount} languages`
      });
      
      // Refresh station data
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
        refetch();
      }, 1500);
    } catch (error: any) {
      toast({
        title: "Translation Error",
        description: error.message || "Failed to translate descriptions",
        variant: "destructive"
      });
    }
  };

  const handleRecheckStationTags = async (station: any) => {
    const stationId = station._id || station.id;
    if (!stationId) return;
    setRecheckingTagsStationId(stationId);
    try {
      const response = await fetch(
        `/api/admin/stations/${stationId}/recheck-tags`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to re-check tags');
      }
      if (data.hydrated) {
        toast({
          title: 'Tags refreshed',
          description: `"${station.name}" → ${data.tags || ''}`,
        });
      } else if (data.emptyUpstream) {
        toast({
          title: 'Still empty upstream',
          description: `Radio-Browser returned no tags for "${station.name}".`,
        });
      } else {
        toast({ title: 'Tags re-checked', description: station.name });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations/tags-status-summary'] });
      refetch();
    } catch (error: any) {
      toast({
        title: 'Re-check failed',
        description: error?.message || 'Failed to re-check tags',
        variant: 'destructive',
      });
    } finally {
      setRecheckingTagsStationId(null);
    }
  };

  const handleBulkRecheckTags = async () => {
    const ids = Array.from(selectedStations);
    const country = ids.length === 0 ? filters.country : undefined;
    if (ids.length === 0 && !country) {
      toast({
        title: 'Nothing to re-check',
        description: 'Select stations or pick a country filter first.',
        variant: 'destructive',
      });
      return;
    }
    const scope =
      ids.length > 0
        ? `${ids.length} selected station${ids.length === 1 ? '' : 's'}`
        : `country ${country}`;
    if (!confirm(`Re-check tags from Radio-Browser for ${scope}?`)) return;
    setIsBulkRecheckingTags(true);
    try {
      const response = await fetch('/api/admin/stations/recheck-tags-bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationIds: ids.length > 0 ? ids : undefined,
          countryCode: country || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to start bulk re-check');
      }
      toast({
        title: 'Tag re-check started',
        description: `Cleared cooldown for ${data.cleared ?? 0} station(s); hydration running in the background.`,
      });
      if (data.jobId) {
        recheckJobCompletedRef.current.delete(data.jobId);
        setRecheckTagsJobId(data.jobId);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations/tags-status-summary'] });
    } catch (error: any) {
      toast({
        title: 'Bulk re-check failed',
        description: error?.message || 'Failed to start bulk re-check',
        variant: 'destructive',
      });
    } finally {
      setIsBulkRecheckingTags(false);
    }
  };

  const handleBulkRecheckAllStuck = async () => {
    if (
      filters.tagsStatus !== 'empty-cooldown' &&
      filters.tagsStatus !== 'never-checked'
    )
      return;
    const scopeBits: string[] = [];
    if (filters.country) scopeBits.push(`country ${filters.country}`);
    if (filters.language) scopeBits.push(`language ${filters.language}`);
    if (filters.genre) scopeBits.push(`genre ${filters.genre}`);
    if (debouncedSearch) scopeBits.push(`search "${debouncedSearch}"`);
    const scope = scopeBits.length > 0 ? ` (${scopeBits.join(', ')})` : '';
    const bucketLabel =
      filters.tagsStatus === 'empty-cooldown'
        ? 'stuck on the empty-tags cooldown'
        : 'tagless and never re-checked';
    if (
      !confirm(
        `Re-check tags from Radio-Browser for EVERY station ${bucketLabel}${scope}? This may take a while.`,
      )
    )
      return;
    setIsBulkRecheckingTags(true);
    try {
      const response = await fetch('/api/admin/stations/recheck-tags-bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagsStatus: filters.tagsStatus,
          countryCode: filters.country || undefined,
          language: filters.language || undefined,
          genre: filters.genre || undefined,
          search: debouncedSearch || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to start bulk re-check');
      }
      toast({
        title: 'Tag re-check started',
        description:
          filters.tagsStatus === 'empty-cooldown'
            ? `Cleared cooldown for ${data.cleared ?? 0} station(s) (${data.matched ?? 0} matched); hydration running in the background.`
            : `Queued ${data.cleared ?? 0} never-checked station(s) (${data.matched ?? 0} matched); hydration running in the background.`,
      });
      if (data.jobId) {
        recheckJobCompletedRef.current.delete(data.jobId);
        setRecheckTagsJobId(data.jobId);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stations/tags-status-summary'] });
    } catch (error: any) {
      toast({
        title: 'Bulk re-check failed',
        description: error?.message || 'Failed to start bulk re-check',
        variant: 'destructive',
      });
    } finally {
      setIsBulkRecheckingTags(false);
    }
  };

  const handleRestoreStation = (blacklistedStation: any) => {
    if (confirm(`Are you sure you want to restore "${blacklistedStation.name}"?`)) {
      restoreMutation.mutate(blacklistedStation._id);
    }
  };

  const handlePlayStation = async (station: any) => {
    // Use global player to actually start playback
    const stationsArray = Array.isArray(stationsData?.stations) ? stationsData.stations : [];
    await playStation(station, stationsArray);
  };


  const handleFormSubmit = (data: any) => {
    if (editingStation) {
      updateMutation.mutate({ id: editingStation._id || editingStation.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleSync = async () => {
    try {
      await api.forceSync();
      toast({
        title: "Sync Started",
        description: "Station synchronization has been started.",
      });
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      toast({
        title: "Sync Failed",
        description: "Failed to start synchronization.",
        variant: "destructive",
      });
    }
  };

  // Handle duplicate selection
  const handleDuplicateSelection = (groupId: string, stationId: string, checked: boolean) => {
    setSelectedDuplicates(prev => {
      const groupSelections = prev[groupId] || [];
      if (checked) {
        return { ...prev, [groupId]: [...groupSelections, stationId] };
      } else {
        return { ...prev, [groupId]: groupSelections.filter(id => id !== stationId) };
      }
    });
  };

  // Handle merge selected duplicates
  const handleMergeDuplicates = (groupId: string, stations: any[]) => {
    const selectedIds = selectedDuplicates[groupId] || [];
    if (selectedIds.length < 2) {
      toast({
        title: "Selection Error",
        description: "Please select at least 2 stations to merge.",
        variant: "destructive",
      });
      return;
    }

    // Use the first selected station as primary
    const primaryStationId = selectedIds[0];
    const duplicateStationIds = selectedIds.slice(1);
    
    // Find the primary station to get merge data
    const primaryStation = stations.find(s => s._id === primaryStationId);
    
    if (!primaryStation) {
      toast({
        title: "Error",
        description: "Primary station not found.",
        variant: "destructive",
      });
      return;
    }

    const mergeData = {
      name: primaryStation.name,
      url: primaryStation.url,
      homepage: primaryStation.homepage,
      favicon: primaryStation.favicon,
      country: primaryStation.country,
      language: primaryStation.language,
      genre: primaryStation.genre,
    };

    mergeMutation.mutate({ primaryStationId, duplicateStationIds, mergeData });
  };

  // Handle delete selected duplicates
  const handleDeleteSelectedDuplicates = async (groupId: string, groupStations: any[]) => {
    const selectedIds = selectedDuplicates[groupId] || [];
    if (selectedIds.length === 0) {
      toast({
        title: "Selection Error",
        description: "Please select at least 1 station to delete.",
        variant: "destructive",
      });
      return;
    }

    try {
      // SMART FAVICON COPYING: Find highest-voted station that's NOT being deleted
      const remainingStations = groupStations
        .filter(s => !selectedIds.includes(s._id))
        .sort((a, b) => (b.votes || 0) - (a.votes || 0));
      
      const highestVotedRemaining = remainingStations[0];
      
      // Helper function to check if a URL is valid (not null, empty, or string 'null'/'undefined')
      const isValidUrl = (url: string | null | undefined): boolean => {
        if (!url) return false;
        const trimmed = url.trim();
        return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
      };
      
      // Check if highest-voted remaining station lacks BOTH favicon and localImagePath
      const remainingHasIcon = isValidUrl(highestVotedRemaining?.favicon) || isValidUrl(highestVotedRemaining?.localImagePath);
      
      // If highest-voted station exists and has NO icon (neither favicon nor localImagePath), try to copy one
      if (highestVotedRemaining && !remainingHasIcon) {
        // Find a favicon from stations being deleted (check BOTH favicon and localImagePath)
        const stationsBeingDeleted = groupStations.filter(s => selectedIds.includes(s._id));
        const faviconSource = stationsBeingDeleted.find(s => 
          isValidUrl(s.favicon) || isValidUrl(s.localImagePath)
        );
        
        // Get the actual icon URL (prefer favicon, fallback to localImagePath)
        const sourceFaviconUrl = isValidUrl(faviconSource?.favicon) 
          ? faviconSource.favicon 
          : isValidUrl(faviconSource?.localImagePath) 
            ? faviconSource.localImagePath 
            : '';
        
        if (sourceFaviconUrl) {
          // Copy favicon to highest-voted station before deletion
          try {
            const updateResponse = await fetch(`/api/admin/stations/${highestVotedRemaining._id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favicon: sourceFaviconUrl })
            });
            
            if (updateResponse.ok) {
              toast({
                title: 'Favicon preserved',
                description: `Copied favicon from "${faviconSource.name}" to "${highestVotedRemaining.name}"`,
              });
            } else {
              const errorData = await updateResponse.json();
              console.error('Failed to update favicon:', errorData);
            }
          } catch (error) {
            console.error('Failed to copy favicon:', error);
            // Continue with deletion even if favicon copy fails
          }
        }
      }

      // Proceed with deletion
      const response = await fetch('/api/admin/delete-stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationIds: selectedIds })
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Stations deleted',
          description: `Successfully deleted ${result.deletedCount} station(s)`,
        });
        // Clear selections for this group
        setSelectedDuplicates(prev => {
          const newSelections = { ...prev };
          delete newSelections[groupId];
          return newSelections;
        });
        // Refresh data
        refetch();
      } else {
        toast({
          title: 'Delete failed',
          description: result.error || 'Failed to delete stations',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An error occurred while deleting stations',
        variant: 'destructive'
      });
    }
  };

  // Toggle group expansion
  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const totalPages = Math.ceil((stationsData?.total || 0) / filters.limit!);

  return (
    <div className="p-2 sm:p-6">
      {/* AI Generation Progress Indicator */}
      {generatingStationId && (
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="animate-spin">✨</div>
              <div>
                <p className="font-semibold text-purple-900">AI Description Generation in Progress</p>
                <p className="text-sm text-purple-700">Station: <span className="font-medium">{generatingStationName}</span></p>
              </div>
            </div>
          </div>
          <Progress value={50} className="h-2" />
          <p className="text-xs text-purple-600 mt-2">This may take 10-30 seconds...</p>
        </div>
      )}
      
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-lg sm:text-xl">Station Management</CardTitle>
              <TagsStatusBadge
                onClick={() => {
                  setShowDuplicates(false);
                  setShowBlacklisted(false);
                  handleFilterChange('tagsStatus', 'empty-cooldown');
                }}
              />
              <NeverCheckedTagsBadge
                onClick={() => {
                  setShowDuplicates(false);
                  setShowBlacklisted(false);
                  handleFilterChange('tagsStatus', 'never-checked');
                }}
              />
            </div>
            <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button onClick={handleAddStation} className="w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Add Station
              </Button>
              <Button variant="outline" onClick={handleSync} className="w-full sm:w-auto">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Now
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowDuplicates(!showDuplicates);
                  setShowBlacklisted(false);
                }}
                className="w-full sm:w-auto"
              >
                <Users className="w-4 h-4 mr-2" />
                {showDuplicates ? 'Show All' : 'Find Duplicates'}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowBlacklisted(!showBlacklisted);
                  setShowDuplicates(false);
                }}
                className="w-full sm:w-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {showBlacklisted ? 'Show All' : 'Deleted Stations'}
              </Button>
              <Button 
                variant="outline"
                onClick={handleStartBulkAi}
                disabled={bulkAiMutation.isPending || aiJobStatus?.status === 'running' || (selectedStations.size === 0 && !filters.country)}
                className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                data-testid="button-bulk-ai-generate"
                title={selectedStations.size > 0 ? `Generate for ${selectedStations.size} selected stations` : filters.country ? `Generate for ${filters.country}` : 'Select a country or stations first'}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {aiJobStatus?.status === 'running' ? 'AI Generating...' : selectedStations.size > 0 ? `Bulk AI (${selectedStations.size})` : 'Bulk AI Descriptions'}
              </Button>
              <Button 
                variant="outline"
                onClick={handleRefreshSkipped}
                disabled={bulkAiMutation.isPending || aiJobStatus?.status === 'running'}
                className="w-full sm:w-auto"
                title="Clear previously skipped stations and regenerate their descriptions"
                data-testid="button-refresh-skipped"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Skipped
              </Button>
              <Button 
                variant="outline"
                onClick={handleFixMissingEnglish}
                disabled={bulkAiMutation.isPending || aiJobStatus?.status === 'running'}
                className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-0"
                title={selectedStations.size > 0 ? `Fix English for ${selectedStations.size} selected station(s)` : "Find and fix all stations with missing English descriptions"}
                data-testid="button-fix-missing-english"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {selectedStations.size > 0 ? `Fix EN (${selectedStations.size})` : 'Fix Missing EN'}
              </Button>
              <Button 
                variant="outline"
                onClick={handleDetectTranslatedNames}
                disabled={bulkAiMutation.isPending || aiJobStatus?.status === 'running' || isDetectingTranslated}
                className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
                title="Find stations where station names were translated instead of preserved"
                data-testid="button-detect-translated-names"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {isDetectingTranslated ? 'Scanning...' : 'Fix Translated Names'}
              </Button>
              <Button
                variant="outline"
                onClick={handleBulkRecheckTags}
                disabled={isBulkRecheckingTags || (selectedStations.size === 0 && !filters.country)}
                className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white border-0"
                title={
                  selectedStations.size > 0
                    ? `Re-check tags from Radio-Browser for ${selectedStations.size} selected station(s)`
                    : filters.country
                      ? `Re-check tags from Radio-Browser for empty-tag stations in ${filters.country}`
                      : 'Select stations or pick a country first'
                }
                data-testid="button-bulk-recheck-tags"
              >
                <Tag className="w-4 h-4 mr-2" />
                {isBulkRecheckingTags
                  ? 'Re-checking...'
                  : selectedStations.size > 0
                    ? `Re-check Tags (${selectedStations.size})`
                    : 'Re-check Tags'}
              </Button>
              {(filters.tagsStatus === 'empty-cooldown' ||
                filters.tagsStatus === 'never-checked') && (
                <Button
                  variant="outline"
                  onClick={handleBulkRecheckAllStuck}
                  disabled={isBulkRecheckingTags}
                  className="w-full sm:w-auto bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white border-0"
                  title={
                    filters.tagsStatus === 'empty-cooldown'
                      ? 'Re-check tags for every station currently stuck on the empty-tags cooldown (matches the active filter, not just this page)'
                      : 'Re-check tags for every tagless station that has never been re-checked (matches the active filter, not just this page)'
                  }
                  data-testid="button-bulk-recheck-all-stuck"
                >
                  <Tag className="w-4 h-4 mr-2" />
                  {isBulkRecheckingTags
                    ? 'Re-checking...'
                    : filters.tagsStatus === 'empty-cooldown'
                      ? 'Re-check All Stuck'
                      : 'Re-check All Never-Checked'}
                </Button>
              )}
              {recheckTagsJobStatus?.job && (
                <div
                  className="w-full sm:w-auto flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
                  data-testid="recheck-tags-progress"
                  title={recheckTagsJobStatus.job.scope}
                >
                  <Tag className="w-4 h-4" />
                  {recheckTagsJobStatus.job.status === 'running' ? (
                    <span>
                      Re-check in progress: {recheckTagsJobStatus.job.processed}/
                      {recheckTagsJobStatus.job.total || '?'}
                      {recheckTagsJobStatus.job.total > 0 &&
                        ` (${Math.floor(
                          (recheckTagsJobStatus.job.processed /
                            recheckTagsJobStatus.job.total) *
                            100,
                        )}%)`}
                    </span>
                  ) : recheckTagsJobStatus.job.status === 'completed' ? (
                    <span>
                      Re-check done: {recheckTagsJobStatus.job.hydrated} hydrated,{' '}
                      {recheckTagsJobStatus.job.emptyUpstream} empty,{' '}
                      {recheckTagsJobStatus.job.failed} failed (of{' '}
                      {recheckTagsJobStatus.job.processed})
                    </span>
                  ) : recheckTagsJobStatus.job.status === 'cancelled' ? (
                    <span>
                      Re-check cancelled: stopped after{' '}
                      {recheckTagsJobStatus.job.processed}/
                      {recheckTagsJobStatus.job.total || '?'} ({' '}
                      {recheckTagsJobStatus.job.hydrated} hydrated,{' '}
                      {recheckTagsJobStatus.job.emptyUpstream} empty,{' '}
                      {recheckTagsJobStatus.job.failed} failed)
                    </span>
                  ) : (
                    <span>
                      Re-check failed:{' '}
                      {recheckTagsJobStatus.job.error || 'unknown error'}
                    </span>
                  )}
                  {recheckTagsJobStatus.job.status === 'running' &&
                    recheckTagsJobStatus.job.cancellable && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-2 h-7 px-2 text-xs"
                        disabled={
                          isCancellingRecheck ||
                          recheckTagsJobStatus.job.cancelRequested
                        }
                        data-testid="button-cancel-recheck-tags"
                        onClick={async () => {
                          if (!recheckTagsJobId) return;
                          setIsCancellingRecheck(true);
                          try {
                            const resp = await fetch(
                              `/api/admin/stations/recheck-tags-job-cancel/${recheckTagsJobId}`,
                              {
                                method: 'POST',
                                credentials: 'include',
                              },
                            );
                            if (!resp.ok) {
                              const body = await resp.json().catch(() => ({}));
                              throw new Error(
                                body.error || 'Failed to cancel re-check',
                              );
                            }
                            toast({
                              title: 'Cancellation requested',
                              description:
                                'The re-check will stop after the current batch.',
                            });
                            queryClient.invalidateQueries({
                              queryKey: [
                                '/api/admin/stations/recheck-tags-job-status',
                                recheckTagsJobId,
                              ],
                            });
                          } catch (err: any) {
                            toast({
                              title: 'Cancel failed',
                              description: err?.message || 'Could not cancel job',
                              variant: 'destructive',
                            });
                          } finally {
                            setIsCancellingRecheck(false);
                          }
                        }}
                      >
                        {recheckTagsJobStatus.job.cancelRequested
                          ? 'Cancelling…'
                          : 'Cancel'}
                      </Button>
                    )}
                </div>
              )}
              {aiJobStatus?.status === 'running' && (
                <Button 
                  variant="default"
                  onClick={() => setShowAiDialog(true)}
                  className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                  title="Show job progress details"
                  data-testid="button-show-job-status"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Show Job Status
                </Button>
              )}
            </div>
          </div>

          {/* Language Selector for AI Translation */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">AI Translation Languages:</p>
            <div className="flex flex-wrap gap-2">
              {[
                { code: 'en', name: 'English' },
                { code: 'es', name: 'Spanish' },
                { code: 'fr', name: 'French' },
                { code: 'de', name: 'German' },
                { code: 'pt', name: 'Portuguese' },
                { code: 'it', name: 'Italian' },
                { code: 'ru', name: 'Russian' },
                { code: 'ar', name: 'Arabic' },
                { code: 'zh', name: 'Chinese' },
                { code: 'tr', name: 'Turkish' },
                { code: 'ja', name: 'Japanese' },
                { code: 'ko', name: 'Korean' },
                { code: 'hi', name: 'Hindi' },
                { code: 'he', name: 'Hebrew' },
              ].map(lang => (
                <Button
                  key={lang.code}
                  size="sm"
                  variant={selectedLanguages.has(lang.code) ? 'default' : 'outline'}
                  onClick={() => {
                    const newLangs = new Set(selectedLanguages);
                    if (newLangs.has(lang.code)) {
                      newLangs.delete(lang.code);
                    } else {
                      newLangs.add(lang.code);
                    }
                    setSelectedLanguages(newLangs);
                  }}
                  className={selectedLanguages.has(lang.code) ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0' : ''}
                  data-testid={`button-language-${lang.code}`}
                >
                  {lang.name}
                </Button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {selectedLanguages.size} language{selectedLanguages.size !== 1 ? 's' : ''} selected
              {selectedStations.size > 0 && (
                <span>, {selectedStations.size} station{selectedStations.size !== 1 ? 's' : ''} selected</span>
              )}
              {selectedLanguages.size > 0 && (
                <span> (Cost: ~${((selectedStations.size > 0 ? selectedStations.size : stationsData?.total || 0) * (0.0004 + selectedLanguages.size * 0.0007)).toFixed(2)}) estimated for GPT-4o-mini)</span>
              )}
            </p>
          </div>
        </CardHeader>

        {selectedStations.size > 0 && (
          <div className="mx-6 mb-3 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="text-blue-900">
              <strong>{selectedStations.size}</strong> station{selectedStations.size !== 1 ? 's' : ''} selected across all filters. You can change country/filters to add more — your selection is preserved.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedStations(new Set())}
              data-testid="button-clear-selection"
            >
              Clear selection
            </Button>
          </div>
        )}

        <Filters
          search={filters.search || ''}
          country={filters.country || ''}
          language={filters.language || ''}
          genre={filters.genre || ''}
          hasDescriptions={filters.hasDescriptions || 'all'}
          tagsStatus={filters.tagsStatus || 'all'}
          onSearchChange={(value) => handleFilterChange('search', value)}
          onCountryChange={(value) => handleFilterChange('country', value)}
          onLanguageChange={(value) => handleFilterChange('language', value)}
          onGenreChange={(value) => handleFilterChange('genre', value)}
          onHasDescriptionsChange={(value) => handleFilterChange('hasDescriptions', value)}
          onTagsStatusChange={(value) => handleFilterChange('tagsStatus', value)}
        />

        <CardContent className="p-0">
          {error ? (
            <div className="p-8 text-center">
              <p className="text-red-500 font-medium mb-2">Failed to load stations</p>
              <p className="text-sm text-gray-500">{(error as any)?.message || 'Unknown error'}</p>
              <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Retry</button>
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">
                {showBlacklisted ? 'Loading deleted stations...' : showDuplicates ? 'Finding duplicate stations...' : 'Loading stations...'}
              </p>
            </div>
          ) : showBlacklisted ? (
            // Blacklisted Stations Interface
            <div className="p-6">
              {stationsData?.stations?.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">
                      Deleted Stations ({stationsData.pagination?.total || 0})
                    </h3>
                    <Badge variant="outline">
                      Page {stationsData.pagination?.page || 1} of {stationsData.pagination?.totalPages || 1}
                    </Badge>
                  </div>
                  
                  {stationsData.stations.map((station: any) => (
                    <Card key={station._id} className="border border-red-200">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">{station.name}</h4>
                            <p className="text-sm text-gray-600 mt-1">{station.url}</p>
                            <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                              <span>Deleted: {new Date(station.createdAt).toLocaleDateString()}</span>
                              <span>Reason: {station.reason}</span>
                              {station.deletedBy && <span>By: {station.deletedBy}</span>}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 ml-4">
                            <Button
                              size="sm"
                              onClick={() => handleRestoreStation(station)}
                              disabled={restoreMutation.isPending}
                              className="bg-green-600 hover:bg-green-700 text-white"
                            >
                              {restoreMutation.isPending ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <Crown className="w-4 h-4 mr-1" />
                                  Restore
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Pagination for blacklisted stations */}
                  {stationsData?.pagination && stationsData.pagination.totalPages > 1 && (
                    <div className="flex justify-center mt-6">
                      <Pagination>
                        <PaginationContent>
                          {stationsData.pagination.page > 1 && (
                            <PaginationItem>
                              <PaginationPrevious 
                                onClick={() => handlePageChange(stationsData.pagination.page - 1)}
                                className="cursor-pointer"
                              />
                            </PaginationItem>
                          )}
                          
                          {Array.from({ length: Math.min(5, stationsData.pagination.totalPages) }, (_, i) => {
                            const page = i + 1;
                            return (
                              <PaginationItem key={page}>
                                <PaginationLink
                                  onClick={() => handlePageChange(page)}
                                  isActive={page === stationsData.pagination.page}
                                  className="cursor-pointer"
                                >
                                  {page}
                                </PaginationLink>
                              </PaginationItem>
                            );
                          })}

                          {stationsData.pagination.page < stationsData.pagination.totalPages && (
                            <PaginationItem>
                              <PaginationNext 
                                onClick={() => handlePageChange(stationsData.pagination.page + 1)}
                                className="cursor-pointer"
                              />
                            </PaginationItem>
                          )}
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Trash2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Deleted Stations</h3>
                  <p className="text-gray-600">There are currently no deleted stations to restore.</p>
                </div>
              )}
            </div>
          ) : showDuplicates ? (
            // Duplicate Stations Interface
            <div className="p-6">
              {stationsData?.duplicates?.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">
                      Found {stationsData.duplicates.length} duplicate groups
                    </h3>
                    <Badge variant="outline">
                      Total duplicates: {stationsData.duplicates.reduce((sum: number, group: any) => sum + group.stations.length, 0)} stations
                    </Badge>
                  </div>
                  
                  {stationsData.duplicates.map((group: any, index: number) => {
                    const groupId = `${index}-${group._id?.name || group._id}`;
                    const isExpanded = expandedGroups[groupId];
                    const selectedCount = selectedDuplicates[groupId]?.length || 0;
                    
                    return (
                      <Card key={groupId} className="border border-orange-200">
                        <Collapsible 
                          open={isExpanded} 
                          onOpenChange={() => toggleGroupExpansion(groupId)}
                        >
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover:bg-gray-50 p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  <div>
                                    <h4 className="font-medium">
                                      {group._id?.name ? `"${group._id.name}"` : 'Similar URLs'} 
                                      {group._id?.country && ` - ${group._id.country}`}
                                    </h4>
                                    <p className="text-sm text-gray-600">
                                      {group.count} duplicate stations found
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  {selectedCount > 0 && (
                                    <Badge variant="secondary">
                                      {selectedCount} selected
                                    </Badge>
                                  )}
                                  <Badge variant="destructive">
                                    {group.count} duplicates
                                  </Badge>
                                </div>
                              </div>
                            </CardHeader>
                          </CollapsibleTrigger>
                          
                          <CollapsibleContent>
                            <CardContent className="pt-0 px-4 pb-4">
                              <div className="space-y-3">
                                {group.stations.map((station: any, stationIndex: number) => {
                                  const isSelected = selectedDuplicates[groupId]?.includes(station._id) || false;
                                  const isPrimary = selectedDuplicates[groupId]?.[0] === station._id;
                                  const selectionOrder = selectedDuplicates[groupId]?.indexOf(station._id) || -1;
                                  
                                  return (
                                    <div key={station._id} className={`flex items-start space-x-3 p-3 border rounded-lg ${isPrimary ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(checked) => 
                                          handleDuplicateSelection(groupId, station._id, !!checked)
                                        }
                                        className="mt-1"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              <h5 className="font-medium text-sm truncate">
                                                {station.name}
                                              </h5>
                                              {isPrimary && (
                                                <Badge variant="default" className="text-xs bg-blue-600">
                                                  <Crown className="w-3 h-3 mr-1" />
                                                  Primary
                                                </Badge>
                                              )}
                                              {isSelected && !isPrimary && (
                                                <Badge variant="secondary" className="text-xs">
                                                  #{selectionOrder + 1}
                                                </Badge>
                                              )}
                                            </div>
                                            <p className="text-xs text-gray-600 truncate">
                                              {station.url}
                                            </p>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              {station.country && (
                                                <Badge variant="outline" className="text-xs">
                                                  {station.country}
                                                </Badge>
                                              )}
                                              {station.language && (
                                                <Badge variant="outline" className="text-xs">
                                                  {station.language}
                                                </Badge>
                                              )}
                                              {station.genre && (
                                                <Badge variant="outline" className="text-xs">
                                                  {station.genre}
                                                </Badge>
                                              )}
                                              {station.votes > 0 && (
                                                <Badge variant="secondary" className="text-xs">
                                                  {station.votes} votes
                                                </Badge>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center space-x-2 ml-2">
                                            {station.favicon && (
                                              <img 
                                                src={station.favicon} 
                                                alt={`${station.name} logo`}
                                                className="w-8 h-8 rounded flex-shrink-0"
                                                onError={(e) => {
                                                  e.currentTarget.style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteStation(station);
                                              }}
                                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                              title="Remove this duplicate station"
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              
                              <div className="flex justify-between items-center mt-4 pt-3 border-t">
                                <div className="text-sm text-gray-600">
                                  <p className="font-medium">Merge Instructions:</p>
                                  <p>• Select stations to merge (2 or more)</p>
                                  <p>• First selected station becomes primary (keeps its data)</p>
                                  <p>• Other selected stations will be merged into primary</p>
                                  {selectedCount > 0 && (
                                    <p className="text-blue-600 font-medium mt-1">
                                      {selectedCount} stations selected
                                      {selectedCount >= 2 && ` → Will merge into "${group.stations.find((s: any) => s._id === selectedDuplicates[groupId]?.[0])?.name}"`}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => handleDeleteSelectedDuplicates(groupId, group.stations)}
                                    disabled={selectedCount === 0}
                                    size="sm"
                                    variant="destructive"
                                  >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    Delete {selectedCount > 0 ? selectedCount : ''} selected
                                  </Button>
                                  <Button
                                    onClick={() => handleMergeDuplicates(groupId, group.stations)}
                                    disabled={selectedCount < 2 || mergeMutation.isPending}
                                    size="sm"
                                  >
                                    <Merge className="w-4 h-4 mr-1" />
                                    {mergeMutation.isPending ? 'Merging...' : `Merge ${selectedCount} stations`}
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Collapsible>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No duplicates found</h3>
                  <p className="text-gray-600">All stations appear to be unique.</p>
                </div>
              )}
            </div>
          ) : (
            // Regular Station Table
            <StationTable
              stations={stationsData?.stations || []}
              onEdit={handleEditStation}
              onDelete={handleDeleteStation}
              onPlay={handlePlayStation}
              onGenerateAi={handleGenerateAiDescription}
              onTranslate={handleTranslateDescriptions}
              onRecheckTags={handleRecheckStationTags}
              onSort={handleSort}
              sortBy={filters.sortBy || 'name'}
              sortOrder={filters.sortOrder || 'asc'}
              generatingStationId={generatingStationId}
              recheckingTagsStationId={recheckingTagsStationId}
              selectedStations={selectedStations}
              onSelectedStationsChange={setSelectedStations}
            />
          )}
        </CardContent>

        {/* Pagination Controls */}
        <div className="bg-white px-3 sm:px-6 py-3 border-t border-gray-200">
          {/* Page Size Selector */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Show:</span>
              <Select
                value={filters.limit?.toString()}
                onValueChange={(value) => handleFilterChange('limit' as keyof StationFilters, value)}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="1000">1000</SelectItem>
                  <SelectItem value="2000">2000</SelectItem>
                  <SelectItem value="5000">5000</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-gray-700">per page</span>
            </div>
            <div className="text-sm text-gray-700">
              Total: <span className="font-medium">{stationsData?.total || 0}</span> stations
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="flex-1 flex justify-between sm:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(Math.max(1, filters.page! - 1))}
                  disabled={filters.page === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500 self-center">
                  Page {filters.page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(Math.min(totalPages, filters.page! + 1))}
                  disabled={filters.page === totalPages}
                >
                  Next
                </Button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing{' '}
                    <span className="font-medium">
                      {((filters.page! - 1) * filters.limit!) + 1}
                    </span>{' '}
                    to{' '}
                    <span className="font-medium">
                      {Math.min(filters.page! * filters.limit!, stationsData?.total || 0)}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium">{stationsData?.total || 0}</span>{' '}
                    results
                  </p>
                </div>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => handlePageChange(Math.max(1, filters.page! - 1))}
                        className={filters.page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                    
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      const pageNum = i + 1;
                      return (
                        <PaginationItem key={pageNum}>
                          <PaginationLink
                            onClick={() => handlePageChange(pageNum)}
                            isActive={filters.page === pageNum}
                            className="cursor-pointer"
                          >
                            {pageNum}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    })}
                    
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => handlePageChange(Math.min(totalPages, filters.page! + 1))}
                        className={filters.page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Station Form Modal */}
      <StationForm
        station={editingStation}
        open={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingStation(undefined);
        }}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* AI Generation Progress Dialog */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              AI Description Generation
            </DialogTitle>
            <DialogDescription>
              {aiJobStatus?.status === 'completed' 
                ? 'AI generation completed successfully!'
                : aiJobStatus?.status === 'failed'
                ? 'AI generation failed'
                : 'Generating custom AI descriptions for your stations...'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {aiJobStatus && (
              <>
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-600">Progress</span>
                    <span className="font-medium">
                      {aiJobStatus.processed} / {aiJobStatus.total}
                    </span>
                  </div>
                  <Progress 
                    value={(aiJobStatus.processed / aiJobStatus.total) * 100} 
                    className="h-2"
                  />
                </div>

                {/* Stats with Tabs for Details */}
                <Tabs defaultValue="successful" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 mb-4">
                    <TabsTrigger value="successful" data-testid="stats-successful" className="flex flex-col items-center gap-1">
                      <div className="text-lg font-bold text-green-600">{aiJobStatus.successful}</div>
                      <div className="text-xs">Successful</div>
                    </TabsTrigger>
                    <TabsTrigger value="failed" data-testid="stats-failed" className="flex flex-col items-center gap-1">
                      <div className="text-lg font-bold text-red-600">{aiJobStatus.failed}</div>
                      <div className="text-xs">Failed</div>
                    </TabsTrigger>
                    <TabsTrigger value="skipped" data-testid="stats-skipped" className="flex flex-col items-center gap-1">
                      <div className="text-lg font-bold text-gray-600">{aiJobStatus.skipped}</div>
                      <div className="text-xs">Skipped</div>
                    </TabsTrigger>
                  </TabsList>

                  {/* Successful Stations Tab */}
                  <TabsContent value="successful" className="space-y-2 max-h-64 overflow-y-auto">
                    {(aiJobStatus as any).successfulStations && (aiJobStatus as any).successfulStations.length > 0 ? (
                      (aiJobStatus as any).successfulStations.map((station: any, idx: number) => (
                        <div key={idx} className="p-2 bg-green-50 rounded border border-green-200 text-sm" data-testid={`successful-station-${idx}`}>
                          <div className="font-medium text-green-900">{station.name}</div>
                          <div className="text-xs text-green-700">✅ Translated to: {station.languages.join(', ')}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500">No successful translations yet</div>
                    )}
                  </TabsContent>

                  {/* Failed Stations Tab */}
                  <TabsContent value="failed" className="space-y-2 max-h-64 overflow-y-auto">
                    {(aiJobStatus as any).failedStations && (aiJobStatus as any).failedStations.length > 0 ? (
                      (aiJobStatus as any).failedStations.map((station: any, idx: number) => (
                        <div key={idx} className="p-2 bg-red-50 rounded border border-red-200 text-sm" data-testid={`failed-station-${idx}`}>
                          <div className="font-medium text-red-900">{station.name}</div>
                          <div className="text-xs text-red-700">❌ Error: {station.error}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500">No failed translations</div>
                    )}
                  </TabsContent>

                  {/* Skipped Stations Tab */}
                  <TabsContent value="skipped" className="space-y-2 max-h-64 overflow-y-auto">
                    {(aiJobStatus as any).skippedStations && (aiJobStatus as any).skippedStations.length > 0 ? (
                      (aiJobStatus as any).skippedStations.map((station: any, idx: number) => (
                        <div key={idx} className="p-2 bg-gray-50 rounded border border-gray-200 text-sm" data-testid={`skipped-station-${idx}`}>
                          <div className="font-medium text-gray-900">{station.name}</div>
                          <div className="text-xs text-gray-600">⏭️ Reason: {station.reason}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500">No skipped stations</div>
                    )}
                  </TabsContent>
                </Tabs>

                {aiJobStatus.status === 'running' && (
                  <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div>
                      <div className="text-xs font-semibold text-gray-700 mb-1">Current Station</div>
                      <div className="text-sm font-medium text-gray-900">{aiJobStatus.currentStation || 'Loading...'}</div>
                    </div>
                    
                    {aiJobStatus.currentAction && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-1">Current Action</div>
                        <div className="text-sm text-gray-900 capitalize">
                          {aiJobStatus.currentAction === 'generating' && '🤖 Generating AI description...'}
                          {aiJobStatus.currentAction === 'translating' && `🌍 Translating to: ${aiJobStatus.currentLanguage || 'processing...'}`}
                          {aiJobStatus.currentAction === 'saving' && `💾 Saving ${aiJobStatus.currentLanguage || '...'}`}
                          {aiJobStatus.currentAction === 'idle' && '⏳ Preparing...'}
                        </div>
                      </div>
                    )}
                    
                    {aiJobStatus.targetLanguages && aiJobStatus.targetLanguages.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-1">Target Languages ({aiJobStatus.targetLanguages.length})</div>
                        <div className="text-xs text-gray-600 flex flex-wrap gap-1">
                          {aiJobStatus.targetLanguages.map((lang: string) => (
                            <span key={lang} className="bg-white px-2 py-1 rounded border border-gray-200">
                              {lang.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {aiJobStatus.status === 'running' && (
                  <div className="space-y-2">
                    <div className="text-xs text-blue-700 p-2 bg-blue-50 rounded border border-blue-200">
                      ℹ️ <strong>Processing continues in background</strong> even if you close this dialog. You can safely close and come back later to check progress.
                    </div>
                    <Button 
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        if (bulkAiJobId) {
                          try {
                            await apiRequest('POST', `/api/admin/stations/description-job/${bulkAiJobId}/cancel`);
                            toast({
                              title: "Job Cancelled",
                              description: "The AI description generation job has been cancelled.",
                            });
                          } catch (error) {
                            toast({
                              title: "Error",
                              description: "Failed to cancel job",
                              variant: "destructive",
                            });
                          }
                        }
                      }}
                      data-testid="button-cancel-ai-job"
                    >
                      Cancel Job
                    </Button>
                  </div>
                )}

                {aiJobStatus.status === 'completed' && (
                  <Button 
                    onClick={() => {
                      setShowAiDialog(false);
                      setBulkAiJobId(null);
                      refetch(); // Refresh station list
                    }}
                    className="w-full"
                  >
                    Done
                  </Button>
                )}

                {aiJobStatus.status === 'failed' && (
                  <div className="text-sm text-red-600 p-3 bg-red-50 rounded">
                    Error: {aiJobStatus.error || 'Unknown error occurred'}
                  </div>
                )}

                {aiJobStatus.status === 'cancelled' && (
                  <div className="space-y-2">
                    <div className="text-sm text-orange-700 p-3 bg-orange-50 rounded border border-orange-200">
                      🛑 Job cancelled. Processed {aiJobStatus.processed || 0} of {aiJobStatus.total || 0} stations before cancellation.
                    </div>
                    <Button 
                      onClick={() => {
                        setShowAiDialog(false);
                        setBulkAiJobId(null);
                        refetch();
                      }}
                      className="w-full"
                      data-testid="button-close-cancelled-job"
                    >
                      Close
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Translated Names Detection Dialog */}
      <Dialog open={showTranslatedNamesDialog} onOpenChange={setShowTranslatedNamesDialog}>
        <DialogContent className="sm:max-w-2xl bg-white max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Stations with Translated Names
            </DialogTitle>
            <DialogDescription>
              These stations have descriptions where the station name was translated instead of preserved.
              Fix will regenerate descriptions from the station's native language.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {translatedNamesData?.stations && translatedNamesData.stations.length > 0 ? (
              translatedNamesData.stations.slice(0, 50).map((station: any, idx: number) => (
                <div key={idx} className="p-3 bg-orange-50 rounded border border-orange-200 text-sm">
                  <div className="font-medium text-orange-900">{station.name}</div>
                  <div className="text-xs text-orange-700">
                    Country: {station.country} ({station.countryCode}) | 
                    Issues in: {station.problematicLanguages.join(', ')}
                  </div>
                  <div className="text-xs text-gray-600 mt-1 truncate">
                    {station.sampleIssue}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 text-center py-8">
                No stations with translated names found.
              </div>
            )}
            {translatedNamesData && translatedNamesData.total > 50 && (
              <div className="text-sm text-gray-500 text-center py-2">
                Showing 50 of {translatedNamesData.total} stations
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={() => setShowTranslatedNamesDialog(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (translatedNamesData?.stations) {
                  handleFixTranslatedNames(translatedNamesData.stations.map((s: any) => s._id));
                }
              }}
              disabled={!translatedNamesData?.stations || translatedNamesData.stations.length === 0}
              className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white"
            >
              Fix All ({translatedNamesData?.total || 0} stations)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
