import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Globe, 
  Languages, 
  FileText,
  Download,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface TranslationKey {
  _id: string;
  key: string;
  defaultValue: string;
  description?: string;
  context?: string;
  category: string;
  isPlural?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Translation {
  _id: string;
  keyId: string;
  language: string;
  value: string;
  isCompleted: boolean;
  lastModified: string;
}

interface TranslationLanguage {
  code: string;
  name: string;
  isEnabled: boolean;
  completionPercentage: number;
}

export default function AdminTranslations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isTranslateDialogOpen, setIsTranslateDialogOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<TranslationKey | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateAllProgress, setTranslateAllProgress] = useState({ current: 0, total: 0, currentLang: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Form states
  const [newKey, setNewKey] = useState({
    key: "",
    defaultValue: "",
    description: "",
    context: "",
    category: "general",
    isPlural: false
  });

  const [editKey, setEditKey] = useState({
    key: "",
    defaultValue: "",
    description: "",
    context: "",
    category: "general",
    isPlural: false
  });

  const [translationForm, setTranslationForm] = useState({
    language: "",
    value: ""
  });

  // Inline editing states
  const [editingDefaultValue, setEditingDefaultValue] = useState<string | null>(null);
  const [editingTranslation, setEditingTranslation] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [editingTranslationValues, setEditingTranslationValues] = useState<Record<string, string>>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [pendingTranslationChanges, setPendingTranslationChanges] = useState<Record<string, string>>({});

  // Check admin auth status first
  const { data: adminAuth } = useQuery<{ user: any; authenticated: boolean }>({
    queryKey: ['/api/admin/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/admin/auth/me', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to check admin auth');
      return response.json();
    },
    retry: false,
  });
  
  const isAdmin = adminAuth?.authenticated === true;
  
  // Poll translation metadata for cache invalidation
  const { data: translationMetadata } = useQuery<{ languagesVersion: number }>({
    queryKey: ['/api/admin/translation-metadata'],
    queryFn: async () => {
      const response = await fetch('/api/admin/translation-metadata', {
        credentials: 'include'
      });
      if (!response.ok) return { languagesVersion: 0 };
      return response.json();
    },
    refetchInterval: 15000, // Poll every 15 seconds
    enabled: isAdmin,
    retry: false
  });

  const cacheVersion = translationMetadata?.languagesVersion || 0;
  
  // Fetch translation keys with optimized caching - ONLY when authenticated as admin
  const { data: translationKeys = [], isLoading: keysLoading } = useQuery<TranslationKey[]>({
    queryKey: ['/api/admin/translation-keys', cacheVersion],
    queryFn: async () => {
      const response = await fetch('/api/admin/translation-keys', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch translation keys');
      return response.json();
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
    enabled: isAdmin, // Only fetch when admin is authenticated
  });

  // Fetch languages with optimized caching - ONLY when authenticated as admin
  const { data: languages = [], isLoading: languagesLoading } = useQuery<TranslationLanguage[]>({
    queryKey: ['/api/admin/translation-languages', cacheVersion],
    queryFn: async () => {
      const response = await fetch('/api/admin/translation-languages', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch languages');
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
    enabled: isAdmin, // Only fetch when admin is authenticated
  });

  // Fetch all translations for filtering purposes with caching - ONLY when authenticated as admin
  const { data: allTranslations = [] } = useQuery<Translation[]>({
    queryKey: ['/api/admin/all-translations', cacheVersion],
    queryFn: async () => {
      const response = await fetch('/api/admin/all-translations', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch all translations');
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
    enabled: isAdmin, // Only fetch when admin is authenticated
  });

  // Fetch translations for selected key
  const { data: translations = [] } = useQuery<Translation[]>({
    queryKey: ['/api/admin/translations', selectedKey?._id],
    queryFn: async () => {
      if (!selectedKey) return [];
      const response = await fetch(`/api/admin/translations/${selectedKey._id}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch translations');
      return response.json();
    },
    enabled: !!selectedKey
  });

  // Create translation key mutation
  const createKeyMutation = useMutation({
    mutationFn: async (keyData: any) => {
      return apiRequest("POST", "/api/admin/translation-keys", { body: keyData });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Translation key created successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
      setIsAddDialogOpen(false);
      resetNewKeyForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create translation key",
        variant: "destructive" 
      });
    }
  });

  // Update translation key mutation
  const updateKeyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string, data: any }) => {
      return apiRequest("PUT", `/api/admin/translation-keys/${id}`, { body: data });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Translation key updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
      setIsEditDialogOpen(false);
      setSelectedKey(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update translation key",
        variant: "destructive" 
      });
    }
  });

  // Delete translation key mutation
  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/translation-keys/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Translation key deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete translation key",
        variant: "destructive" 
      });
    }
  });

  // Save translation mutation
  const saveTranslationMutation = useMutation({
    mutationFn: async (translationData: any) => {
      return apiRequest("POST", "/api/admin/translations", { body: translationData });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Translation saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translations', selectedKey?._id] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
      setTranslationForm({ language: "", value: "" });
      setIsTranslateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to save translation",
        variant: "destructive" 
      });
    }
  });

  // Scan frontend mutation
  const scanFrontendMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/scan-frontend-strings");
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Scan Complete", 
        description: `Found ${data.newKeysAdded} new translation keys` 
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
      setIsScanning(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Scan Failed", 
        description: error.message || "Failed to scan frontend",
        variant: "destructive" 
      });
      setIsScanning(false);
    }
  });

  // Seed FAQ keys mutation
  const seedFaqKeysMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/translation-keys/add-faq-keys");
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "FAQ Keys Added", 
        description: `Added ${data.created} new FAQ translation keys. You can now translate them!` 
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to add FAQ keys",
        variant: "destructive" 
      });
    }
  });

  // Translate ALL enabled languages sequentially
  const handleTranslateAllLanguages = async () => {
    const enabledLanguages = languages.filter(lang => lang.isEnabled && lang.code !== 'en');
    if (enabledLanguages.length === 0) {
      toast({ title: "No Languages", description: "No enabled languages to translate", variant: "destructive" });
      return;
    }

    setIsTranslatingAll(true);
    setTranslateAllProgress({ current: 0, total: enabledLanguages.length, currentLang: '' });

    let totalTranslated = 0;
    let totalFixed = 0;
    let totalFailed = 0;

    for (let i = 0; i < enabledLanguages.length; i++) {
      const lang = enabledLanguages[i];
      setTranslateAllProgress({ current: i + 1, total: enabledLanguages.length, currentLang: lang.name });

      try {
        const response = await fetch(`/api/admin/translation-languages/${lang.code}/translate`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          const data = await response.json();
          totalTranslated += data.stats?.translated || 0;
          totalFixed += data.stats?.fixed || 0;
          totalFailed += data.stats?.failed || 0;
        }
      } catch (error) {
        console.error(`Failed to translate ${lang.code}:`, error);
        totalFailed++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/all-translations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });

    toast({
      title: "Bulk Translation Complete",
      description: `Translated ${totalTranslated} keys, fixed ${totalFixed}, failed ${totalFailed} across ${enabledLanguages.length} languages`
    });

    setIsTranslatingAll(false);
    setTranslateAllProgress({ current: 0, total: 0, currentLang: '' });
  };

  // Filter keys with null checks and language filter
  const filteredKeys = translationKeys.filter(key => {
    const keyStr = key?.key || '';
    const defaultValueStr = key?.defaultValue || '';
    const matchesSearch = keyStr.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         defaultValueStr.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || key?.category === selectedCategory;
    
    // Language filter - always show all keys when a specific language is selected
    // This allows users to see which keys need translation and which are already translated
    let matchesLanguage = true;
    
    return matchesSearch && matchesCategory && matchesLanguage;
  });

  // Pagination
  const totalPages = Math.ceil(filteredKeys.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedKeys = filteredKeys.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, selectedLanguage, itemsPerPage]);

  // Get unique categories
  const categories = Array.from(new Set(translationKeys.map(key => key.category)));

  const resetNewKeyForm = () => {
    setNewKey({
      key: "",
      defaultValue: "",
      description: "",
      context: "",
      category: "general",
      isPlural: false
    });
  };

  const handleEditKey = (key: TranslationKey) => {
    setSelectedKey(key);
    setEditKey({
      key: key.key,
      defaultValue: key.defaultValue,
      description: key.description || "",
      context: key.context || "",
      category: key.category,
      isPlural: key.isPlural || false
    });
    setIsEditDialogOpen(true);
  };

  const handleTranslateKey = (key: TranslationKey) => {
    setSelectedKey(key);
    setIsTranslateDialogOpen(true);
  };

  // Inline editing handlers
  const handleDefaultValueEdit = (keyId: string, currentValue: string) => {
    setEditingDefaultValue(keyId);
    setEditingValues({ ...editingValues, [keyId]: currentValue });
    // Focus and select all text after a brief delay to ensure the input is rendered
    setTimeout(() => {
      const input = document.querySelector(`input[data-default-key="${keyId}"]`) as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 10);
  };

  const handleDefaultValueChange = (keyId: string, newValue: string) => {
    setEditingValues({ ...editingValues, [keyId]: newValue });
    setPendingChanges({ ...pendingChanges, [keyId]: newValue });
  };

  const handleDefaultValueSave = (keyId: string) => {
    setEditingDefaultValue(null);
    // The changes are tracked in pendingChanges
  };

  const handleDefaultValueCancel = (keyId: string) => {
    setEditingDefaultValue(null);
    const newEditingValues = { ...editingValues };
    delete newEditingValues[keyId];
    setEditingValues(newEditingValues);
    
    const newPendingChanges = { ...pendingChanges };
    delete newPendingChanges[keyId];
    setPendingChanges(newPendingChanges);
  };

  // Translation inline editing handlers
  const handleTranslationEdit = (keyId: string, currentValue: string) => {
    setEditingTranslation(keyId);
    setEditingTranslationValues(prev => ({ ...prev, [keyId]: currentValue }));
    // Focus and select all text after a brief delay to ensure the input is rendered
    setTimeout(() => {
      const input = document.querySelector(`input[data-translation-key="${keyId}"]`) as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 10);
  };

  const handleTranslationChange = (keyId: string, value: string) => {
    setEditingTranslationValues(prev => ({ ...prev, [keyId]: value }));
    setPendingTranslationChanges(prev => ({ ...prev, [keyId]: value }));
  };

  const handleTranslationSave = (keyId: string) => {
    setEditingTranslation(null);
    // The changes are tracked in pendingTranslationChanges
  };

  const handleTranslationCancel = (keyId: string) => {
    setEditingTranslation(null);
    const newEditingValues = { ...editingTranslationValues };
    delete newEditingValues[keyId];
    setEditingTranslationValues(newEditingValues);
    
    const newPendingChanges = { ...pendingTranslationChanges };
    delete newPendingChanges[keyId];
    setPendingTranslationChanges(newPendingChanges);
  };

  // Mutation to save pending changes in bulk
  const savePendingChangesMutation = useMutation({
    mutationFn: async () => {
      const promises = [];
      
      // Save default value changes
      if (Object.keys(pendingChanges).length > 0) {
        const updates = Object.entries(pendingChanges).map(([keyId, newDefaultValue]) => ({
          keyId,
          defaultValue: newDefaultValue
        }));
        promises.push(apiRequest("PATCH", "/api/admin/translation-keys/bulk-update", { body: { updates } }));
      }
      
      // Save translation changes
      if (Object.keys(pendingTranslationChanges).length > 0 && selectedLanguage !== "all") {
        const translationUpdates = Object.entries(pendingTranslationChanges).map(([keyId, value]) => ({
          keyId,
          language: selectedLanguage,
          value,
          isCompleted: true
        }));
        promises.push(apiRequest("POST", "/api/admin/translations/bulk-upsert", { body: { translations: translationUpdates } }));
      }
      
      return Promise.all(promises);
    },
    onSuccess: () => {
      const defaultChanges = Object.keys(pendingChanges).length;
      const translationChanges = Object.keys(pendingTranslationChanges).length;
      
      toast({ 
        title: "Success", 
        description: `Updated ${defaultChanges} default values and ${translationChanges} translations` 
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-keys'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/all-translations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
      setPendingChanges({});
      setPendingTranslationChanges({});
      setEditingValues({});
      setEditingTranslationValues({});
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update translations",
        variant: "destructive" 
      });
    },
  });

  const handleScanFrontend = () => {
    setIsScanning(true);
    scanFrontendMutation.mutate();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Translation Management</h1>
          <p className="text-muted-foreground">
            Manage translation keys and their translations for different languages
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleScanFrontend}
            disabled={isScanning}
            variant="outline"
            className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50"
            data-testid="button-check-new-params"
          >
            {isScanning ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            {isScanning ? 'Scanning...' : 'Check New Parameters'}
          </Button>
          <Button 
            onClick={handleTranslateAllLanguages}
            disabled={isTranslatingAll || languages.length === 0}
            variant="outline"
            className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 hover:from-green-600 hover:to-emerald-600 disabled:opacity-50"
            data-testid="button-translate-all"
          >
            {isTranslatingAll ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {isTranslatingAll 
              ? `${translateAllProgress.current}/${translateAllProgress.total} ${translateAllProgress.currentLang}...` 
              : 'Translate All Languages'}
          </Button>
          <Button 
            onClick={() => seedFaqKeysMutation.mutate()}
            disabled={seedFaqKeysMutation.isPending}
            variant="outline"
            data-testid="button-add-faq-keys"
          >
            {seedFaqKeysMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            Add FAQ Keys
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Key
          </Button>
        </div>
      </div>

      {/* Language Statistics - Compact Chip Grid */}
      <div className="rounded-xl p-4"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
          border: '1px solid rgba(0, 0, 0, 0.06)'
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-semibold text-gray-800">Languages</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{languages.length} total</span>
            <span className="text-emerald-600 font-medium">{languages.filter(l => l.completionPercentage === 100).length} complete</span>
            <span>{translationKeys.length} keys</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {languages.map((lang) => {
            const isComplete = lang.completionPercentage === 100;
            const bgColor = !lang.isEnabled ? 'bg-gray-100' : isComplete ? 'bg-emerald-50' : 'bg-slate-50';
            const textColor = !lang.isEnabled ? 'text-gray-400' : isComplete ? 'text-emerald-700' : 'text-slate-600';
            const borderColor = !lang.isEnabled ? 'border-gray-200' : isComplete ? 'border-emerald-200' : 'border-slate-200';
            
            return (
              <div 
                key={lang.code}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium ${bgColor} ${textColor} ${borderColor}`}
              >
                <span>{lang.name}</span>
                <span className="opacity-40">·</span>
                <span className="tabular-nums font-semibold">{Math.round(lang.completionPercentage)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search">Search Keys</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search keys or values..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="language">Language Filter</Label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Languages</SelectItem>
                  {languages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name} ({Math.round(lang.completionPercentage)}% complete)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Translation Keys Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Translation Keys ({filteredKeys.length})</CardTitle>
            {(Object.keys(pendingChanges).length > 0 || Object.keys(pendingTranslationChanges).length > 0) && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-orange-500">
                  {Object.keys(pendingChanges).length + Object.keys(pendingTranslationChanges).length} unsaved changes
                </span>
                <Button
                  size="sm"
                  onClick={() => savePendingChangesMutation.mutate()}
                  disabled={savePendingChangesMutation.isPending}
                >
                  Save All Changes
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Default Value</TableHead>
                  {selectedLanguage !== "all" && (
                    <TableHead className="text-blue-600">
                      {languages.find(l => l.code === selectedLanguage)?.name || selectedLanguage.toUpperCase()} Translation
                    </TableHead>
                  )}
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedKeys.map((key) => {
                  // Calculate completion for this key across all languages
                  const keyTranslations = translations.filter(t => t.keyId === key._id);
                  const completedTranslations = keyTranslations.filter(t => t.isCompleted).length;
                  const enabledLanguagesCount = languages.filter(l => l.isEnabled).length;
                  const completionRate = enabledLanguagesCount > 0 
                    ? (completedTranslations / enabledLanguagesCount) * 100 
                    : 0;

                  // Get translation for selected language if any
                  const selectedLanguageTranslation = selectedLanguage !== "all" 
                    ? allTranslations.find(t => t.keyId === key._id && t.language === selectedLanguage)
                    : null;

                  return (
                    <TableRow key={key._id}>
                      <TableCell className="font-mono text-sm">{key.key}</TableCell>
                      <TableCell className="max-w-xs">
                        {editingDefaultValue === key._id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              data-default-key={key._id}
                              value={editingValues[key._id] !== undefined ? editingValues[key._id] : key.defaultValue}
                              onChange={(e) => handleDefaultValueChange(key._id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleDefaultValueSave(key._id);
                                } else if (e.key === 'Escape') {
                                  handleDefaultValueCancel(key._id);
                                }
                              }}
                              className="min-w-0 flex-1"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDefaultValueSave(key._id)}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDefaultValueCancel(key._id)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div 
                            className="truncate cursor-pointer hover:bg-gray-100 p-1 rounded"
                            onClick={() => handleDefaultValueEdit(key._id, key.defaultValue)}
                          >
                            {pendingChanges[key._id] || key.defaultValue}
                            {pendingChanges[key._id] && <span className="ml-2 text-orange-500">*</span>}
                          </div>
                        )}
                      </TableCell>
                      {selectedLanguage !== "all" && (
                        <TableCell className="max-w-xs">
                          {editingTranslation === key._id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                data-translation-key={key._id}
                                value={editingTranslationValues[key._id] !== undefined ? editingTranslationValues[key._id] : (selectedLanguageTranslation?.value || '')}
                                onChange={(e) => handleTranslationChange(key._id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleTranslationSave(key._id);
                                  } else if (e.key === 'Escape') {
                                    handleTranslationCancel(key._id);
                                  }
                                }}
                                className="min-w-0 flex-1"
                                placeholder="Enter translation..."
                                autoFocus
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTranslationSave(key._id)}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTranslationCancel(key._id)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className="truncate cursor-pointer hover:bg-blue-50 p-1 rounded text-blue-600 font-medium"
                              onClick={() => handleTranslationEdit(key._id, selectedLanguageTranslation?.value || '')}
                            >
                              {pendingTranslationChanges[key._id] || selectedLanguageTranslation?.value || (
                                <span className="text-gray-400 italic">Click to add translation</span>
                              )}
                              {pendingTranslationChanges[key._id] && <span className="ml-2 text-orange-500">*</span>}
                            </div>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline">{key.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {completionRate === 100 ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-orange-500" />
                          )}
                          <span className="text-sm">{Math.round(completionRate)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTranslateKey(key)}
                          >
                            <Globe className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditKey(key)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteKeyMutation.mutate(key._id)}
                            disabled={deleteKeyMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Showing {startIndex + 1}-{Math.min(endIndex, filteredKeys.length)} of {filteredKeys.length}</span>
              <span className="text-gray-300">|</span>
              <span>Show:</span>
              <div className="flex gap-1">
                {[50, 100, 500, 1000].map((size) => (
                  <button
                    key={size}
                    onClick={() => setItemsPerPage(size)}
                    className="px-2 py-1 text-xs rounded transition-colors"
                    style={{
                      backgroundColor: itemsPerPage === size ? '#FF4199' : '#f3f4f6',
                      color: itemsPerPage === size ? 'white' : '#4b5563'
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className="px-3 py-1 text-sm rounded transition-colors"
                      style={{
                        backgroundColor: currentPage === pageNum ? '#FF4199' : '#f3f4f6',
                        color: currentPage === pageNum ? 'white' : '#4b5563'
                      }}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Key Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Add Translation Key</DialogTitle>
            <DialogDescription className="text-gray-600">
              Create a new translation key for the application
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-key">Key</Label>
              <Input
                id="new-key"
                placeholder="e.g., login, welcome_message"
                value={newKey.key}
                onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="new-default-value">Default Value</Label>
              <Textarea
                id="new-default-value"
                placeholder="Default text in English"
                value={newKey.defaultValue}
                onChange={(e) => setNewKey({ ...newKey, defaultValue: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="new-category">Category</Label>
              <Select value={newKey.category} onValueChange={(value) => setNewKey({ ...newKey, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="auth">Authentication</SelectItem>
                  <SelectItem value="navigation">Navigation</SelectItem>
                  <SelectItem value="forms">Forms</SelectItem>
                  <SelectItem value="errors">Errors</SelectItem>
                  <SelectItem value="buttons">Buttons</SelectItem>
                  <SelectItem value="messages">Messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-description">Description (Optional)</Label>
              <Textarea
                id="new-description"
                placeholder="Describe where this text appears..."
                value={newKey.description}
                onChange={(e) => setNewKey({ ...newKey, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createKeyMutation.mutate(newKey)}
              disabled={createKeyMutation.isPending || !newKey.key || !newKey.defaultValue}
            >
              Create Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Key Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Edit Translation Key</DialogTitle>
            <DialogDescription className="text-gray-600">
              Update the translation key details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-key">Key</Label>
              <Input
                id="edit-key"
                value={editKey.key}
                onChange={(e) => setEditKey({ ...editKey, key: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-default-value">Default Value</Label>
              <Textarea
                id="edit-default-value"
                value={editKey.defaultValue}
                onChange={(e) => setEditKey({ ...editKey, defaultValue: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-category">Category</Label>
              <Select value={editKey.category} onValueChange={(value) => setEditKey({ ...editKey, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="auth">Authentication</SelectItem>
                  <SelectItem value="navigation">Navigation</SelectItem>
                  <SelectItem value="forms">Forms</SelectItem>
                  <SelectItem value="errors">Errors</SelectItem>
                  <SelectItem value="buttons">Buttons</SelectItem>
                  <SelectItem value="messages">Messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editKey.description}
                onChange={(e) => setEditKey({ ...editKey, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateKeyMutation.mutate({ id: selectedKey!._id, data: editKey })}
              disabled={updateKeyMutation.isPending}
            >
              Update Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Translate Dialog */}
      <Dialog open={isTranslateDialogOpen} onOpenChange={setIsTranslateDialogOpen}>
        <DialogContent className="max-w-2xl bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Translate Key: {selectedKey?.key}</DialogTitle>
            <DialogDescription className="text-gray-600">
              {selectedKey?.defaultValue}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="translate-language">Language</Label>
              <Select value={translationForm.language} onValueChange={(value) => setTranslationForm({ ...translationForm, language: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {languages.filter(l => l.isEnabled).map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="translate-value">Translation</Label>
              <Textarea
                id="translate-value"
                placeholder="Enter translation..."
                value={translationForm.value}
                onChange={(e) => setTranslationForm({ ...translationForm, value: e.target.value })}
                rows={3}
              />
            </div>
            
            {/* Existing translations */}
            {translations.length > 0 && (
              <div>
                <Label>Existing Translations</Label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {translations.map((translation) => {
                    const language = languages.find(l => l.code === translation.language);
                    return (
                      <div key={translation._id} className="p-3 border rounded">
                        <div className="flex items-center justify-between mb-1">
                          <Badge>{language?.name || translation.language}</Badge>
                          <Badge variant={translation.isCompleted ? "default" : "secondary"}>
                            {translation.isCompleted ? "Complete" : "Draft"}
                          </Badge>
                        </div>
                        <p className="text-sm">{translation.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTranslateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => saveTranslationMutation.mutate({
                keyId: selectedKey!._id,
                language: translationForm.language,
                value: translationForm.value,
                isCompleted: true
              })}
              disabled={saveTranslationMutation.isPending || !translationForm.language || !translationForm.value}
            >
              Save Translation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}