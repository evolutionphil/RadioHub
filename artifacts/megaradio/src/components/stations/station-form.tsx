import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Upload, Star, Globe, Loader2, Zap, Check, AlertCircle, Radio, Sparkles, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const stationFormSchema = z.object({
  name: z.string().min(1, "Station name is required"),
  url: z.string().url("Please enter a valid stream URL"),
  urlResolved: z.string().optional(),
  homepage: z.string().optional(),
  favicon: z.string().optional(),
  countryCode: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  codec: z.string().optional(),
  bitrate: z.number().optional(),
  tags: z.string().optional(),
  hls: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  showInGlobalPopular: z.boolean().optional(),
  isActive: z.boolean().default(true),
  lastCheckOk: z.boolean().optional(),
  descriptionsJson: z.string().optional(),
});

interface StationData {
  _id?: string;
  id?: string;
  name: string;
  url: string;
  urlResolved?: string;
  homepage?: string;
  countryCode?: string;
  state?: string;
  codec?: string;
  bitrate?: number;
  tags?: string;
  isActive?: boolean;
  country?: any;
  favicon?: string;
  hls?: boolean;
  lastCheckOk?: boolean;
  isFeatured?: boolean;
  showInGlobalPopular?: boolean;
  descriptions?: Record<string, string>;
}

type StationFormData = z.infer<typeof stationFormSchema>;

interface StationFormProps {
  station?: StationData;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: StationFormData) => void;
  isLoading?: boolean;
}

interface CountryOption {
  name: string;
  code: string;
}

interface GenreOption {
  _id: string;
  name: string;
  slug: string;
  stationCount?: number;
}

export default function StationForm({
  station,
  open,
  onClose,
  onSubmit,
  isLoading = false,
}: StationFormProps) {
  const { toast } = useToast();
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [isAnalyzingStream, setIsAnalyzingStream] = useState(false);
  const [streamAnalysis, setStreamAnalysis] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("basic");

  const { data: countriesData } = useQuery<CountryOption[]>({
    queryKey: ['/api/admin/available-countries'],
    queryFn: () => api.getAvailableCountries(),
  });

  const { data: genresData } = useQuery<{ genres: GenreOption[] }>({
    queryKey: ['/api/genres'],
    queryFn: () => api.getGenres(),
  });

  const genres = genresData?.genres || [];
  const countries = countriesData || [];

  const getDefaultValues = (station?: any) => ({
    name: station?.name || "",
    url: station?.url || "",
    urlResolved: station?.urlResolved || "",
    homepage: station?.homepage || "",
    favicon: station?.favicon || "",
    countryCode: station?.countryCode || "",
    country: station?.country || station?.countryName || "",
    state: station?.state || "",
    codec: station?.codec || "",
    bitrate: station?.bitrate || undefined,
    tags: station?.tags || "",
    hls: station?.hls ?? false,
    isFeatured: station?.isFeatured ?? false,
    showInGlobalPopular: station?.showInGlobalPopular ?? false,
    isActive: station?.isActive ?? true,
    lastCheckOk: station?.lastCheckOk ?? true,
    descriptionsJson: station?.descriptions ? JSON.stringify(station.descriptions, null, 2) : "",
  });

  const form = useForm<StationFormData>({
    resolver: zodResolver(stationFormSchema),
    defaultValues: getDefaultValues(station),
  });

  const { data: freshStation } = useQuery({
    queryKey: station ? ['/api/admin/stations', station._id] : ['disabled'],
    queryFn: () => station ? fetch(`/api/admin/stations/${station._id}`).then(res => res.json()) : Promise.resolve(null),
    enabled: !!station && open,
    staleTime: 0,
  });

  const generateAiMutation = useMutation({
    mutationFn: async (stationId: string) => {
      const response = await apiRequest('POST', `/api/admin/stations/${stationId}/generate-descriptions`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.descriptions) {
        form.setValue('descriptionsJson', JSON.stringify(data.descriptions, null, 2));
      }
      toast({
        title: "AI Description Generated",
        description: "Multi-language descriptions have been created",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Could not generate AI descriptions",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (open) {
      const dataToUse = freshStation || station;
      form.reset(getDefaultValues(dataToUse));
      setStreamAnalysis(null);
      setActiveTab("basic");
    }
  }, [station, open, form, freshStation]);

  const analyzeStreamUrl = useCallback(async (url: string) => {
    if (!url || !url.startsWith('http')) return;
    
    setIsAnalyzingStream(true);
    try {
      const result = await api.analyzeStreamUrl(url);
      setStreamAnalysis(result);
      
      if (result.codec && !form.getValues('codec')) {
        form.setValue('codec', result.codec);
      }
      if (result.bitrate && !form.getValues('bitrate')) {
        form.setValue('bitrate', result.bitrate);
      }
      if (result.hls !== undefined) {
        form.setValue('hls', result.hls);
      }
    } catch (error) {
      console.error('Stream analysis failed:', error);
    } finally {
      setIsAnalyzingStream(false);
    }
  }, [form]);

  const handleSubmit = (data: StationFormData) => {
    if (data.descriptionsJson && data.descriptionsJson.trim()) {
      try {
        (data as any).descriptions = JSON.parse(data.descriptionsJson);
      } catch (e) {
        (data as any).descriptions = {};
      }
    } else {
      (data as any).descriptions = {};
    }
    delete (data as any).descriptionsJson;
    onSubmit(data);
  };

  const handleCountryChange = (countryName: string) => {
    const selectedCountry = countries.find(c => c.name === countryName);
    if (selectedCountry) {
      form.setValue('country', selectedCountry.name);
      form.setValue('countryCode', selectedCountry.code);
    }
  };

  const handleGenreSelect = (genreSlug: string) => {
    const currentTags = form.getValues('tags') || '';
    const tagsArray = currentTags.split(',').map(t => t.trim()).filter(Boolean);
    
    if (!tagsArray.includes(genreSlug)) {
      tagsArray.push(genreSlug);
      form.setValue('tags', tagsArray.join(', '));
    }
  };

  const removeTag = (tagToRemove: string) => {
    const currentTags = form.getValues('tags') || '';
    const tagsArray = currentTags.split(',').map(t => t.trim()).filter(t => t && t !== tagToRemove);
    form.setValue('tags', tagsArray.join(', '));
  };

  const currentTags = (form.watch('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
  const descriptions = station?.descriptions || {};
  const descriptionCount = Object.keys(descriptions).length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-gray-200 shadow-lg text-gray-900">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-600" />
            {station ? 'Edit Station' : 'Add New Station'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="basic" className="text-sm">
                  <Radio className="w-4 h-4 mr-1.5" />
                  Station Info
                </TabsTrigger>
                <TabsTrigger value="ai" className="text-sm">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  AI & Translations
                  {descriptionCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">{descriptionCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Basic Info Tab */}
              <TabsContent value="basic" className="space-y-4 mt-4">
                
                {/* Station Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Station Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Enter station name" className="text-gray-900" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Stream URL with Auto-Detect */}
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stream URL *</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="https://stream.example.com/radio" 
                            className="text-gray-900"
                            onBlur={(e) => {
                              field.onBlur();
                              if (e.target.value) {
                                analyzeStreamUrl(e.target.value);
                              }
                            }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isAnalyzingStream || !field.value}
                          onClick={() => analyzeStreamUrl(field.value)}
                          className="shrink-0"
                          title="Auto-detect stream info"
                        >
                          {isAnalyzingStream ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {streamAnalysis && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          {streamAnalysis.success ? (
                            <>
                              <Check className="h-3 w-3 text-green-600" />
                              <span className="text-green-700">
                                {streamAnalysis.streamType}
                                {streamAnalysis.codec && ` • ${streamAnalysis.codec}`}
                                {streamAnalysis.bitrate && ` • ${streamAnalysis.bitrate}kbps`}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3 text-yellow-600" />
                              <span className="text-yellow-700">Could not detect stream info</span>
                            </>
                          )}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Country & State - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select value={field.value || ""} onValueChange={handleCountryChange}>
                          <FormControl>
                            <SelectTrigger className="text-gray-900">
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[250px] bg-white">
                            {countries.map((country) => (
                              <SelectItem key={country.code} value={country.name}>
                                {country.name} ({country.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State/Region</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Optional" className="text-gray-900" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Codec & Bitrate - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="codec"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Codec</FormLabel>
                        <Select value={field.value || ""} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="text-gray-900">
                              <SelectValue placeholder="Auto-detect" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-white">
                            <SelectItem value="MP3">MP3</SelectItem>
                            <SelectItem value="AAC">AAC</SelectItem>
                            <SelectItem value="AAC+">AAC+</SelectItem>
                            <SelectItem value="OGG">OGG Vorbis</SelectItem>
                            <SelectItem value="OPUS">Opus</SelectItem>
                            <SelectItem value="FLAC">FLAC</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bitrate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bitrate (kbps)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="Auto-detect"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            className="text-gray-900"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Genre Selection */}
                <div className="space-y-2">
                  <FormLabel>Genres/Tags</FormLabel>
                  <Select onValueChange={handleGenreSelect}>
                    <SelectTrigger className="text-gray-900">
                      <SelectValue placeholder="Add genre" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[250px] bg-white">
                      {genres.slice(0, 50).map((genre) => (
                        <SelectItem key={genre._id} value={genre.slug}>
                          {genre.name} {genre.stationCount ? `(${genre.stationCount})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {currentTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {currentTags.map((tag) => (
                        <Badge 
                          key={tag} 
                          variant="secondary" 
                          className="cursor-pointer hover:bg-red-100 hover:text-red-700 text-xs"
                          onClick={() => removeTag(tag)}
                        >
                          {tag} ×
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Favicon & Homepage - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="favicon"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Logo URL</FormLabel>
                        <div className="flex gap-1.5">
                          {field.value && (
                            <img 
                              src={field.value} 
                              alt="" 
                              className="w-9 h-9 rounded object-cover border shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="Logo URL" className="text-gray-900" />
                          </FormControl>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            id="favicon-upload"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              
                              const stationId = station?._id || station?.id;
                              if (!stationId) {
                                toast({ title: "Error", description: "Save station first", variant: "destructive" });
                                return;
                              }
                              
                              setIsUploadingFavicon(true);
                              try {
                                const formData = new FormData();
                                formData.append('favicon', file);
                                const response = await fetch(`/api/admin/stations/${stationId}/upload-favicon`, {
                                  method: 'POST', credentials: 'include', body: formData,
                                });
                                if (!response.ok) throw new Error('Upload failed');
                                const result = await response.json();
                                field.onChange(result.favicon);
                                toast({ title: "Success", description: "Logo uploaded" });
                              } catch (error: any) {
                                toast({ title: "Failed", description: error.message, variant: "destructive" });
                              } finally {
                                setIsUploadingFavicon(false);
                                e.target.value = '';
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUploadingFavicon || !station?._id}
                            onClick={() => document.getElementById('favicon-upload')?.click()}
                            className="shrink-0"
                          >
                            {isUploadingFavicon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="homepage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Homepage</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="https://..." className="text-gray-900" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Featured Station Toggles */}
                <div className="flex items-center gap-6 p-3 border rounded-lg bg-gray-50">
                  <FormField
                    control={form.control}
                    name="isFeatured"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="flex items-center gap-1 cursor-pointer">
                          <Star className="h-4 w-4 text-yellow-500" />
                          Popular
                        </FormLabel>
                      </FormItem>
                    )}
                  />

                  {form.watch("isFeatured") && (
                    <FormField
                      control={form.control}
                      name="showInGlobalPopular"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                          <FormLabel className="flex items-center gap-1 cursor-pointer">
                            <Globe className="h-4 w-4 text-blue-500" />
                            Global
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </TabsContent>

              {/* AI & Translations Tab */}
              <TabsContent value="ai" className="space-y-4 mt-4">
                
                {/* AI Generation Button */}
                {station?._id && (
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-gradient-to-r from-purple-50 to-blue-50">
                    <div>
                      <h4 className="font-medium text-gray-900 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        AI Description Generator
                      </h4>
                      <p className="text-sm text-gray-600 mt-0.5">
                        Generate SEO-optimized descriptions in 57 languages
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={generateAiMutation.isPending}
                      onClick={() => station?._id && generateAiMutation.mutate(station._id)}
                      className="bg-white"
                    >
                      {generateAiMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Generate
                    </Button>
                  </div>
                )}

                {/* Current Translations Display */}
                {descriptionCount > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Languages className="h-4 w-4" />
                      Existing Translations ({descriptionCount} languages)
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(descriptions).map((lang) => (
                        <Badge key={lang} variant="outline" className="text-xs">
                          {lang.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Descriptions JSON Editor */}
                <FormField
                  control={form.control}
                  name="descriptionsJson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AI Descriptions (JSON)</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field}
                          value={field.value || ""}
                          placeholder='{"en": "English description", "tr": "Turkish description", ...}'
                          rows={8}
                          className="font-mono text-xs text-gray-900"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Edit multi-language descriptions as JSON. Keys are language codes (en, tr, de, etc.)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            {/* Submit Buttons */}
            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {station ? 'Save Changes' : 'Add Station'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
