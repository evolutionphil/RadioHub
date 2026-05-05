import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Activity, Play, Heart, Search, Star, Mouse } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface AnalyticsEvent {
  _id: string;
  stationId: string;
  userId?: string;
  event: 'play' | 'stop' | 'favorite' | 'search' | 'rating' | 'click';
  metadata: Record<string, any>;
  ip?: string;
  userAgent?: string;
  timestamp: string;
}

const eventIcons = {
  play: Play,
  stop: Play,
  favorite: Heart,
  search: Search,
  rating: Star,
  click: Mouse,
};

const eventColors = {
  play: 'bg-green-100 text-green-800',
  stop: 'bg-red-100 text-red-800',
  favorite: 'bg-pink-100 text-pink-800',
  search: 'bg-blue-100 text-blue-800',
  rating: 'bg-yellow-100 text-yellow-800',
  click: 'bg-purple-100 text-purple-800',
};

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    to: new Date(),
  });
  const [selectedEvent, setSelectedEvent] = useState<string>('');

  // Fetch analytics data
  const { data: analyticsData, isLoading, refetch } = useQuery({
    queryKey: ['/api/analytics', dateRange, selectedEvent],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.from.toISOString(),
        endDate: dateRange.to.toISOString(),
        limit: '100',
      });
      
      if (selectedEvent) {
        params.append('event', selectedEvent);
      }

      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) throw new Error('Failed to fetch analytics');
      return response.json();
    },
  });

  // Fetch analytics summary data  
  const { data: summaryData } = useQuery({
    queryKey: ['/api/analytics/summary'],
    queryFn: async () => {
      const response = await fetch('/api/analytics/summary');
      if (!response.ok) throw new Error('Failed to fetch analytics summary');
      return response.json();
    },
  });

  // Calculate summary statistics
  const eventCounts = analyticsData?.reduce((acc: Record<string, number>, event: AnalyticsEvent) => {
    acc[event.event] = (acc[event.event] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const totalEvents = analyticsData?.length || 0;
  const uniqueStations = new Set(analyticsData?.map((e: AnalyticsEvent) => e.stationId)).size;
  const uniqueUsers = new Set(analyticsData?.filter((e: AnalyticsEvent) => e.userId).map((e: AnalyticsEvent) => e.userId)).size;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground">
            Track user interactions and station usage patterns
          </p>
        </div>
        <Button onClick={() => refetch()} size="sm">
          <Activity className="w-4 h-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      {/* Filter Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Customize your analytics view</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4">
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !dateRange.from && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} -{" "}
                        {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={dateRange}
                  onSelect={(range) => {
                    if (range?.from) {
                      setDateRange({
                        from: range.from,
                        to: range.to || range.from,
                      });
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
          
          <Select value={selectedEvent} onValueChange={setSelectedEvent}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by event type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="play">Play Events</SelectItem>
              <SelectItem value="stop">Stop Events</SelectItem>
              <SelectItem value="favorite">Favorite Events</SelectItem>
              <SelectItem value="search">Search Events</SelectItem>
              <SelectItem value="rating">Rating Events</SelectItem>
              <SelectItem value="click">Click Events</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stations</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryData?.totalStations?.toLocaleString() || '0'}</div>
            <p className="text-xs text-muted-foreground">
              Active radio stations
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Stations</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryData?.activeStations?.toLocaleString() || '0'}</div>
            <p className="text-xs text-muted-foreground">
              {summaryData?.healthPercentage || 0}% health rate
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Broken Stations</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryData?.brokenStations?.toLocaleString() || '0'}</div>
            <p className="text-xs text-muted-foreground">
              Need attention
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Genre</CardTitle>
            <Heart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryData?.topGenres?.[0]?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              {summaryData?.topGenres?.[0]?.count?.toLocaleString() || '0'} stations
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Countries & Genres */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Countries</CardTitle>
            <CardDescription>Stations by country</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summaryData?.topCountries?.slice(0, 5).map((country: any, index: number) => (
                <div key={country.name} className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    #{index + 1} {country.name}
                  </span>
                  <Badge variant="secondary">
                    {country.count?.toLocaleString()}
                  </Badge>
                </div>
              )) || (
                <div className="text-sm text-muted-foreground">No country data available</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Genres</CardTitle>
            <CardDescription>Most popular genres</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summaryData?.topGenres?.slice(0, 5).map((genre: any, index: number) => (
                <div key={genre.name} className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    #{index + 1} {genre.name}
                  </span>
                  <Badge variant="secondary">
                    {genre.count?.toLocaleString()}
                  </Badge>
                </div>
              )) || (
                <div className="text-sm text-muted-foreground">No genre data available</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <CardDescription>Latest user interactions</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading analytics data...</div>
          ) : (
            <div className="space-y-2">
              {analyticsData?.slice(0, 20).map((event) => {
                const Icon = eventIcons[event.event];
                return (
                  <div key={event._id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">
                          <Badge variant="outline" className={eventColors[event.event]}>
                            {event.event}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Station: {event.stationId}
                          {event.userId && ` • User: ${event.userId.slice(0, 8)}...`}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(new Date(event.timestamp), 'MMM dd, HH:mm')}
                    </div>
                  </div>
                );
              })}
              
              {!analyticsData?.length && (
                <div className="text-center py-8 text-muted-foreground">
                  No analytics data found for the selected period
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}