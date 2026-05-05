import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Merge, AlertTriangle, CheckCircle, Trash2, Crown, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DuplicateGroup {
  name: string;
  country: string;
  duplicateCount: number;
  totalVotes: number;
  stations: Array<{
    _id: string;
    name: string;
    url: string;
    urlResolved?: string;
    votes: number;
    playbackSuccessCount: number;
    lastCheckOk: boolean;
    favicon?: string;
    localImagePath?: string;
    country: string;
  }>;
}

interface DuplicatesResponse {
  duplicateGroups: DuplicateGroup[];
  totalGroups: number;
  potentialMerges: number;
  message?: string;
  totalStations?: number;
}

export default function AdminDuplicates() {
  const { toast } = useToast();
  const [duplicates, setDuplicates] = useState<DuplicatesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [threshold, setThreshold] = useState([0.85]);
  const [mergeResults, setMergeResults] = useState<string[]>([]);
  const [processingMerge, setProcessingMerge] = useState<string | null>(null);
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  const [jobProgress, setJobProgress] = useState<{[jobId: string]: {step: string, percentage: number, groupsProcessed?: number, totalGroups?: number}}>({});
  
  // Selection state for deleting stations
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingStations, setIsDeletingStations] = useState(false);
  
  // Track manually selected primary stations per group (key: group name + country)
  const [selectedPrimaryStations, setSelectedPrimaryStations] = useState<{[groupKey: string]: string}>({});

  const activeIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    return () => {
      activeIntervalsRef.current.forEach(id => clearInterval(id));
      activeIntervalsRef.current.clear();
    };
  }, []);

  const detectDuplicates = async () => {
    setIsLoading(true);
    setMergeResults([]);
    setSelectedStations(new Set()); // Clear selections when detecting new duplicates
    try {
      const response = await fetch(`/api/admin/stations/duplicates?threshold=${threshold[0]}`);
      const data = await response.json();
      
      // Check for API errors
      if (!response.ok || data.error) {
        console.error('Duplicates API error:', data.error || response.statusText);
        toast({
          title: 'Error detecting duplicates',
          description: data.error || `HTTP ${response.status}: ${response.statusText}. Make sure you are logged in as an admin.`,
          variant: 'destructive'
        });
        setDuplicates(null);
        return;
      }
      
      // Transform the response to match our expected format
      const transformedData: DuplicatesResponse = {
        duplicateGroups: (data.duplicates || []).map((dup: any) => {
          // Handle both name-based groups (with _id.name and _id.country) and URL-based groups (with _id as URL string)
          const isUrlGroup = typeof dup._id === 'string';
          const name = isUrlGroup ? dup._id : (dup._id?.name || '');
          const country = isUrlGroup ? '' : (dup._id?.country || '');
          
          return {
            name: name || '',
            country: country || '',
            duplicateCount: dup.count || 0,
            totalVotes: (dup.stations || []).reduce((sum: number, s: any) => sum + (s.votes || 0), 0),
            stations: dup.stations || []
          };
        }),
        totalGroups: data.total || 0,
        potentialMerges: (data.duplicates || []).filter((d: any) => d.count > 1).length,
        totalStations: data.totalStations
      };
      
      // Sort stations within each group by votes (highest first)
      const sortedData: DuplicatesResponse = {
        ...transformedData,
        duplicateGroups: transformedData.duplicateGroups.map(group => ({
          ...group,
          stations: [...group.stations].sort((a, b) => (b.votes || 0) - (a.votes || 0))
        }))
      };
      
      setDuplicates(sortedData);
      
      // Show success message
      if (sortedData.duplicateGroups.length > 0) {
        toast({
          title: 'Duplicates found',
          description: `Found ${sortedData.totalGroups} duplicate groups with ${sortedData.potentialMerges} stations to merge.`
        });
      }
    } catch (error) {
      console.error('Failed to detect duplicates:', error);
      toast({
        title: 'Error',
        description: `Failed to detect duplicates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Get the group key for accessing selected primary stations
  const getGroupKey = (group: DuplicateGroup) => `${group.name}-${group.country}`;
  
  // Get the primary station (either manually selected or default to highest voted)
  const getPrimaryStationForGroup = (group: DuplicateGroup) => {
    const groupKey = getGroupKey(group);
    const selectedId = selectedPrimaryStations[groupKey];
    if (selectedId) {
      return group.stations.find(s => s._id === selectedId) || group.stations[0];
    }
    return group.stations[0]; // Default to highest voted
  };

  // Merge group keeping only the highest voted station
  const mergeKeepHighestVoted = async (group: DuplicateGroup) => {
    const primaryStation = getPrimaryStationForGroup(group);
    const duplicateIds = group.stations.filter(s => s._id !== primaryStation._id).map(s => s._id);
    
    setProcessingMerge(primaryStation._id);
    try {
      const response = await fetch('/api/admin/stations/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryStationId: primaryStation._id,
          duplicateStationIds: duplicateIds
        })
      });
      
      const result = await response.json();
      if (result.success && result.async) {
        setMergeResults(prev => [...prev, `🏆 Started merge keeping highest-voted: ${group.name} (${primaryStation.votes} votes)`]);
        setMergeResults(prev => [...prev, `🗑️  Will delete ${duplicateIds.length} duplicate station(s)`]);
        setMergeResults(prev => [...prev, `ℹ️ Merge is running in background. You can safely close this tab.`]);
        
        // Start polling for job status
        pollJobStatus(result.jobId, group.name);
      } else if (result.success) {
        // Fallback for synchronous response
        setMergeResults(prev => [...prev, `✅ Merged ${group.name}: Kept highest-voted station (${primaryStation.votes} votes), deleted ${duplicateIds.length} duplicates`]);
        await detectDuplicates();
      } else {
        setMergeResults(prev => [...prev, `❌ Failed to merge ${group.name}: ${result.error}`]);
      }
    } catch (error) {
      setMergeResults(prev => [...prev, `❌ Error merging ${group.name}: ${error}`]);
    } finally {
      setProcessingMerge(null);
    }
  };

  // Toggle station selection
  const toggleStationSelection = (stationId: string) => {
    setSelectedStations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stationId)) {
        newSet.delete(stationId);
      } else {
        newSet.add(stationId);
      }
      return newSet;
    });
  };

  // Toggle selection of all duplicates in a group (except the highest voted - index 0)
  const toggleSelectAllInGroup = (group: DuplicateGroup) => {
    const duplicateIds = new Set(group.stations.slice(1).map(s => s._id));
    setSelectedStations(prev => {
      const newSet = new Set(prev);
      const allSelected = Array.from(duplicateIds).every(id => newSet.has(id));
      
      if (allSelected) {
        // Deselect all duplicates in this group
        duplicateIds.forEach(id => newSet.delete(id));
      } else {
        // Select all duplicates in this group
        duplicateIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  // Check if all duplicates in a group are selected
  const areAllDuplicatesSelected = (group: DuplicateGroup): boolean => {
    const duplicateIds = group.stations.slice(1).map(s => s._id);
    return duplicateIds.length > 0 && duplicateIds.every(id => selectedStations.has(id));
  };

  // Select all duplicates across ALL groups (excluding highest-voted in each group)
  const selectAllDuplicates = () => {
    if (!duplicates?.duplicateGroups) return;
    
    const allDuplicateIds = new Set<string>();
    duplicates.duplicateGroups.forEach(group => {
      // Skip the highest-voted station (index 0) in each group
      group.stations.slice(1).forEach(station => {
        allDuplicateIds.add(station._id);
      });
    });
    setSelectedStations(allDuplicateIds);
    toast({
      title: 'Duplicates selected',
      description: `Selected ${allDuplicateIds.size} duplicate stations across all groups`,
    });
  };

  // Deselect all stations
  const deselectAll = () => {
    setSelectedStations(new Set());
    toast({
      title: 'Selection cleared',
      description: 'All stations have been deselected',
    });
  };

  // Delete selected stations (with favicon copying across all affected groups)
  const deleteSelectedStations = async () => {
    if (selectedStations.size === 0) {
      toast({
        title: 'No stations selected',
        description: 'Please select at least one station to delete',
        variant: 'destructive'
      });
      return;
    }

    setIsDeletingStations(true);
    try {
      // Helper function to check if a URL is valid (not null, empty, or string 'null'/'undefined')
      const isValidUrl = (url: string | null | undefined): boolean => {
        if (!url) return false;
        const trimmed = url.trim();
        return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
      };

      // SMART FAVICON COPYING: Check each group for favicon copying needs
      if (duplicates?.duplicateGroups) {
        let faviconsCopied = 0;
        
        for (const group of duplicates.duplicateGroups) {
          const groupStationIds = new Set(group.stations.map(s => s._id));
          const selectedInGroup = Array.from(selectedStations).filter(id => groupStationIds.has(id));
          
          if (selectedInGroup.length === 0) continue;
          
          // Find highest-voted station that's NOT being deleted
          const remainingStations = group.stations
            .filter(s => !selectedInGroup.includes(s._id))
            .sort((a, b) => (b.votes || 0) - (a.votes || 0));
          
          const highestVotedRemaining = remainingStations[0];
          
          // Check if highest-voted remaining station lacks BOTH favicon and localImagePath
          const remainingHasIcon = isValidUrl(highestVotedRemaining?.favicon) || isValidUrl(highestVotedRemaining?.localImagePath);
          
          // If highest-voted station exists and has NO icon (neither favicon nor localImagePath), try to copy one
          if (highestVotedRemaining && !remainingHasIcon) {
            // Find a favicon from stations being deleted (check BOTH favicon and localImagePath)
            const stationsBeingDeleted = group.stations.filter(s => selectedInGroup.includes(s._id));
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
              try {
                const updateResponse = await fetch(`/api/admin/stations/${highestVotedRemaining._id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ favicon: sourceFaviconUrl })
                });
                if (updateResponse.ok) {
                  faviconsCopied++;
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
        }
      }

      // Now delete the selected stations
      const response = await fetch('/api/admin/delete-stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationIds: Array.from(selectedStations) })
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Stations deleted',
          description: `Successfully deleted ${result.deletedCount} station(s)`,
        });
        setSelectedStations(new Set());
        setShowDeleteConfirm(false);
        // Refresh duplicates list
        await detectDuplicates();
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
    } finally {
      setIsDeletingStations(false);
    }
  };

  // Delete selected stations from a specific group
  const deleteSelectedFromGroup = async (group: DuplicateGroup) => {
    // Get selected stations that belong to this group
    const groupStationIds = new Set(group.stations.map(s => s._id));
    const selectedInGroup = Array.from(selectedStations).filter(id => groupStationIds.has(id));

    if (selectedInGroup.length === 0) {
      toast({
        title: 'No stations selected',
        description: 'Please select at least one station from this group to delete',
        variant: 'destructive'
      });
      return;
    }

    setIsDeletingStations(true);
    try {
      // SMART FAVICON COPYING: Find highest-voted station that's NOT being deleted
      const remainingStations = group.stations
        .filter(s => !selectedInGroup.includes(s._id))
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
        const stationsBeingDeleted = group.stations.filter(s => selectedInGroup.includes(s._id));
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
        body: JSON.stringify({ stationIds: selectedInGroup })
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Stations deleted',
          description: `Successfully deleted ${result.deletedCount} station(s) from this group`,
        });
        // Remove deleted stations from selection
        setSelectedStations(prev => {
          const newSet = new Set(prev);
          selectedInGroup.forEach(id => newSet.delete(id));
          return newSet;
        });
        // Refresh duplicates list
        await detectDuplicates();
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
    } finally {
      setIsDeletingStations(false);
    }
  };

  const mergeGroup = async (group: DuplicateGroup) => {
    const primaryStation = getPrimaryStationForGroup(group);
    const duplicateIds = group.stations.filter(s => s._id !== primaryStation._id).map(s => s._id);
    
    setProcessingMerge(primaryStation._id);
    try {
      const response = await fetch('/api/admin/stations/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryStationId: primaryStation._id,
          duplicateStationIds: duplicateIds
        })
      });
      
      const result = await response.json();
      if (result.success && result.async) {
        setMergeResults(prev => [...prev, `🔄 Started async merge for ${group.name} (Job ID: ${result.jobId})`]);
        setMergeResults(prev => [...prev, `ℹ️ Merge is running in background. You can safely close this tab.`]);
        
        // Start polling for job status
        pollJobStatus(result.jobId, group.name);
      } else if (result.success) {
        // Fallback for synchronous response
        setMergeResults(prev => [...prev, `✅ Merged ${group.name}: ${result.fallbackUrlsAdded} fallback URLs added`]);
        await detectDuplicates();
      } else {
        setMergeResults(prev => [...prev, `❌ Failed to merge ${group.name}: ${result.error}`]);
      }
    } catch (error) {
      setMergeResults(prev => [...prev, `❌ Error merging ${group.name}: ${error}`]);
    } finally {
      setProcessingMerge(null);
    }
  };

  const pollJobStatus = (jobId: string, groupName?: string) => {
    setActiveJobs(prev => new Set([...Array.from(prev), jobId]));

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/merge-jobs/${jobId}`);
        const job = await response.json();
        
        // Update progress display immediately
        if (job.progress?.currentStep) {
          setJobProgress(prev => ({
            ...prev,
            [jobId]: {
              step: job.progress.currentStep,
              percentage: job.progress.percentage || 0,
              groupsProcessed: job.progress.groupsProcessed,
              totalGroups: job.progress.totalGroups
            }
          }));
        }
        
        if (job.status === 'completed') {
          clearInterval(pollInterval);
          activeIntervalsRef.current.delete(jobId);
          setActiveJobs(prev => {
            const newSet = new Set(Array.from(prev));
            newSet.delete(jobId);
            return newSet;
          });
          setJobProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[jobId];
            return newProgress;
          });
          
          if (job.results) {
            const groupInfo = groupName ? ` for ${groupName}` : '';
            setMergeResults(prev => [...prev, `✅ Merge completed${groupInfo}: ${job.results.message}`]);
            
            // Display detailed merge information
            if (job.results.mergedStations?.length > 0) {
              job.results.mergedStations.forEach((merge: any) => {
                const mergedCount = merge.mergedStations.length;
                setMergeResults(prev => [...prev, 
                  `📻 ${merge.groupName} - Merged ${mergedCount} station${mergedCount > 1 ? 's' : ''} into primary station "${merge.primaryStation.name}" (${merge.primaryStation.country})`
                ]);
                
                // Show individual merged stations
                merge.mergedStations.forEach((station: any) => {
                  setMergeResults(prev => [...prev, 
                    `   • ${station.name} (${station.votes} votes) - ${station.url.substring(0, 50)}...`
                  ]);
                });
                
                setMergeResults(prev => [...prev, 
                  `   💾 Added ${merge.fallbackUrlsAdded} fallback URL${merge.fallbackUrlsAdded > 1 ? 's' : ''} • Total votes: ${merge.totalVotes}`
                ]);
              });
            }
            
            if (job.results.errors?.length > 0) {
              job.results.errors.forEach((error: string) => {
                setMergeResults(prev => [...prev, `⚠️ ${error}`]);
              });
            }
          }
          
          // Refresh duplicates after successful merge
          await detectDuplicates();
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          activeIntervalsRef.current.delete(jobId);
          setActiveJobs(prev => {
            const newSet = new Set(Array.from(prev));
            newSet.delete(jobId);
            return newSet;
          });
          setJobProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[jobId];
            return newProgress;
          });
          
          const groupInfo = groupName ? ` for ${groupName}` : '';
          setMergeResults(prev => [...prev, `❌ Merge failed${groupInfo}: ${job.errorMessage || 'Unknown error'}`]);
        } else if (job.status === 'running' && job.progress) {
          // Update progress if needed
          const progressInfo = `${job.progress.currentStep} (${job.progress.percentage || 0}%)`;
          const groupInfo = groupName ? ` ${groupName}:` : '';
          setMergeResults(prev => {
            const filtered = prev.filter(msg => !msg.includes(`🔄 Progress${groupInfo}`));
            return [...filtered, `🔄 Progress${groupInfo} ${progressInfo}`];
          });
        }
      } catch (error) {
        // Error polling job status
      }
    }, 1000);

    activeIntervalsRef.current.set(jobId, pollInterval);

    // Safety: stop polling after 10 minutes regardless of job status
    setTimeout(() => {
      clearInterval(pollInterval);
      activeIntervalsRef.current.delete(jobId);
      setActiveJobs(prev => {
        const newSet = new Set(Array.from(prev));
        newSet.delete(jobId);
        return newSet;
      });
    }, 600000);
  };

  const autoMergeAll = async (dryRun = true) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/auto-merge-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: threshold[0], dryRun })
      });
      
      const result = await response.json();
      if (result.success && result.async) {
        const actionType = dryRun ? 'DRY RUN' : 'LIVE MERGE';
        setMergeResults([`🔄 Started async ${actionType} (Job ID: ${result.jobId})`]);
        setMergeResults(prev => [...prev, `ℹ️ Auto-merge is running in background. You can safely close this tab.`]);
        
        // Start polling for job status
        pollJobStatus(result.jobId);
      } else if (result.success) {
        // Fallback for synchronous response
        if (dryRun) {
          setMergeResults([`🔍 DRY RUN: Would merge ${result.totalGroups} groups, deleting ${result.totalStationsToDelete} duplicate stations`]);
        } else {
          setMergeResults([`🎉 LIVE MERGE: Merged ${result.mergedGroups} groups, deleted ${result.totalStationsDeleted} duplicate stations`]);
          await detectDuplicates();
        }
      } else {
        setMergeResults([`❌ Auto-merge failed: ${result.error}`]);
      }
    } catch (error) {
      setMergeResults([`❌ Auto-merge failed: ${error}`]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-xl sm:text-3xl font-bold">Station Duplicate Management</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Detect and merge duplicate radio stations across the entire database
        </p>
      </div>

      {/* Detection Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Detection Settings</CardTitle>
          <CardDescription>
            Adjust similarity threshold and run duplicate detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Similarity Threshold: {threshold[0].toFixed(2)}
            </label>
            <Slider
              value={threshold}
              onValueChange={setThreshold}
              min={0.5}
              max={1.0}
              step={0.05}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = more strict matching. Recommended: 0.80-0.90
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Button 
              onClick={detectDuplicates} 
              disabled={isLoading}
              className="flex items-center gap-2 text-xs sm:text-sm"
              size="sm"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              <span className="hidden sm:inline">Detect</span> Duplicates
            </Button>
            
            {duplicates && (
              <>
                {duplicates.duplicateGroups.length > 0 ? (
                  <>
                    <Button 
                      onClick={() => autoMergeAll(true)} 
                      variant="outline"
                      disabled={isLoading}
                      size="sm"
                      className="text-xs sm:text-sm"
                    >
                      <span className="hidden sm:inline">Preview</span> Auto-Merge
                    </Button>
                    <Button 
                      onClick={() => autoMergeAll(false)} 
                      variant="destructive"
                      disabled={isLoading}
                      size="sm"
                      className="text-xs sm:text-sm"
                    >
                      <Trash2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Auto-Merge All</span>
                    </Button>
                  </>
                ) : (
                  <Button 
                    onClick={() => autoMergeAll(false)} 
                    variant="destructive"
                    disabled={isLoading}
                    size="sm"
                    className="text-xs sm:text-sm"
                  >
                    <Trash2 className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Auto-Merge All</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {duplicates && (
        <Alert>
          <CheckCircle className="h-4 w-4 hidden sm:block" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 sm:gap-0">
                <CheckCircle className="h-4 w-4 sm:hidden flex-shrink-0" />
                <span className="text-sm sm:text-base">
                  {duplicates.message || (
                    <>
                      Found <strong>{duplicates.totalGroups}</strong> duplicate groups with{' '}
                      <strong>{duplicates.potentialMerges}</strong> stations
                    </>
                  )}
                </span>
              </div>
              {duplicates.totalStations && (
                <div className="mt-1 text-xs sm:text-sm text-muted-foreground">
                  Total: {duplicates.totalStations.toLocaleString()} stations
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={selectAllDuplicates}
                size="sm"
                variant="outline"
                disabled={duplicates.potentialMerges === 0}
                data-testid="button-select-all-duplicates"
                className="text-xs"
              >
                <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Select All</span>
                <span className="sm:hidden">All</span>
              </Button>
              {selectedStations.size > 0 && (
                <>
                  <Button
                    onClick={deselectAll}
                    size="sm"
                    variant="outline"
                    data-testid="button-deselect-all"
                    className="text-xs"
                  >
                    <X className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Deselect</span>
                  </Button>
                  <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    size="sm"
                    variant="destructive"
                    disabled={isDeletingStations}
                    data-testid="button-delete-selected-global"
                    className="text-xs"
                  >
                    {isDeletingStations ? (
                      <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    )}
                    ({selectedStations.size})
                  </Button>
                </>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Active Jobs Status with Progress */}
      {activeJobs.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Active Merge Jobs ({activeJobs.size})
            </CardTitle>
            <CardDescription>
              Jobs are running in background. You can safely close this tab - merging will continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from(activeJobs).map(jobId => {
              const progress = jobProgress[jobId];
              return (
                <div key={jobId} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Job {jobId.substring(0, 8)}...</span>
                    <span className="text-sm text-muted-foreground">
                      {progress?.percentage || 0}%
                    </span>
                  </div>
                  <Progress value={progress?.percentage || 0} className="h-2" />
                  <div className="text-xs text-muted-foreground">
                    {progress?.step || 'Initializing...'}
                    {progress?.groupsProcessed && progress?.totalGroups && (
                      <span className="ml-2">
                        ({progress.groupsProcessed}/{progress.totalGroups} groups)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Merge Results */}
      {mergeResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Merge Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-sm">
              {mergeResults.map((result, index) => (
                <div key={index} className="p-2 bg-muted rounded">
                  {result}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Duplicate Groups */}
      {duplicates?.duplicateGroups.map((group, index) => (
        <Card key={index}>
          <CardHeader className="p-3 sm:p-6">
            <div className="space-y-3">
              {/* Group Header - Mobile Responsive */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-1 sm:gap-2 text-sm sm:text-base">
                    <span className="truncate max-w-[200px] sm:max-w-none">"{group.name}"</span>
                    <span className="hidden sm:inline">-</span>
                    <Badge variant="secondary" className="text-xs">{group.country}</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm mt-1">
                    {group.duplicateCount} duplicate stations found
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={areAllDuplicatesSelected(group)}
                    onCheckedChange={() => toggleSelectAllInGroup(group)}
                    data-testid="checkbox-select-all-group"
                  />
                  <label className="text-xs sm:text-sm font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSelectAllInGroup(group)}>
                    Select All
                  </label>
                </div>
              </div>
              {/* Action Buttons - Mobile Grid */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:justify-end">
                <Button
                  onClick={() => mergeKeepHighestVoted(group)}
                  disabled={processingMerge === group.stations[0]._id}
                  size="sm"
                  variant="default"
                  className="flex items-center justify-center gap-1 sm:gap-2 bg-amber-600 hover:bg-amber-700 text-xs sm:text-sm"
                  data-testid="button-keep-highest"
                  title="Keep highest-voted station and delete all duplicates"
                >
                  {processingMerge === group.stations[0]._id ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  <span className="hidden sm:inline">Keep Highest</span>
                  <span className="sm:hidden">Keep Best</span>
                </Button>
                <Button
                  onClick={() => mergeGroup(group)}
                  disabled={processingMerge === group.stations[0]._id}
                  size="sm"
                  variant="outline"
                  className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
                  data-testid="button-merge-group"
                >
                  {processingMerge === group.stations[0]._id ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  ) : (
                    <Merge className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  Merge
                </Button>
                <Button
                  onClick={() => deleteSelectedFromGroup(group)}
                  disabled={isDeletingStations || !group.stations.some(s => selectedStations.has(s._id))}
                  size="sm"
                  variant="destructive"
                  className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
                  data-testid="button-delete-group-selected"
                  title="Delete selected stations from this group"
                >
                  {isDeletingStations ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  <span className="hidden sm:inline">Delete Selected</span>
                  <span className="sm:hidden">Delete</span>
                </Button>
                <Button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={selectedStations.size === 0 || isDeletingStations}
                  size="sm"
                  variant="outline"
                  className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm border-destructive text-destructive hover:bg-destructive/10"
                  data-testid="button-delete-selected"
                >
                  {isDeletingStations ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  <span className="hidden sm:inline">Global</span> ({selectedStations.size})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2 sm:p-6">
            <div className="space-y-2 sm:space-y-3">
              <RadioGroup 
                value={selectedPrimaryStations[getGroupKey(group)] || group.stations[0]._id}
                onValueChange={(value) => {
                  setSelectedPrimaryStations(prev => ({
                    ...prev,
                    [getGroupKey(group)]: value
                  }));
                }}
              >
                {group.stations.map((station, stationIndex) => {
                  const isSelected = (selectedPrimaryStations[getGroupKey(group)] === station._id) || 
                                   (!selectedPrimaryStations[getGroupKey(group)] && stationIndex === 0);
                  
                  return (
                    <div key={station._id}>
                      {/* Mobile-First Station Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-2 sm:p-3 rounded border hover:bg-muted/50 transition-colors gap-2">
                        {/* Left Side: Controls + Station Info */}
                        <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
                          {/* Radio + Checkbox + Favicon */}
                          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                            <RadioGroupItem 
                              value={station._id} 
                              id={`primary-${station._id}`}
                              data-testid={`radio-primary-${station._id}`}
                              className="h-4 w-4"
                            />
                            {isSelected && <Crown className="h-3 w-3 sm:h-4 sm:w-4 text-amber-600" />}
                            {stationIndex !== 0 && (
                              <Checkbox
                                checked={selectedStations.has(station._id)}
                                onCheckedChange={() => {
                                  toggleStationSelection(station._id);
                                }}
                                data-testid={`checkbox-station-${station._id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4"
                              />
                            )}
                            {station.favicon && (
                              <img 
                                src={station.favicon} 
                                alt={`${station.name} logo`}
                                className="w-6 h-6 sm:w-8 sm:h-8 rounded flex-shrink-0"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            )}
                          </div>
                          {/* Station Name + URL */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="font-medium text-sm sm:text-base truncate">{station.name}</div>
                            <div className="text-xs sm:text-sm text-muted-foreground truncate max-w-full">
                              {station.url}
                            </div>
                          </div>
                        </div>
                        {/* Right Side: Badges + Status */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 sm:flex-col sm:items-end ml-6 sm:ml-0">
                          <div className="flex gap-1 sm:gap-2 flex-wrap">
                            {isSelected ? (
                              <Badge variant="default" className="bg-amber-600 hover:bg-amber-700 text-[10px] sm:text-xs px-1 sm:px-2">
                                👑 <span className="hidden sm:inline">PRIMARY</span>
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] sm:text-xs px-1 sm:px-2">
                                DUP
                              </Badge>
                            )}
                            <Badge className="bg-blue-600 text-white hover:bg-blue-700 text-[10px] sm:text-xs px-1 sm:px-2">
                              {station.votes} votes
                            </Badge>
                          </div>
                          <div className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
                            {station.lastCheckOk ? "✅" : "❌"} <span className="hidden sm:inline">{station.lastCheckOk ? "Working" : "Offline"}</span>
                          </div>
                        </div>
                      </div>
                      {stationIndex < group.stations.length - 1 && <Separator className="my-1" />}
                    </div>
                  );
                })}
              </RadioGroup>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Empty State */}
      {duplicates && duplicates.duplicateGroups.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No Duplicates Found</h3>
            <p className="text-muted-foreground">
              Your database is clean! No duplicate stations detected at threshold {threshold[0].toFixed(2)}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Stations?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedStations.size} station(s)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingStations} data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedStations}
              disabled={isDeletingStations}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeletingStations ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}