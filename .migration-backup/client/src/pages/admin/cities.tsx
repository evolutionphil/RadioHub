import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Loader2, Merge, AlertTriangle, CheckCircle, MapPin } from 'lucide-react';

interface CityDuplicate {
  canonical: string;
  lowerCity: string;
  variations: Array<{
    name: string;
    count: number;
    countries: string[];
  }>;
  totalStations: number;
  countries: string[];
}

interface DuplicatesResponse {
  totalCityGroups: number;
  totalStationsAffected: number;
  duplicates: CityDuplicate[];
}

interface MergeResponse {
  success: boolean;
  stationsUpdated: number;
  cityGroupsProcessed: number;
  mergeOperations: Array<{
    canonical: string;
    merged: string[];
    stationsUpdated: number;
  }>;
}

export default function AdminCities() {
  const [duplicates, setDuplicates] = useState<DuplicatesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mergeResults, setMergeResults] = useState<MergeResponse | null>(null);

  const analyzeDuplicates = async () => {
    setIsLoading(true);
    setMergeResults(null);
    try {
      const response = await fetch('/api/admin/cities/duplicates');
      const data = await response.json();
      setDuplicates(data);
    } catch (error) {
      // Failed to analyze duplicates
    } finally {
      setIsLoading(false);
    }
  };

  const mergeDuplicates = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/admin/cities/merge-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      setMergeResults(data);
      
      // Refresh the analysis to show updated data
      if (data.success) {
        setTimeout(() => {
          analyzeDuplicates();
        }, 1000);
      }
    } catch (error) {
      // Failed to merge duplicates
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 bg-[#0E0E0E] min-h-screen text-white">
      <div className="bg-[#151515] p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-8 w-8 text-[#FF4199]" />
            <div>
              <h1 className="text-2xl font-bold text-white">City Cleanup</h1>
              <p className="text-[#838383] text-sm">
                Merge duplicate cities with different capitalizations
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={analyzeDuplicates} 
              disabled={isLoading}
              variant="outline"
              className="bg-[#2F2F2F] border-[#3F3F3F] text-white hover:bg-[#3F3F3F]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze Duplicates'
              )}
            </Button>
            {duplicates && duplicates.totalCityGroups > 0 && (
              <Button 
                onClick={mergeDuplicates} 
                disabled={isProcessing}
                className="bg-[#FF4199] hover:bg-[#e6388a] text-white"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Merging...
                  </>
                ) : (
                  <>
                    <Merge className="mr-2 h-4 w-4" />
                    Merge All Duplicates
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {mergeResults && (
        <Alert className="bg-[#1A3F1A] border-[#2F5F2F]">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-300">
            <div className="font-medium mb-2">Merge Completed Successfully!</div>
            <div className="text-sm space-y-1">
              <div>• {mergeResults.stationsUpdated} stations updated</div>
              <div>• {mergeResults.cityGroupsProcessed} city groups processed</div>
              {mergeResults.mergeOperations.slice(0, 5).map((op, i) => (
                <div key={i} className="text-xs text-green-200 ml-4">
                  → Merged "{op.merged.join('", "')}" → "{op.canonical}" ({op.stationsUpdated} stations)
                </div>
              ))}
              {mergeResults.mergeOperations.length > 5 && (
                <div className="text-xs text-green-200 ml-4">
                  ... and {mergeResults.mergeOperations.length - 5} more
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {duplicates && (
        <Card className="bg-[#1A1A1A] border-[#2F2F2F]">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-xl text-white">Duplicate Cities Analysis</CardTitle>
                <CardDescription className="text-[#838383]">
                  Found {duplicates.totalCityGroups} city groups with duplicates affecting {duplicates.totalStationsAffected} stations
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary" className="bg-[#2F2F2F] text-white border-[#3F3F3F]">
                  {duplicates.totalCityGroups} Groups
                </Badge>
                <Badge variant="destructive" className="bg-[#3F1A1A] text-red-300 border-[#5F2F2F]">
                  {duplicates.totalStationsAffected} Stations
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {duplicates.duplicates.length === 0 ? (
              <Alert className="bg-[#1A3F1A] border-[#2F5F2F]">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-green-300">
                  No duplicate cities found! All city names are already consistent.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-[#838383] mb-3">
                  Showing top {Math.min(duplicates.duplicates.length, 20)} city groups by station count:
                </div>
                
                {duplicates.duplicates.slice(0, 20).map((duplicate, index) => (
                  <div key={duplicate.lowerCity} className="bg-[#2F2F2F] rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-medium text-white">
                            Will become: <span className="text-[#FF4199]">"{duplicate.canonical}"</span>
                          </h3>
                          <Badge variant="outline" className="bg-[#1A1A1A] text-white border-[#3F3F3F]">
                            {duplicate.totalStations} stations
                          </Badge>
                        </div>
                        <div className="text-sm text-[#838383] mb-2">
                          Countries: {duplicate.countries.join(', ')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-[#838383]">#{index + 1}</div>
                      </div>
                    </div>
                    
                    <Separator className="bg-[#3F3F3F]" />
                    
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-[#838383]">Current variations:</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {duplicate.variations.map((variation, vIndex) => (
                          <div 
                            key={vIndex} 
                            className={`px-3 py-2 rounded text-sm flex justify-between items-center ${
                              variation.name === duplicate.canonical 
                                ? 'bg-[#1A3F1A] text-green-300 border border-[#2F5F2F]' 
                                : 'bg-[#3F1A1A] text-red-300 border border-[#5F2F2F]'
                            }`}
                          >
                            <span className="font-mono">"{variation.name}"</span>
                            <Badge 
                              variant="secondary" 
                              className="text-xs bg-[#1A1A1A] text-white border-[#3F3F3F]"
                            >
                              {variation.count}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                
                {duplicates.duplicates.length > 20 && (
                  <div className="text-center text-[#838383] text-sm p-4">
                    ... and {duplicates.duplicates.length - 20} more city groups
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!duplicates && !isLoading && (
        <Card className="bg-[#1A1A1A] border-[#2F2F2F]">
          <CardContent className="py-12 text-center">
            <MapPin className="h-12 w-12 text-[#838383] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Ready to Clean Up Cities</h3>
            <p className="text-[#838383] text-sm mb-6 max-w-md mx-auto">
              Click "Analyze Duplicates" to scan your database for cities with different capitalizations 
              (e.g., "ankara", "ANKARA", "Ankara") that should be merged.
            </p>
            <div className="space-y-2 text-xs text-[#666666]">
              <div>• This will not delete any stations</div>
              <div>• Cities will be standardized to proper case (e.g., "Ankara")</div>
              <div>• All station data will be preserved</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}