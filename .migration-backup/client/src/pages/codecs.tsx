import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AudioLines, Search } from "lucide-react";
import { useState } from "react";

interface Codec {
  _id: string;
  name: string;
  stationCount: number;
}

export default function Codecs() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: codecs, isLoading } = useQuery<Codec[]>({
    queryKey: ['/api/codecs'],
    queryFn: async () => {
      // Fetching codecs with station counts
      const response = await fetch('/api/codecs');
      if (!response.ok) throw new Error('Failed to fetch codecs');
      const data = await response.json();
      // Codecs response
      return data;
    },
  });

  const filteredCodecs = codecs?.filter(codec =>
    codec.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalStations = codecs?.reduce((sum, codec) => sum + codec.stationCount, 0) || 0;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audio Codecs</h1>
        <p className="text-gray-600">Browse radio stations by audio codec format</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center">
              <AudioLines className="w-5 h-5 mr-2" />
              Codecs ({filteredCodecs?.length || 0})
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search codecs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codec</TableHead>
                <TableHead>Stations</TableHead>
                <TableHead>Percentage</TableHead>
                <TableHead>Quality</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCodecs
                ?.sort((a, b) => b.stationCount - a.stationCount)
                .map((codec) => {
                  const percentage = totalStations > 0 ? (codec.stationCount / totalStations * 100).toFixed(1) : '0.0';
                  const quality = codec.name.toLowerCase().includes('mp3') ? 'Good' :
                                 codec.name.toLowerCase().includes('aac') ? 'High' :
                                 codec.name.toLowerCase().includes('ogg') ? 'High' :
                                 codec.name.toLowerCase().includes('flac') ? 'Lossless' : 'Standard';
                  
                  return (
                    <TableRow key={codec._id}>
                      <TableCell>
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">
                            {codec.name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {codec.stationCount.toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <div className="w-full bg-gray-200 rounded-full h-2 mr-2 max-w-24">
                            <div
                              className="bg-blue-600 h-2 rounded-full dynamic-progress-width"
                              style={{ '--progress-width': `${Math.min(100, parseFloat(percentage))}%` } as React.CSSProperties}
                            ></div>
                          </div>
                          <span className="text-sm text-gray-500 min-w-10">{percentage}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={quality === 'Lossless' ? 'default' : 
                                  quality === 'High' ? 'secondary' : 'outline'}
                          className={quality === 'Lossless' ? 'bg-green-100 text-green-800' :
                                    quality === 'High' ? 'bg-blue-100 text-blue-800' : ''}
                        >
                          {quality}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {(!filteredCodecs || filteredCodecs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    No codecs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}