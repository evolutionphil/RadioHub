import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Edit, Eye, EyeOff, Plus, Image as ImageIcon, Trash2, Globe, Filter, Search, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface GenreCleanupDemotion {
  reason: 'empty-slug' | 'collision';
  originalSlug?: string;
  normalizedSlug?: string;
  collisionWinnerId?: string;
  collisionWinnerSlug?: string;
  collisionWinnerName?: string;
  demotedAt?: string;
}

interface Genre {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  stationCount: number;
  posterImage?: string;
  discoverableImage?: string;
  discoverable?: boolean;
  isDiscoverable?: boolean;
  displayOrder?: number;
  cleanupDemotion?: GenreCleanupDemotion;
  createdAt: string;
  updatedAt?: string;
}

export default function AdminGenres() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [discoverableImagePreview, setDiscoverableImagePreview] = useState<string>("");
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    discoverable: false,
    posterImage: "",
    discoverableImage: "",
    displayOrder: 0
  });

  // State for filters and pagination
  const [filters, setFilters] = useState({
    showDiscoverableOnly: false,
    showDemotedOnly: false,
    sortBy: 'stationCount',
    searchQuery: ''
  });
  
  // Debounced search input - separate from actual filter to avoid API call on every keystroke
  const [searchInput, setSearchInput] = useState('');
  
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50
  });
  
  // Debounce search input - only update filters after user stops typing for 500ms
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setFilters(prev => ({ ...prev, searchQuery: searchInput }));
      setPagination(prev => ({ ...prev, page: 1 })); // Reset to page 1 when searching
    }, 500);
    
    return () => clearTimeout(debounceTimer);
  }, [searchInput]);

  // Fetch all genres from database (paginated) - using admin endpoint
  const { data: genresResponse, isLoading, error } = useQuery({
    queryKey: ['/api/admin/genres', pagination.page, pagination.limit, filters.sortBy, filters.searchQuery, filters.showDiscoverableOnly, filters.showDemotedOnly],
    queryFn: async () => {
      // Build query parameters
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy: filters.sortBy,
      });
      
      // Add search query if present
      if (filters.searchQuery) {
        params.append('search', filters.searchQuery);
      }

      // Server-side filter: only genres auto-demoted by the slug-cleanup
      // migration (Task #133). Recorded by
      // `cleanup-malformed-genre-slugs.ts` in `cleanupDemotion`.
      if (filters.showDemotedOnly) {
        params.append('demoted', '1');
      }
      
      // Fetch genres from admin endpoint with server-side filtering
      const response = await fetch(`/api/admin/genres?${params}`);
      if (!response.ok) throw new Error(`Failed to fetch genres: ${response.status}`);
      const data = await response.json();
      
      // Apply client-side discoverable filter only (search is now server-side)
      let filteredGenres = data.data || [];
      
      if (filters.showDiscoverableOnly) {
        filteredGenres = filteredGenres.filter((g: Genre) => g.isDiscoverable || g.discoverable);
      }
      
      return {
        data: filteredGenres,
        count: data.total,
        currentPage: data.currentPage || pagination.page,
        totalPages: data.totalPages || 1,
        perPage: pagination.limit
      };
    },
  });
  
  const genres = genresResponse?.data || [];
  const totalGenres = genresResponse?.count || 0;
  const totalPages = genresResponse?.totalPages || 1;


  // Reset form when dialogs close
  useEffect(() => {
    if (!isEditDialogOpen && !isCreateDialogOpen) {
      setFormData({
        name: "",
        description: "",
        discoverable: false,
        posterImage: "",
        discoverableImage: "",
        displayOrder: 0
      });
      setSelectedGenre(null);
      setDiscoverableImagePreview("");
    }
  }, [isEditDialogOpen, isCreateDialogOpen]);

  // Populate form when editing
  useEffect(() => {
    if (selectedGenre && isEditDialogOpen) {
      setFormData({
        name: selectedGenre.name || "",
        description: selectedGenre.description || "",
        discoverable: selectedGenre.discoverable || selectedGenre.isDiscoverable || false,
        posterImage: "",
        discoverableImage: selectedGenre.discoverableImage || "",
        displayOrder: selectedGenre.displayOrder || 0
      });
      setDiscoverableImagePreview(selectedGenre.discoverableImage || "");
    }
  }, [selectedGenre, isEditDialogOpen]);

  // Handle discoverable image upload with standard file input
  const handleDiscoverableImageUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/genres/upload/discoverable', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const { url } = await response.json();
      
      // Update form data and preview
      setFormData(prev => ({ ...prev, discoverableImage: url }));
      setDiscoverableImagePreview(url);
      
      toast({
        title: "Image Uploaded",
        description: "Genre image uploaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload Error",
        description: error.message || "Failed to upload image.",
        variant: "destructive",
      });
    }
  };

  // Create genre mutation
  const createMutation = useMutation({
    mutationFn: async (genreData: any) => {
      const response = await fetch('/api/genres', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(genreData),
      });
      
      if (!response.ok) throw new Error('Failed to create genre');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/genres'] });
      queryClient.invalidateQueries({ queryKey: ['/api/genres/discoverable'] });
      toast({
        title: "Genre Created",
        description: "The genre has been created successfully.",
      });
      setIsCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create genre.",
        variant: "destructive",
      });
    },
  });

  // Update genre mutation - always uses PUT endpoint (backend handles dynamic conversion)
  const updateMutation = useMutation({
    mutationFn: async ({ id, genreData }: { id: string; genreData: any }) => {
      // Always use PUT endpoint - backend handles both real genres and dynamic genre conversion
      const response = await fetch(`/api/genres/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(genreData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update genre');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/genres'] });
      queryClient.invalidateQueries({ queryKey: ['/api/genres/discoverable'] });
      toast({
        title: "Genre Saved",
        description: "The genre has been saved successfully.",
      });
      setIsEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save genre.",
        variant: "destructive",
      });
    },
  });

  // Merge demoted genre into a winner (Task #166 + Task #214).
  // When `targetGenreId` is supplied the admin-picked target overrides the
  // recorded `cleanupDemotion.collisionWinnerId`, which also unlocks the
  // action for empty-slug demotions and older rows missing the pointer.
  const mergeIntoWinnerMutation = useMutation({
    mutationFn: async ({
      id,
      targetGenreId,
    }: {
      id: string;
      targetGenreId?: string;
    }) => {
      const response = await fetch(`/api/admin/genres/${id}/merge-into-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetGenreId ? { targetGenreId } : {}),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to merge stations into winner');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/genres'] });
      queryClient.invalidateQueries({ queryKey: ['/api/genres/discoverable'] });
      toast({
        title: 'Stations Merged',
        description: `${data.stationsRetagged} station(s) re-tagged onto "${data.winnerGenreName}". Demoted row deleted.`,
      });
      setMergePickerGenre(null);
      setMergePickerSearch('');
    },
    onError: (error: any) => {
      toast({
        title: 'Merge Failed',
        description: error.message || 'Failed to merge stations into winner.',
        variant: 'destructive',
      });
    },
  });

  const handleMergeIntoWinner = (genre: Genre) => {
    const winnerLabel =
      genre.cleanupDemotion?.collisionWinnerName ||
      genre.cleanupDemotion?.collisionWinnerSlug ||
      'the winner';
    if (
      !confirm(
        `Re-tag every station currently attached to "${genre.name}" onto "${winnerLabel}", then delete the demoted row? This cannot be undone.`,
      )
    ) {
      return;
    }
    mergeIntoWinnerMutation.mutate({ id: genre._id });
  };

  // Task #214: manual merge picker — admin chooses any live genre as the
  // winner, covering empty-slug demotions and older rows missing a recorded
  // `collisionWinnerId`.
  const [mergePickerGenre, setMergePickerGenre] = useState<Genre | null>(null);
  const [mergePickerSearch, setMergePickerSearch] = useState('');
  const [mergePickerDebouncedSearch, setMergePickerDebouncedSearch] =
    useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setMergePickerDebouncedSearch(mergePickerSearch.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [mergePickerSearch]);

  // Reset search when the picker opens for a new genre.
  useEffect(() => {
    if (mergePickerGenre) {
      setMergePickerSearch('');
      setMergePickerDebouncedSearch('');
    }
  }, [mergePickerGenre]);

  const { data: mergePickerResults, isFetching: mergePickerLoading } = useQuery({
    queryKey: ['/api/admin/genres/merge-picker', mergePickerDebouncedSearch],
    enabled: !!mergePickerGenre,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: '1',
        limit: '20',
        sortBy: 'stationCount',
      });
      if (mergePickerDebouncedSearch) {
        params.append('search', mergePickerDebouncedSearch);
      }
      const response = await fetch(`/api/admin/genres?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to search genres: ${response.status}`);
      }
      const data = await response.json();
      // Drop the demoted row itself and any other demoted rows — admins
      // should only be able to merge into a live, non-demoted target.
      const list: Genre[] = (data.data || []).filter(
        (g: Genre) =>
          !g.cleanupDemotion && (!mergePickerGenre || g._id !== mergePickerGenre._id),
      );
      return list;
    },
  });

  const handleConfirmManualMerge = (target: Genre) => {
    if (!mergePickerGenre) return;
    if (
      !confirm(
        `Re-tag every station currently attached to "${mergePickerGenre.name}" onto "${target.name}", then delete the demoted row? This cannot be undone.`,
      )
    ) {
      return;
    }
    mergeIntoWinnerMutation.mutate({
      id: mergePickerGenre._id,
      targetGenreId: target._id,
    });
  };

  // Delete genre mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/genres/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete genre');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/genres'] });
      toast({
        title: "Genre Deleted",
        description: "The genre has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete genre.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedGenre) {
      updateMutation.mutate({ id: selectedGenre._id, genreData: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (genre: Genre) => {
    // For dynamic genres, keep the original ID so we can use the UPDATE endpoint
    // The backend now handles dynamic genre conversion properly in PUT /api/genres/:id
    setSelectedGenre(genre);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this genre?')) {
      deleteMutation.mutate(id);
    }
  };

  // Handle filter changes (trigger new API call)
  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page when filtering
  };
  
  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  // Reset all genres to non-discoverable
  const handleResetAll = async () => {
    if (!confirm('Reset ALL genres to non-discoverable? This cannot be undone.')) return;
    
    try {
      const response = await fetch('/api/admin/reset-genres-discoverable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error('Failed to reset genres');
      
      const data = await response.json();
      toast({
        title: "Reset Complete",
        description: `${data.modifiedCount} genres reset to non-discoverable.`
      });
      
      // Refetch genres
      queryClient.invalidateQueries({ queryKey: ['/api/admin/genres'] });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reset genres",
        variant: "destructive"
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Genres Management</h1>
        <div className="flex gap-2">
          <Button 
            variant="destructive" 
            onClick={handleResetAll}
            data-testid="button-reset-all-genres"
          >
            Reset All to Non-Discoverable
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Genre
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
            <DialogHeader>
              <DialogTitle className="text-gray-900">Create New Genre</DialogTitle>
              <DialogDescription className="text-gray-600">
                Add a new genre to the system.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="text-gray-700">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Genre name"
                    className="bg-white border-gray-300 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="description" className="text-gray-700">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Genre description"
                    className="bg-white border-gray-300 text-gray-900"
                    rows={3}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="discoverable"
                    checked={formData.discoverable}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, discoverable: checked }))}
                  />
                  <Label htmlFor="discoverable" className="text-gray-700">Discoverable</Label>
                </div>
                {formData.discoverable && (
                  <div>
                    <Label htmlFor="genre-image" className="text-gray-700">Discoverable Genre Image</Label>
                    <Input
                      id="genre-image"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleDiscoverableImageUpload(file);
                        }
                      }}
                      className="bg-white border-gray-300 text-gray-900"
                    />
                    {discoverableImagePreview && (
                      <div className="mt-2">
                        <img src={discoverableImagePreview} alt="Discoverable Preview" className="w-24 h-16 object-cover rounded" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Genre'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Info Alert */}
      <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <AlertTriangle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800 dark:text-green-200">
          <strong>Real Genres Only:</strong> 
          <span className="ml-2">This page shows only real genres from your database that you can directly edit with custom images and discoverable settings. Dynamic genres are not shown here.</span>
        </AlertDescription>
      </Alert>

      {/* Filter Controls */}
      <div className="flex gap-4 items-center p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        
        {/* Search Filter */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search genres..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 w-48"
              data-testid="input-search-genres"
            />
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="discoverable-filter"
            checked={filters.showDiscoverableOnly}
            onCheckedChange={(checked) => 
              handleFilterChange({ showDiscoverableOnly: checked })
            }
          />
          <Label htmlFor="discoverable-filter" className="text-sm">
            Show only discoverable
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="demoted-filter"
            checked={filters.showDemotedOnly}
            onCheckedChange={(checked) =>
              handleFilterChange({
                showDemotedOnly: checked,
                // When opting in, default the sort to "most recently demoted"
                // so the freshest cleanup output is at the top.
                ...(checked ? { sortBy: 'demotedAt' } : {}),
              })
            }
            data-testid="switch-show-demoted-only"
          />
          <Label htmlFor="demoted-filter" className="text-sm">
            Recently demoted by slug cleanup
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Label className="text-sm">Sort by:</Label>
          <Select 
            value={filters.sortBy} 
            onValueChange={(value) => handleFilterChange({ sortBy: value })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stationCount">Station Count</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="recent">Created Date</SelectItem>
              <SelectItem value="demotedAt">Recently Demoted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="ml-auto text-sm text-muted-foreground">
          Showing {genres.length} of {totalGenres} genres (Page {pagination.page} of {totalPages})
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {genres.map((genre: Genre) => (
          <Card key={genre._id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{genre.name}</CardTitle>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(genre)}
                    title="Edit genre"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(genre._id)}
                    title="Delete genre"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {genre.posterImage && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Regular</p>
                      <img 
                        src={genre.posterImage} 
                        alt={`${genre.name} regular`}
                        className="w-full h-20 object-cover rounded"
                      />
                    </div>
                  )}
                  {genre.discoverableImage && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Discoverable</p>
                      <img 
                        src={genre.discoverableImage} 
                        alt={`${genre.name} discoverable`}
                        className="w-full h-20 object-cover rounded"
                      />
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{genre.description}</p>
                {genre.cleanupDemotion && (
                  <Alert
                    className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
                    data-testid={`alert-cleanup-demoted-${genre._id}`}
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    <AlertDescription className="text-amber-900 dark:text-amber-200 text-xs space-y-1">
                      <div>
                        <strong>Demoted by slug cleanup</strong>
                        {genre.cleanupDemotion.demotedAt && (
                          <span className="text-muted-foreground ml-1">
                            ({new Date(genre.cleanupDemotion.demotedAt).toLocaleDateString()})
                          </span>
                        )}
                      </div>
                      <div>
                        Original slug:{' '}
                        <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">
                          {genre.cleanupDemotion.originalSlug || '(empty)'}
                        </code>
                      </div>
                      {genre.cleanupDemotion.reason === 'collision' ? (
                        <>
                          <div>
                            Normalized to:{' '}
                            <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">
                              {genre.cleanupDemotion.normalizedSlug}
                            </code>
                          </div>
                          <div>
                            Collides with:{' '}
                            <strong>
                              {genre.cleanupDemotion.collisionWinnerName || '(unknown)'}
                            </strong>
                            {genre.cleanupDemotion.collisionWinnerSlug && (
                              <>
                                {' '}
                                <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">
                                  {genre.cleanupDemotion.collisionWinnerSlug}
                                </code>
                              </>
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            Either delete this row, or rename + re-enable to a unique slug.
                            Stations were not auto-merged.
                          </div>
                          {genre.cleanupDemotion.collisionWinnerId && (
                            <div className="pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
                                onClick={() => handleMergeIntoWinner(genre)}
                                disabled={
                                  mergeIntoWinnerMutation.isPending &&
                                  mergeIntoWinnerMutation.variables?.id === genre._id &&
                                  !mergeIntoWinnerMutation.variables?.targetGenreId
                                }
                                data-testid={`button-merge-into-winner-${genre._id}`}
                              >
                                {mergeIntoWinnerMutation.isPending &&
                                mergeIntoWinnerMutation.variables?.id === genre._id &&
                                !mergeIntoWinnerMutation.variables?.targetGenreId
                                  ? 'Merging…'
                                  : 'Merge stations into winner'}
                              </Button>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div>
                            Reason: original slug had no safe characters and could not be
                            normalized.
                          </div>
                          <div className="text-muted-foreground">
                            Either delete this row, or rename + re-enable with a real slug.
                          </div>
                        </>
                      )}
                      {/* Task #214: manual merge picker — works for both
                          empty-slug and collision demotions, including older
                          rows missing a recorded `collisionWinnerId`. */}
                      <div className="pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
                          onClick={() => setMergePickerGenre(genre)}
                          data-testid={`button-merge-into-picker-${genre._id}`}
                        >
                          Merge into…
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-2">
                    <Badge variant="secondary">
                      {genre.stationCount} stations
                    </Badge>
                    <Badge variant="default" className="bg-green-600">
                      Real
                    </Badge>
                  </div>
                  {(genre.discoverable || genre.isDiscoverable) ? (
                    <Badge variant="default">
                      <Globe className="w-3 h-3 mr-1" />
                      Discoverable
                    </Badge>
                  ) : genre.cleanupDemotion ? (
                    <Badge variant="outline" className="border-amber-400 text-amber-800">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Demoted
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <EyeOff className="w-3 h-3 mr-1" />
                      Regular Only
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Page {pagination.page} of {totalPages} ({totalGenres} total genres)
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            
            {/* Page numbers */}
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.page <= 3) {
                  pageNum = i + 1;
                } else if (pagination.page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = pagination.page - 2 + i;
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === pagination.page ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    className="w-8 h-8 p-0"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Edit {selectedGenre?.name}</DialogTitle>
            <DialogDescription className="text-gray-600">
              Update the genre information.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name" className="text-gray-700">Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Genre name"
                  className="bg-white border-gray-300 text-gray-900"
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-description" className="text-gray-700">Description</Label>
                <Textarea
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Genre description"
                  className="bg-white border-gray-300 text-gray-900"
                  rows={3}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-discoverable"
                  checked={formData.discoverable}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, discoverable: checked }))}
                />
                <Label htmlFor="edit-discoverable" className="text-gray-700">Discoverable</Label>
              </div>
              {formData.discoverable && (
                <>
                  <div>
                    <Label htmlFor="edit-genre-image" className="text-gray-700">Discoverable Genre Image</Label>
                    <Input
                      id="edit-genre-image"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleDiscoverableImageUpload(file);
                        }
                      }}
                      className="bg-white border-gray-300 text-gray-900"
                    />
                    {discoverableImagePreview && (
                      <div className="mt-2">
                        <img src={discoverableImagePreview} alt="Discoverable Preview" className="w-24 h-16 object-cover rounded" />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      This image will be used for global discoverable genres display
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="edit-display-order" className="text-gray-700">Display Order</Label>
                    <Input
                      id="edit-display-order"
                      type="number"
                      min="0"
                      value={formData.displayOrder}
                      onChange={(e) => setFormData(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Order in slider (0 = first, higher = later)"
                      className="bg-white border-gray-300 text-gray-900"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Lower numbers appear earlier in the discover slider
                    </p>
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Updating...' : 'Update Genre'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Task #214: manual "Merge into…" picker dialog */}
      <Dialog
        open={!!mergePickerGenre}
        onOpenChange={(open) => {
          if (!open) setMergePickerGenre(null);
        }}
      >
        <DialogContent
          className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900"
          data-testid="dialog-merge-into-picker"
        >
          <DialogHeader>
            <DialogTitle className="text-gray-900">
              Merge "{mergePickerGenre?.name}" into…
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Pick a live genre to receive every station currently tagged with
              "{mergePickerGenre?.name}". The demoted row will be deleted after
              the merge. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search live genres…"
                value={mergePickerSearch}
                onChange={(e) => setMergePickerSearch(e.target.value)}
                className="pl-9 bg-white border-gray-300 text-gray-900"
                data-testid="input-merge-picker-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border border-gray-200 rounded">
              {mergePickerLoading ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Searching…
                </div>
              ) : !mergePickerResults || mergePickerResults.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No matching live genres.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {mergePickerResults.map((target) => {
                    const isMergingThis =
                      mergeIntoWinnerMutation.isPending &&
                      mergeIntoWinnerMutation.variables?.id ===
                        mergePickerGenre?._id &&
                      mergeIntoWinnerMutation.variables?.targetGenreId ===
                        target._id;
                    return (
                      <li
                        key={target._id}
                        className="flex items-center justify-between gap-2 p-2 hover:bg-gray-50"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {target.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            <code className="bg-gray-100 px-1 rounded">
                              {target.slug}
                            </code>{' '}
                            · {target.stationCount} stations
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleConfirmManualMerge(target)}
                          disabled={mergeIntoWinnerMutation.isPending}
                          data-testid={`button-merge-pick-target-${target._id}`}
                        >
                          {isMergingThis ? 'Merging…' : 'Merge'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergePickerGenre(null)}
              disabled={mergeIntoWinnerMutation.isPending}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}