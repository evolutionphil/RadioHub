import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock, Wifi, Volume2 } from 'lucide-react';

interface ErrorLog {
  _id: string;
  stationId: string;
  stationName: string;
  stationUrl: string;
  errorType: string;
  errorMessage: string;
  errorDetails: {
    errorCode?: number;
    networkState?: number;
    readyState?: number;
    audioProperties?: {
      currentTime?: number;
      volume?: number;
      paused?: boolean;
    };
    browserInfo?: {
      userAgent?: string;
      platform?: string;
      language?: string;
      onLine?: boolean;
    };
    streamAnalysis?: {
      detectedFormat?: string;
      contentType?: string;
      isHLS?: boolean;
    };
  };
  stationMeta?: {
    country?: string;
    codec?: string;
    votes?: number;
  };
  timestamp: string;
  isResolved: boolean;
  uniqueUserCount: number;
  totalOccurrences: number;
}

interface ErrorLogsResponse {
  errors: ErrorLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export function AdminErrorLogs() {
  const [page, setPage] = useState(1);
  const [errorType, setErrorType] = useState('');
  const [resolved, setResolved] = useState('');
  const [stationSearch, setStationSearch] = useState('');

  const { data, isLoading, refetch } = useQuery<ErrorLogsResponse>({
    queryKey: ['/api/admin/error-logs', page, errorType, resolved, stationSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '20');
      if (errorType) params.set('errorType', errorType);
      if (resolved) params.set('resolved', resolved);
      if (stationSearch) params.set('stationId', stationSearch);

      const response = await fetch(`/api/admin/error-logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch error logs');
      return response.json();
    },
    staleTime: 30000 // Refresh every 30 seconds
  });

  const getErrorTypeIcon = (type: string) => {
    switch (type) {
      case 'NETWORK_ERROR': return <Wifi className="w-4 h-4" />;
      case 'CODEC_UNSUPPORTED': return <Volume2 className="w-4 h-4" />;
      case 'CONNECTION_TIMEOUT': return <Clock className="w-4 h-4" />;
      case 'STREAM_UNAVAILABLE': return <XCircle className="w-4 h-4" />;
      default: return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getErrorTypeBadge = (type: string) => {
    const colors = {
      'NETWORK_ERROR': 'bg-red-100 text-red-800',
      'CODEC_UNSUPPORTED': 'bg-orange-100 text-orange-800',
      'CONNECTION_TIMEOUT': 'bg-yellow-100 text-yellow-800',
      'STREAM_UNAVAILABLE': 'bg-purple-100 text-purple-800',
      'AUDIO_ERROR': 'bg-gray-100 text-gray-800',
      'CORS_ERROR': 'bg-blue-100 text-blue-800'
    };
    
    return (
      <Badge className={colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800'}>
        {getErrorTypeIcon(type)}
        <span className="ml-1">{type.replace('_', ' ')}</span>
      </Badge>
    );
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Error Logs</h1>
          <p className="text-gray-600 mt-2">Monitor client-side playback errors from all users</p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-600">Total Errors</p>
                  <p className="text-2xl font-bold">{data.pagination.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-600">Resolved</p>
                  <p className="text-2xl font-bold">
                    {data.errors.filter(e => e.isResolved).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center">
                <XCircle className="w-8 h-8 text-red-500" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-600">Unresolved</p>
                  <p className="text-2xl font-bold">
                    {data.errors.filter(e => !e.isResolved).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center">
                <Volume2 className="w-8 h-8 text-blue-500" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-600">Unique Stations</p>
                  <p className="text-2xl font-bold">
                    {new Set(data.errors.map(e => e.stationId)).size}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Error Type</label>
              <Select value={errorType} onValueChange={setErrorType}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  <SelectItem value="NETWORK_ERROR">Network Error</SelectItem>
                  <SelectItem value="CODEC_UNSUPPORTED">Codec Unsupported</SelectItem>
                  <SelectItem value="CONNECTION_TIMEOUT">Connection Timeout</SelectItem>
                  <SelectItem value="STREAM_UNAVAILABLE">Stream Unavailable</SelectItem>
                  <SelectItem value="AUDIO_ERROR">Audio Error</SelectItem>
                  <SelectItem value="CORS_ERROR">CORS Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={resolved} onValueChange={setResolved}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="false">Unresolved</SelectItem>
                  <SelectItem value="true">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium">Station Search</label>
              <Input
                value={stationSearch}
                onChange={(e) => setStationSearch(e.target.value)}
                placeholder="Station ID or name"
              />
            </div>
            
            <div className="flex items-end">
              <Button 
                onClick={() => {
                  setErrorType('');
                  setResolved('');
                  setStationSearch('');
                  setPage(1);
                }}
                variant="outline"
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Logs Table */}
      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600">Loading error logs...</p>
          </CardContent>
        </Card>
      ) : data?.errors.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
            <p className="text-gray-600">No error logs found with current filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data?.errors.map((error) => (
            <Card key={error._id} className={`border-l-4 ${error.isResolved ? 'border-l-green-500' : 'border-l-red-500'}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getErrorTypeBadge(error.errorType)}
                      {error.isResolved ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Resolved
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          <XCircle className="w-3 h-3 mr-1" />
                          Unresolved
                        </Badge>
                      )}
                    </div>
                    
                    <h3 className="font-semibold text-lg">{error.stationName}</h3>
                    <p className="text-gray-600 mb-2">{error.errorMessage}</p>
                    <p className="text-sm text-gray-500">Station ID: {error.stationId}</p>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{formatTime(error.timestamp)}</p>
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {error.uniqueUserCount} users
                      </span>
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        {error.totalOccurrences} occurrences
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Error Details */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded">
                  <div>
                    <h4 className="font-medium mb-2">Audio Details</h4>
                    <div className="text-sm space-y-1">
                      {error.errorDetails.errorCode && (
                        <p>Error Code: {error.errorDetails.errorCode}</p>
                      )}
                      {error.errorDetails.networkState && (
                        <p>Network State: {error.errorDetails.networkState}</p>
                      )}
                      {error.errorDetails.audioProperties?.currentTime && (
                        <p>Current Time: {error.errorDetails.audioProperties.currentTime.toFixed(1)}s</p>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2">Station Info</h4>
                    <div className="text-sm space-y-1">
                      {error.stationMeta?.country && (
                        <p>Country: {error.stationMeta.country}</p>
                      )}
                      {error.stationMeta?.codec && (
                        <p>Codec: {error.stationMeta.codec}</p>
                      )}
                      {error.errorDetails.streamAnalysis?.detectedFormat && (
                        <p>Format: {error.errorDetails.streamAnalysis.detectedFormat}</p>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2">Browser Info</h4>
                    <div className="text-sm space-y-1">
                      {error.errorDetails.browserInfo?.platform && (
                        <p>Platform: {error.errorDetails.browserInfo.platform}</p>
                      )}
                      {error.errorDetails.browserInfo?.language && (
                        <p>Language: {error.errorDetails.browserInfo.language}</p>
                      )}
                      <p>Online: {error.errorDetails.browserInfo?.onLine ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            variant="outline"
          >
            Previous
          </Button>
          
          <span className="flex items-center px-4 text-sm">
            Page {page} of {data.pagination.pages}
          </span>
          
          <Button
            onClick={() => setPage(page + 1)}
            disabled={page === data.pagination.pages}
            variant="outline"
          >
            Next
          </Button>
        </div>
      )}

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This system captures real-time playback errors from all users. Errors are automatically aggregated by station and error type.
          High error counts indicate stations that may need attention or URL updates.
        </AlertDescription>
      </Alert>
    </div>
  );
}