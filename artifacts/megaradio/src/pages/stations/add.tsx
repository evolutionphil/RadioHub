import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Plus, ArrowLeft, Upload, Activity, Loader2 } from "lucide-react";
import { insertStationSchema } from '@workspace/db-shared/schema';
import { z } from "zod";

const stationFormSchema = insertStationSchema.extend({
  favicon: z.string().url().optional(),
});

type StationFormData = z.infer<typeof stationFormSchema>;

export default function StationAdd() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  
  const [formData, setFormData] = useState<StationFormData>({
    name: "",
    url: "",
    homepage: "",
    favicon: "",
    country: "",
    language: "",
    tags: "",
    codec: "",
    bitrate: 128,
    votes: 0,
    clickcount: 0,
    lastcheckok: 1,
    lastchecktime: new Date(),
    clicktimestamp: new Date(),
    changeuuid: "",
    iso_3166_2: "",
    geo_lat: 0,
    geo_long: 0,
    hasExtendedInfo: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data: StationFormData) => {
      const response = await fetch('/api/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create station');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Station Created",
        description: "The station has been created successfully.",
      });
      setLocation('/stations');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create station.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.name || !formData.url) {
      toast({
        title: "Validation Error",
        description: "Station name and URL are required.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(formData);
  };

  const handleInputChange = (field: keyof StationFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <Button
          variant="outline"
          onClick={() => setLocation('/stations')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Stations
        </Button>
        
        <h1 className="text-2xl font-bold text-gray-900">Add New Station</h1>
        <p className="text-gray-600">Create a new radio station entry</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Plus className="w-5 h-5 mr-2" />
            Station Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">Basic Information</h3>
                
                <div>
                  <Label htmlFor="name">Station Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Enter station name"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="url">Stream URL *</Label>
                  <Input
                    id="url"
                    type="url"
                    value={formData.url}
                    onChange={(e) => handleInputChange('url', e.target.value)}
                    placeholder="https://stream.example.com/radio"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="homepage">Homepage</Label>
                  <Input
                    id="homepage"
                    type="url"
                    value={formData.homepage}
                    onChange={(e) => handleInputChange('homepage', e.target.value)}
                    placeholder="https://www.radiostation.com"
                  />
                </div>

                <div>
                  <Label htmlFor="favicon">Logo/Favicon URL</Label>
                  <Input
                    id="favicon"
                    type="url"
                    value={formData.favicon}
                    onChange={(e) => handleInputChange('favicon', e.target.value)}
                    placeholder="https://www.radiostation.com/logo.png"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    To upload a logo file, first create the station, then edit it to upload.
                  </p>
                </div>
              </div>

              {/* Location & Technical */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">Location & Technical</h3>
                
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => handleInputChange('country', e.target.value)}
                    placeholder="United States"
                  />
                </div>

                <div>
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={formData.language}
                    onChange={(e) => handleInputChange('language', e.target.value)}
                    placeholder="english"
                  />
                </div>

                <div>
                  <Label htmlFor="codec">Codec</Label>
                  <Select
                    value={formData.codec}
                    onValueChange={(value) => handleInputChange('codec', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select codec" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MP3">MP3</SelectItem>
                      <SelectItem value="AAC">AAC</SelectItem>
                      <SelectItem value="OGG">OGG</SelectItem>
                      <SelectItem value="FLAC">FLAC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="bitrate">Bitrate (kbps)</Label>
                  <Input
                    id="bitrate"
                    type="number"
                    value={formData.bitrate}
                    onChange={(e) => handleInputChange('bitrate', parseInt(e.target.value) || 0)}
                    placeholder="128"
                    min="32"
                    max="320"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Textarea
                id="tags"
                value={formData.tags}
                onChange={(e) => handleInputChange('tags', e.target.value)}
                placeholder="pop, music, hits, radio"
                rows={3}
              />
            </div>

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation('/stations')}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Station'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}