import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Globe, Star, Languages } from "lucide-react";

interface TranslationLanguage {
  _id: string;
  code: string;
  name: string;
  isEnabled: boolean;
  isDefault?: boolean;
  completionPercentage?: number;
  createdAt: string;
}

const predefinedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'tr', name: 'Turkish' },
  { code: 'he', name: 'Hebrew' }
];

export default function AdminTranslationLanguages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<TranslationLanguage | null>(null);

  // Form states
  const [newLanguage, setNewLanguage] = useState({
    code: "",
    name: "",
    isEnabled: true,
    isDefault: false
  });

  const [editLanguage, setEditLanguage] = useState({
    code: "",
    name: "",
    isEnabled: true,
    isDefault: false
  });

  // Fetch languages
  const { data: languages = [], isLoading } = useQuery<TranslationLanguage[]>({
    queryKey: ['/api/admin/translation-languages'],
    queryFn: async () => {
      const response = await fetch('/api/admin/translation-languages', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch languages');
      return response.json();
    },
  });

  // Create language mutation
  const createLanguageMutation = useMutation({
    mutationFn: async (languageData: any) => {
      return apiRequest("POST", "/api/admin/translation-languages", { body: languageData });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Language added successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
      setIsAddDialogOpen(false);
      resetNewLanguageForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to add language",
        variant: "destructive" 
      });
    }
  });

  // Update language mutation
  const updateLanguageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string, data: any }) => {
      return apiRequest("PUT", `/api/admin/translation-languages/${id}`, { body: data });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Language updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
      setIsEditDialogOpen(false);
      setSelectedLanguage(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update language",
        variant: "destructive" 
      });
    }
  });

  // Delete language mutation
  const deleteLanguageMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/translation-languages/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Language deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete language",
        variant: "destructive" 
      });
    }
  });

  // Toggle language status mutation
  const toggleLanguageMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string, isEnabled: boolean }) => {
      return apiRequest("PUT", `/api/admin/translation-languages/${id}`, { 
        body: { isEnabled } 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update language status",
        variant: "destructive" 
      });
    }
  });

  // Seed all 55 translation languages mutation
  const seedLanguagesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/seed-translation-languages");
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Success", 
        description: `Synced ${data.stats.created} new languages (${data.stats.skipped} already existed)` 
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to sync languages",
        variant: "destructive" 
      });
    }
  });

  // Auto-translate language via OpenAI
  const translateLanguageMutation = useMutation({
    mutationFn: async (code: string) => {
      return apiRequest("POST", `/api/admin/translation-languages/${code}/translate`);
    },
    onSuccess: (data: any, code: string) => {
      toast({ 
        title: "Translation Complete", 
        description: `Translated ${data.stats.translated} keys for ${data.message}. Failed: ${data.stats.failed}`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/translation-languages'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Translation Failed", 
        description: error.message || "Failed to auto-translate language",
        variant: "destructive" 
      });
    }
  });

  const resetNewLanguageForm = () => {
    setNewLanguage({
      code: "",
      name: "",
      isEnabled: true,
      isDefault: false
    });
  };

  const handleEditLanguage = (language: TranslationLanguage) => {
    setSelectedLanguage(language);
    setEditLanguage({
      code: language.code,
      name: language.name,
      isEnabled: language.isEnabled,
      isDefault: language.isDefault || false
    });
    setIsEditDialogOpen(true);
  };

  const predefinedLanguages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'tr', name: 'Turkish' },
    { code: 'ar', name: 'Arabic' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'hi', name: 'Hindi' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'pl', name: 'Polish' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'da', name: 'Danish' },
    { code: 'no', name: 'Norwegian' }
  ];

  const addPredefinedLanguage = (lang: { code: string, name: string }) => {
    setNewLanguage({
      code: lang.code,
      name: lang.name,
      isEnabled: true,
      isDefault: false
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Language Management</h1>
          <p className="text-muted-foreground">
            Manage available languages for translations
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => seedLanguagesMutation.mutate()}
            disabled={seedLanguagesMutation.isPending}
            data-testid="button-sync-languages"
          >
            <Globe className="w-4 h-4 mr-2" />
            {seedLanguagesMutation.isPending ? 'Syncing...' : 'Sync All 55 Languages'}
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-language">
            <Plus className="w-4 h-4 mr-2" />
            Add Language
          </Button>
        </div>
      </div>

      {/* Language Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Languages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{languages.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Enabled Languages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{languages.filter(l => l.isEnabled).length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Default Language</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {languages.find(l => l.isDefault)?.code.toUpperCase() || 'None'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg. Completion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {languages.length > 0 
                ? Math.round(languages.reduce((acc, l) => acc + (l.completionPercentage || 0), 0) / languages.length)
                : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Languages Table */}
      <Card>
        <CardHeader>
          <CardTitle>Translation Languages ({languages.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Language</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completion</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {languages.map((language) => (
                  <TableRow key={language._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {language.name}
                        {language.isDefault && (
                          <Star className="w-4 h-4 text-yellow-500 fill-current" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{language.code.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={language.isEnabled}
                          onCheckedChange={(checked) => 
                            toggleLanguageMutation.mutate({ 
                              id: language._id, 
                              isEnabled: checked 
                            })
                          }
                          disabled={toggleLanguageMutation.isPending}
                        />
                        <span className={language.isEnabled ? "text-green-600" : "text-gray-500"}>
                          {language.isEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full" 
                            style={{ width: `${language.completionPercentage || 0}%` }}
                          ></div>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {language.completionPercentage || 0}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={language.completionPercentage === 0 ? "default" : "outline"}
                          onClick={() => translateLanguageMutation.mutate(language.code)}
                          disabled={translateLanguageMutation.isPending}
                          title={language.completionPercentage === 100 ? "Already translated" : "Translate via OpenAI"}
                        >
                          <Languages className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditLanguage(language)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteLanguageMutation.mutate(language._id)}
                          disabled={deleteLanguageMutation.isPending || language.isDefault}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Language Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Add Language</DialogTitle>
            <DialogDescription className="text-gray-600">
              Add a new language for translations
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-code">Language Code</Label>
              <Input
                id="new-code"
                placeholder="e.g., en, es, fr"
                value={newLanguage.code}
                onChange={(e) => setNewLanguage({ ...newLanguage, code: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <Label htmlFor="new-name">Language Name</Label>
              <Input
                id="new-name"
                placeholder="e.g., English, Spanish, French"
                value={newLanguage.name}
                onChange={(e) => setNewLanguage({ ...newLanguage, name: e.target.value })}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="new-enabled"
                checked={newLanguage.isEnabled}
                onCheckedChange={(checked) => setNewLanguage({ ...newLanguage, isEnabled: checked })}
              />
              <Label htmlFor="new-enabled">Enable this language</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="new-default"
                checked={newLanguage.isDefault}
                onCheckedChange={(checked) => setNewLanguage({ ...newLanguage, isDefault: checked })}
              />
              <Label htmlFor="new-default">Set as default language</Label>
            </div>

            {/* Quick add buttons for common languages */}
            <div>
              <Label>Quick Add</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {predefinedLanguages.slice(0, 9).map((lang) => (
                  <Button
                    key={lang.code}
                    variant="outline"
                    size="sm"
                    onClick={() => addPredefinedLanguage(lang)}
                    disabled={languages.some(l => l.code === lang.code)}
                  >
                    {lang.code.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createLanguageMutation.mutate(newLanguage)}
              disabled={createLanguageMutation.isPending || !newLanguage.code || !newLanguage.name}
            >
              Add Language
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Language Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md bg-white border border-gray-200 shadow-lg text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Edit Language</DialogTitle>
            <DialogDescription className="text-gray-600">
              Update language details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-code">Language Code</Label>
              <Input
                id="edit-code"
                value={editLanguage.code}
                onChange={(e) => setEditLanguage({ ...editLanguage, code: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <Label htmlFor="edit-name">Language Name</Label>
              <Input
                id="edit-name"
                value={editLanguage.name}
                onChange={(e) => setEditLanguage({ ...editLanguage, name: e.target.value })}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-enabled"
                checked={editLanguage.isEnabled}
                onCheckedChange={(checked) => setEditLanguage({ ...editLanguage, isEnabled: checked })}
              />
              <Label htmlFor="edit-enabled">Enable this language</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-default"
                checked={editLanguage.isDefault}
                onCheckedChange={(checked) => setEditLanguage({ ...editLanguage, isDefault: checked })}
              />
              <Label htmlFor="edit-default">Set as default language</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateLanguageMutation.mutate({ id: selectedLanguage!._id, data: editLanguage })}
              disabled={updateLanguageMutation.isPending}
            >
              Update Language
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}