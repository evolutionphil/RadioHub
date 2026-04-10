import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Play, Pause, Trash2, ArrowUpDown, Radio, Circle, Sparkles } from "lucide-react";
import { useState, useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
// MongoDB stations use _id instead of id
interface MongoStation {
  _id: string;
  name: string;
  url: string;
  country?: string;
  countryName?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  clickCount?: number;
  clickTrend?: number | null;
  lastCheckOk?: boolean;
  tags?: string;
  favicon?: string;
  localImagePath?: string;
  homepage?: string;
  [key: string]: any;
}



interface StationTableProps {
  stations: MongoStation[];
  onEdit: (station: MongoStation) => void;
  onDelete: (station: MongoStation) => void;
  onSort: (field: string) => void;
  onPlay: (station: MongoStation) => void;
  onGenerateAi?: (station: MongoStation) => void;
  onTranslate?: (station: MongoStation) => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  generatingStationId?: string | null;
  selectedStations?: Set<string>;
  onSelectedStationsChange?: (selected: Set<string>) => void;
}

export default function StationTable({
  stations,
  onEdit,
  onDelete,
  onSort,
  onPlay,
  onGenerateAi,
  onTranslate,
  sortBy,
  sortOrder,
  generatingStationId,
  selectedStations = new Set(),
  onSelectedStationsChange,
}: StationTableProps) {
  const { t } = useTranslation();

  const [playingStationId, setPlayingStationId] = useState<string | null>(null);
  const [loadingStationId, setLoadingStationId] = useState<string | null>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});


  // Properly manage which station is playing - automatically switches stations
  const updatePlayingState = (newPlayingId: string | null) => {
    // Updating playing state
    
    // Stop all other stations first when switching to a new one
    Object.keys(audioRefs.current).forEach(key => {
      if (key !== newPlayingId) {
        // Auto-stopping station
        stopCurrentStation(key);
      }
    });
    
    setPlayingStationId(newPlayingId);
  };

  const handleSelectAll = (checked: boolean) => {
    const newSelected = checked 
      ? new Set(stations.map(s => s._id))
      : new Set();
    onSelectedStationsChange?.(newSelected);
  };

  const handleSelectStation = (stationId: string, checked: boolean) => {
    const newSelected = new Set(selectedStations);
    if (checked) {
      newSelected.add(stationId);
    } else {
      newSelected.delete(stationId);
    }
    onSelectedStationsChange?.(newSelected);
  };

  const handlePlayStation = async (station: MongoStation) => {
    const stationId = station._id;
    // handlePlayStation called
    
    try {
      // If this station is already playing, pause it
      if (playingStationId === stationId) {
        await stopCurrentStation(stationId);
        updatePlayingState(null);
        return;
      }

      // Set loading state
      setLoadingStationId(stationId);
      
      // All streams are now handled by the backend - use server proxy exclusively
      await playServerProcessedStream(station, stationId);

    } catch (error: any) {
      // Play error
      setLoadingStationId(null);
      updatePlayingState(null);
      // Failed to start playback
    }
  };

  const stopCurrentStation = async (stationId: string) => {
    // Stop audio element
    const audioElement = audioRefs.current[stationId];
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
      delete audioRefs.current[stationId];
    }
  };

  const playServerProcessedStream = async (station: MongoStation, stationId: string) => {
    // Playing server-processed stream
    
    // Backend handles all stream processing - use server proxy exclusively
    const { getStreamProxyUrl } = await import('@/lib/utils');
    const streamUrl = getStreamProxyUrl(`/api/stream/${stationId}`);
    
    try {
      // Using backend-processed stream
      
      const audioElement = new Audio();
      audioRefs.current[stationId] = audioElement;
      
      audioElement.src = streamUrl;
      audioElement.volume = 0.7;
      audioElement.crossOrigin = 'anonymous';
      audioElement.preload = 'none';

      audioElement.oncanplay = () => {
        setLoadingStationId(null);
        // Backend stream ready
      };

      audioElement.onplay = () => {
        setLoadingStationId(null);
        updatePlayingState(stationId);
        // Backend stream playing
        onPlay(station);
      };

      audioElement.onerror = (e) => {
        // Backend stream failed
        setLoadingStationId(null);
        updatePlayingState(null);
        // Backend processing failed - station may be offline
      };

      audioElement.onended = () => {
        updatePlayingState(null);
      };

      audioElement.onloadstart = () => {
        // Audio load started
      };

      audioElement.onloadeddata = () => {
        // Audio data loaded
      };

      await audioElement.play();
      // Backend stream started successfully

    } catch (error) {
      // Backend stream failed
      setLoadingStationId(null);
      updatePlayingState(null);
      // All backend processing failed
    }
  };

  const getDescriptionStatusBadge = (station: MongoStation) => {
    const descriptions = station.descriptions;
    const languageCount = descriptions ? Object.keys(descriptions).length : 0;
    
    if (languageCount === 0) {
      return (
        <Badge variant="secondary" className="bg-red-100 text-red-800" title="No AI description available">
          🔴 No Description
        </Badge>
      );
    } else if (languageCount === 1) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800" title={`${languageCount} language translated`}>
          🟡 1 Language
        </Badge>
      );
    } else {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800" title={`${languageCount} languages translated`}>
          🟢 {languageCount} Languages
        </Badge>
      );
    }
  };

  const getStatusBadge = (station: MongoStation) => {
    const lastCheckTime = station.lastCheckTime ? new Date(station.lastCheckTime) : null;
    const lastCheckOkTime = station.lastCheckOkTime ? new Date(station.lastCheckOkTime) : null;
    const lastLocalCheckTime = station.lastLocalCheckTime ? new Date(station.lastLocalCheckTime) : null;
    
    const timeSinceCheck = lastCheckTime ? Math.floor((Date.now() - lastCheckTime.getTime()) / (1000 * 60 * 60)) : null;
    const timeSinceOkCheck = lastCheckOkTime ? Math.floor((Date.now() - lastCheckOkTime.getTime()) / (1000 * 60 * 60)) : null;
    const timeSinceLocalCheck = lastLocalCheckTime ? Math.floor((Date.now() - lastLocalCheckTime.getTime()) / (1000 * 60 * 60)) : null;
    
    const formatTime = (date: Date | null) => date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString() : 'Never';
    
    const tooltipText = `Status Details:
Last Check: ${formatTime(lastCheckTime)} (${timeSinceCheck ? timeSinceCheck + 'h ago' : 'Unknown'})
Last Successful: ${formatTime(lastCheckOkTime)} (${timeSinceOkCheck ? timeSinceOkCheck + 'h ago' : 'Unknown'})
Last Local Check: ${formatTime(lastLocalCheckTime)} (${timeSinceLocalCheck ? timeSinceLocalCheck + 'h ago' : 'Unknown'})`;
    
    // Check for SSL error first
    if (station.sslError === true || station.sslError === 1) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800" title={tooltipText}>
          <Circle className="w-2 h-2 text-yellow-400 fill-current mr-1" />
          SSL Error
        </Badge>
      );
    }
    
    // If lastCheckOk is true or 1, station is online
    if (station.lastCheckOk === true || station.lastCheckOk === 1) {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800" title={tooltipText}>
          <Circle className="w-2 h-2 text-green-400 fill-current mr-1" />
          Online
        </Badge>
      );
    }
    
    // If lastCheckOk is false or 0, station is offline
    if (station.lastCheckOk === false || station.lastCheckOk === 0) {
      return (
        <Badge variant="secondary" className="bg-red-100 text-red-800" title={tooltipText}>
          <Circle className="w-2 h-2 text-red-400 fill-current mr-1" />
          Offline
        </Badge>
      );
    }
    
    // Unknown status
    return (
      <Badge variant="secondary" className="bg-gray-100 text-gray-800" title={tooltipText}>
        <Circle className="w-2 h-2 text-gray-400 fill-current mr-1" />
        Unknown
      </Badge>
    );
  };

  const SortableHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <TableHead 
      className="cursor-pointer hover:bg-gray-100 select-none"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center space-x-1">
        <span>{children}</span>
        <ArrowUpDown className="w-4 h-4" />
      </div>
    </TableHead>
  );

  // StationTable render - stations received
  
  return (
    <div>
      {/* Mobile Card View */}
      <div className="block lg:hidden space-y-4 px-2">
        {/* Select All Checkbox for Mobile */}
        <div className="flex items-center space-x-3 py-2 px-1 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <Checkbox
            checked={stations.length > 0 && selectedStations.size === stations.length}
            onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
          />
          <span className="text-sm font-medium text-gray-700">
            Select All ({selectedStations.size}/{stations.length})
          </span>
        </div>
        {stations.map(station => (
          <div key={station._id} className="bg-white border rounded-lg p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <Checkbox
                  checked={selectedStations.has(station._id)}
                  onCheckedChange={(checked) => handleSelectStation(station._id, checked as boolean)}
                />
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                  {station.localImagePath ? (
                    <img
                      src={`/station-images/${station.localImagePath}`}
                      alt={station.name}
                      className="w-8 h-8 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : station.favicon ? (
                    <img
                      src={station.favicon}
                      alt={station.name}
                      className="w-8 h-8 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Radio className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate text-sm">{station.name}</h3>
                  <p className="text-xs text-gray-500 truncate">{station.country || 'Unknown'}</p>
                </div>
              </div>
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePlayStation(station)}
                  disabled={loadingStationId === station._id}
                  className="h-8 w-8 p-0"
                >
                  {loadingStationId === station._id ? (
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                  ) : playingStationId === station._id ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
                {onGenerateAi && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onGenerateAi(station)}
                    disabled={generatingStationId === station._id}
                    className={`h-8 w-8 p-0 ${generatingStationId === station._id ? 'text-purple-400 opacity-50 cursor-not-allowed animate-pulse' : 'text-purple-600 hover:text-purple-700'}`}
                    title={generatingStationId === station._id ? 'Generating AI description...' : 'Generate AI description'}
                  >
                    {generatingStationId === station._id ? (
                      <div className="animate-spin"><Sparkles className="h-3 w-3" /></div>
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                  </Button>
                )}
                {onTranslate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onTranslate(station)}
                    className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700"
                    title="Translate to common languages"
                  >
                    🌍
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(station)}
                  className="h-8 w-8 p-0"
                >
                  <Edit className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(station)}
                  className="text-red-600 hover:text-red-700 h-8 w-8 p-0"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">Description:</span>
                <div className="ml-1">{getDescriptionStatusBadge(station)}</div>
              </div>
              <div>
                <span className="text-gray-500">Codec:</span>
                <span className="ml-1 font-medium">{station.codec || 'Unknown'}</span>
              </div>
              <div>
                <span className="text-gray-500">Votes:</span>
                <span className="ml-1 font-medium">{station.votes || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <Badge variant={station.lastCheckOk ? "default" : "destructive"} className="ml-1 text-xs">
                  <Circle className={`w-1.5 h-1.5 mr-1 ${station.lastCheckOk ? 'fill-green-500' : 'fill-red-500'}`} />
                  {station.lastCheckOk ? 'Online' : 'Offline'}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedStations.size === stations.length && stations.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead className="w-16">Logo</TableHead>
              <SortableHeader field="name">Station Name</SortableHeader>
              <SortableHeader field="country">Country</SortableHeader>
              <TableHead>Description</TableHead>
              <TableHead>Genre</TableHead>
              <SortableHeader field="bitrate">Technical Details</SortableHeader>
              <TableHead>Status & Analytics</TableHead>
              <SortableHeader field="clickcount">Popularity</SortableHeader>
              <SortableHeader field="votes">Quality Ratings</SortableHeader>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
        <TableBody>
          {stations.map((station) => (
            <TableRow key={station._id} className="hover:bg-gray-50">
              <TableCell>
                <Checkbox
                  checked={selectedStations.has(station._id)}
                  onCheckedChange={(checked) => handleSelectStation(station._id, !!checked)}
                />
              </TableCell>
              <TableCell>
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                  {station.localImagePath ? (
                    <img
                      src={`/station-images/${station.localImagePath}`}
                      alt={station.name}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.parentElement?.querySelector('.fallback-icon') as HTMLElement;
                        if (fallback) fallback.style.display = 'block';
                      }}
                    />
                  ) : station.favicon ? (
                    <img
                      src={station.favicon}
                      alt={station.name}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.parentElement?.querySelector('.fallback-icon') as HTMLElement;
                        if (fallback) fallback.style.display = 'block';
                      }}
                    />
                  ) : null}
                  <Radio className="w-4 h-4 text-gray-400 fallback-icon" style={{ display: (station.localImagePath || station.favicon) ? 'none' : 'block' }} />
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <div className="text-sm font-medium text-gray-900 truncate max-w-xs">{station.name}</div>
                  <div className="text-xs text-gray-500 truncate max-w-xs">{station.url}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center">
                  {station.country && (
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {station.country}
                    </span>
                  )}
                  {!station.country && station.countryCode && (
                    <span className="text-sm text-gray-900 dark:text-gray-100">{station.countryCode}</span>
                  )}
                  {!station.country && !station.countryCode && (
                    <span className="text-xs text-gray-400">Unknown</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {getDescriptionStatusBadge(station)}
              </TableCell>
              <TableCell>
                {station.tags && (
                  <div className="flex flex-wrap gap-1">
                    {station.tags.split(',').slice(0, 2).map((tag, index) => (
                      <Badge key={`${station._id}-tag-${index}`} variant="outline" className="text-xs">
                        {tag.trim()}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm text-gray-900 dark:text-gray-100">{station.bitrate || 0} kbps</span>
                  {station.codec && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{station.codec}</span>
                  )}
                  {!station.codec && (
                    <span className="text-xs text-gray-400">Unknown</span>
                  )}
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(station)}</TableCell>
              <TableCell>
                <div className="flex flex-col space-y-1">
                  <div className="flex items-center space-x-1">
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                      🎵 {(station.clickCount || 0).toLocaleString()}
                    </Badge>
                    {station.clickTrend !== undefined && station.clickTrend !== null && station.clickTrend !== 0 && (
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${station.clickTrend > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}
                      >
                        {station.clickTrend > 0 ? '↗' : '↘'}{Math.abs(station.clickTrend)}
                      </Badge>
                    )}
                  </div>
                  {station.clickTimestamp && (
                    <div className="text-xs text-gray-500">
                      Last: {new Date(station.clickTimestamp).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col space-y-1">
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50 w-fit">
                    ⭐ {station.votes || 0}
                  </Badge>
                  {station.votes && station.votes > 0 && (
                    <div className="text-xs text-gray-500">
                      {station.votes >= 100 ? 'Excellent' : 
                       station.votes >= 50 ? 'Very Good' : 
                       station.votes >= 20 ? 'Good' : 
                       station.votes >= 10 ? 'Fair' : 'New'}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Button clicked for station
                      handlePlayStation(station);
                    }}
                    disabled={loadingStationId === station._id}
                    className="w-8 h-8 p-0"
                    title={playingStationId === station._id ? t('player_stop', 'Stop') : t('player_play_station', 'Play Station')}
                  >
                    {(() => {
                      const stationId = station._id;
                      const isLoading = loadingStationId === stationId;
                      const isPlaying = playingStationId === stationId;
                      // Station status checked
                      
                      if (isLoading) {
                        return <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>;
                      } else if (isPlaying) {
                        return <Pause className="w-4 h-4" />;
                      } else {
                        return <Play className="w-4 h-4" />;
                      }
                    })()}
                  </Button>
                  {onGenerateAi && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onGenerateAi(station)}
                      disabled={generatingStationId === station._id}
                      className={`w-8 h-8 p-0 ${generatingStationId === station._id ? 'text-purple-400 opacity-50 cursor-not-allowed animate-pulse' : 'text-purple-600 hover:text-purple-700'}`}
                      title={generatingStationId === station._id ? 'Generating AI description...' : 'Generate AI description'}
                    >
                      {generatingStationId === station._id ? (
                        <div className="animate-spin"><Sparkles className="w-4 h-4" /></div>
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                  {onTranslate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onTranslate(station)}
                      className="w-8 h-8 p-0 text-blue-600 hover:text-blue-700"
                      title="Translate to common languages"
                    >
                      🌍
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(station)}
                    className="w-8 h-8 p-0"
                    title={t('admin_edit_station', 'Edit Station')}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(station)}
                    className="w-8 h-8 p-0"
                    title="Delete Station"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {stations.length === 0 && (
            <TableRow>
              <TableCell colSpan={10} className="text-center py-8">
                No stations found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        </Table>
      </div>
    </div>
  );
}