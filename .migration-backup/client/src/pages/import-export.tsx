import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileText, Database, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

interface ImportResult {
  totalRows: number;
  successfulImports: number;
  failedImports: number;
  errors: Array<{
    row: number;
    data: any;
    error: string;
  }>;
  importedStations: any[];
}

export default function ImportExport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportOptions, setExportOptions] = useState({
    format: 'csv' as 'csv' | 'json',
    includeImages: false,
    country: '',
    language: '',
    genre: '',
    search: ''
  });

  // Get filter options for export
  const { data: countries } = useQuery({
    queryKey: ['/api/filters/countries'],
    queryFn: () => api.getStationCountries(),
  });

  const { data: languages } = useQuery({
    queryKey: ['/api/filters/languages'],
    queryFn: () => api.getStationLanguages(),
  });

  const { data: genres } = useQuery({
    queryKey: ['/api/filters/genres'],
    queryFn: () => api.getStationGenres(),
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const endpoint = file.name.endsWith('.json') ? '/api/import/json' : '/api/import/csv';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }
      
      return response.json();
    },
    onSuccess: (result: ImportResult) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      
      toast({
        title: "Import Completed",
        description: `Successfully imported ${result.successfulImports} stations. ${result.failedImports} failed.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const handleImport = () => {
    if (!importFile) {
      toast({
        title: "No File Selected",
        description: "Please select a CSV or JSON file to import.",
        variant: "destructive",
      });
      return;
    }

    importMutation.mutate(importFile);
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    
    if (exportOptions.includeImages) params.append('includeImages', 'true');
    if (exportOptions.country) params.append('country', exportOptions.country);
    if (exportOptions.language) params.append('language', exportOptions.language);
    if (exportOptions.genre) params.append('genre', exportOptions.genre);
    if (exportOptions.search) params.append('search', exportOptions.search);

    const url = `/api/export/${exportOptions.format}?${params.toString()}`;
    window.open(url, '_blank');
    
    toast({
      title: "Export Started",
      description: `Your ${exportOptions.format.toUpperCase()} export is being downloaded.`,
    });
  };

  const handleDownloadTemplate = () => {
    window.open('/api/import/template', '_blank');
    
    toast({
      title: "Template Downloaded",
      description: "CSV template file has been downloaded.",
    });
  };

  const getSuccessRate = () => {
    if (!importResult || importResult.totalRows === 0) return 0;
    return Math.round((importResult.successfulImports / importResult.totalRows) * 100);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Import/Export Stations</h1>
        <p className="text-gray-600 mt-2">
          Bulk import stations from CSV/JSON files or export your station database.
        </p>
      </div>

      <Tabs defaultValue="import" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="import" className="flex items-center space-x-2">
            <Upload className="w-4 h-4" />
            <span>Import</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="flex items-center space-x-2">
            <Download className="w-4 h-4" />
            <span>Export</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Import Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Upload className="w-5 h-5" />
                  <span>Import Stations</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="import-file">Select File</Label>
                  <Input
                    id="import-file"
                    type="file"
                    accept=".csv,.json"
                    onChange={handleFileSelect}
                    ref={fileInputRef}
                    className="mt-1"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Supported formats: CSV, JSON (Max 10MB)
                  </p>
                </div>

                {importFile && (
                  <Alert>
                    <FileText className="w-4 h-4" />
                    <AlertDescription>
                      Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex space-x-2">
                  <Button
                    onClick={handleImport}
                    disabled={!importFile || importMutation.isPending}
                    className="flex-1"
                  >
                    {importMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import Stations
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDownloadTemplate}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Template
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Import Results */}
            {importResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Database className="w-5 h-5" />
                    <span>Import Results</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Success Rate</span>
                      <span>{getSuccessRate()}%</span>
                    </div>
                    <Progress value={getSuccessRate()} className="h-2" />
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-green-600">{importResult.successfulImports}</div>
                      <div className="text-sm text-gray-500">Success</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-600">{importResult.failedImports}</div>
                      <div className="text-sm text-gray-500">Failed</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-blue-600">{importResult.totalRows}</div>
                      <div className="text-sm text-gray-500">Total</div>
                    </div>
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="space-y-2">
                      <Label>Errors ({importResult.errors.length})</Label>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {importResult.errors.slice(0, 5).map((error, index) => (
                          <Alert key={index} variant="destructive">
                            <XCircle className="w-4 h-4" />
                            <AlertDescription className="text-xs">
                              Row {error.row}: {error.error}
                            </AlertDescription>
                          </Alert>
                        ))}
                        {importResult.errors.length > 5 && (
                          <p className="text-xs text-gray-500 text-center">
                            ... and {importResult.errors.length - 5} more errors
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="export" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Export Stations</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                {/* Format Selection */}
                <div>
                  <Label>Export Format</Label>
                  <Select
                    value={exportOptions.format}
                    onValueChange={(value: 'csv' | 'json') => 
                      setExportOptions(prev => ({ ...prev, format: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV (Excel Compatible)</SelectItem>
                      <SelectItem value="json">JSON (Developer Friendly)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Include Images */}
                <div className="flex items-center space-x-2 pt-6">
                  <Checkbox
                    id="include-images"
                    checked={exportOptions.includeImages}
                    onCheckedChange={(checked) => 
                      setExportOptions(prev => ({ ...prev, includeImages: !!checked }))
                    }
                  />
                  <Label htmlFor="include-images">Include image paths</Label>
                </div>
              </div>

              {/* Filters */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Export Filters (Optional)</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Search</Label>
                    <Input
                      placeholder="Filter by station name..."
                      value={exportOptions.search}
                      onChange={(e) => 
                        setExportOptions(prev => ({ ...prev, search: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <Label>Country</Label>
                    <Select
                      value={exportOptions.country}
                      onValueChange={(value) => 
                        setExportOptions(prev => ({ ...prev, country: value === "all" ? "" : value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Countries" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Countries</SelectItem>
                        {countries?.slice(0, 20).map((country) => (
                          <SelectItem key={typeof country === 'string' ? country : country.name} value={typeof country === 'string' ? country : country.name}>
                            {typeof country === 'string' ? country : country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Language</Label>
                    <Select
                      value={exportOptions.language}
                      onValueChange={(value) => 
                        setExportOptions(prev => ({ ...prev, language: value === "all" ? "" : value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Languages" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Languages</SelectItem>
                        {languages?.slice(0, 20).map((language) => (
                          <SelectItem key={language} value={language}>
                            {language}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Genre</Label>
                    <Select
                      value={exportOptions.genre}
                      onValueChange={(value) => 
                        setExportOptions(prev => ({ ...prev, genre: value === "all" ? "" : value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Genres" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Genres</SelectItem>
                        {genres?.slice(0, 20).map((genre) => (
                          <SelectItem key={genre} value={genre}>
                            {genre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Button onClick={handleExport} className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Export {exportOptions.format.toUpperCase()} File
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}