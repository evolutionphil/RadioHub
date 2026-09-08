import { AdminPage } from "./AdminPage";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { Trash2, Edit2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Advertisement {
  _id: string;
  title: string;
  imageUrl: string;
  altText: string;
  seoDescription: string;
  url: string;
  position: 'desktop_sidebar' | 'mobile_bottom' | 'middle_section';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  title: string;
  imageUrl: string;
  altText: string;
  seoDescription: string;
  url: string;
  position: 'desktop_sidebar' | 'mobile_bottom' | 'middle_section';
  isActive: boolean;
}

const emptyForm = (position: FormData['position'] = 'desktop_sidebar'): FormData => ({
  title: '', imageUrl: '', altText: '', seoDescription: '', url: '', position, isActive: true,
});
const positionLabels: Record<FormData['position'], string> = {
  desktop_sidebar: 'Desktop Sidebar', mobile_bottom: 'Mobile Bottom', middle_section: 'Middle Section',
};

export default function AdvertisementsAdmin() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<'desktop_sidebar' | 'mobile_bottom' | 'middle_section'>('desktop_sidebar');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(() => emptyForm());
  const uploadVersion = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const cancelImageUpload = () => {
    uploadVersion.current++;
    uploadController.current?.abort();
    uploadController.current = null;
    setUploadingImage(false);
  };
  useEffect(() => () => {
    uploadVersion.current++;
    uploadController.current?.abort();
  }, []);

  const { data: ads, isLoading, isError, isFetching, refetch } = useQuery<Advertisement[]>({
    queryKey: ["/api/admin/advertisements"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch('/api/admin/advertisements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to create ad');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/advertisements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertisements"] });
      cancelImageUpload();
      setFormData(emptyForm());
      setPreviewImage(null);
      setShowForm(false);
      toast({ description: 'Advertisement created successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to create advertisement', variant: 'destructive' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch(`/api/admin/advertisements/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to update ad');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/advertisements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertisements"] });
      setEditingId(null);
      cancelImageUpload();
      setFormData(emptyForm());
      setPreviewImage(null);
      setShowForm(false);
      toast({ description: 'Advertisement updated successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to update advertisement', variant: 'destructive' });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/advertisements/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete ad');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/advertisements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertisements"] });
      toast({ description: 'Advertisement deleted successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to delete advertisement', variant: 'destructive' });
    }
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    const version = ++uploadVersion.current;
    setUploadingImage(true);
    try {
      const formDataObj = new FormData();
      formDataObj.append('image', file);
      formDataObj.append('position', selectedPosition);

      const response = await fetch('/api/admin/advertisements/upload', {
        method: 'POST',
        body: formDataObj,
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      if (version !== uploadVersion.current || controller.signal.aborted) return;
      if (typeof data.imageUrl !== 'string' || !data.imageUrl.trim()) throw new Error('Upload did not return an image URL');
      setFormData(prev => ({ ...prev, imageUrl: data.imageUrl }));
      setPreviewImage(data.imageUrl);
      toast({ description: 'Image uploaded successfully!' });
    } catch (error) {
      if (version === uploadVersion.current && !controller.signal.aborted) {
        toast({ description: 'Failed to upload image', variant: 'destructive' });
      }
    } finally {
      if (version === uploadVersion.current) {
        uploadController.current = null;
        setUploadingImage(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadingImage || createMutation.isPending || updateMutation.isPending) return;
    if (!formData.imageUrl.trim() || !formData.url.trim()) {
      toast({ description: 'Upload an image and enter a destination URL before saving', variant: 'destructive' });
      return;
    }
    const submittedData = { ...formData, position: selectedPosition };
    if (editingId) {
      updateMutation.mutate(submittedData);
    } else {
      createMutation.mutate(submittedData);
    }
  };

  const handleEdit = (ad: Advertisement) => {
    cancelImageUpload();
    setEditingId(ad._id);
    setSelectedPosition(ad.position);
    setFormData({
      title: ad.title,
      imageUrl: ad.imageUrl,
      altText: ad.altText,
      seoDescription: ad.seoDescription,
      url: ad.url,
      position: ad.position,
      isActive: ad.isActive
    });
    setPreviewImage(ad.imageUrl);
    setShowForm(true);
  };

  const handleCreate = (position: FormData['position']) => {
    cancelImageUpload();
    setEditingId(null);
    setSelectedPosition(position);
    setFormData(emptyForm(position));
    setPreviewImage(null);
    setShowForm(true);
  };
  const saving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-300 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <AdminPage title="Advertisement Management" description="Choose an ad spot and upload your image">

      {/* Quick Add Buttons - Choose which ad spot to add */}
      {!showForm && (
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => handleCreate('desktop_sidebar')}
            className="p-6 border-2 border-dashed border-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-center"
            data-testid="button-add-desktop-ad"
          >
            <div className="text-2xl mb-2">🖥️</div>
            <h3 className="font-bold text-lg mb-1">Desktop Ad</h3>
            <p className="text-sm text-muted-foreground">Sidebar ad (h-56, square)</p>
            {(ads ?? []).filter(a => a.position === 'desktop_sidebar').length > 0 && (
              <p className="text-xs text-green-600 mt-2">✓ {(ads ?? []).filter(a => a.position === 'desktop_sidebar').length} ad(s)</p>
            )}
          </button>

          <button
            onClick={() => handleCreate('mobile_bottom')}
            className="p-6 border-2 border-dashed border-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-center"
            data-testid="button-add-mobile-ad"
          >
            <div className="text-2xl mb-2">📱</div>
            <h3 className="font-bold text-lg mb-1">Mobile Ad</h3>
            <p className="text-sm text-muted-foreground">Bottom ad (h-64, rectangle)</p>
            {(ads ?? []).filter(a => a.position === 'mobile_bottom').length > 0 && (
              <p className="text-xs text-green-600 mt-2">✓ {(ads ?? []).filter(a => a.position === 'mobile_bottom').length} ad(s)</p>
            )}
          </button>

          <button
            onClick={() => handleCreate('middle_section')}
            className="p-6 border-2 border-dashed border-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors text-center"
            data-testid="button-add-middle-ad"
          >
            <div className="text-2xl mb-2">📊</div>
            <h3 className="font-bold text-lg mb-1">Middle Ad</h3>
            <p className="text-sm text-muted-foreground">Between sections (h-40, wide)</p>
            {(ads ?? []).filter(a => a.position === 'middle_section').length > 0 && (
              <p className="text-xs text-green-600 mt-2">✓ {(ads ?? []).filter(a => a.position === 'middle_section').length} ad(s)</p>
            )}
          </button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="bg-white dark:bg-gray-900">
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Advertisement' : 'Create New Advertisement'}</CardTitle>
            <CardDescription>
              Add image, SEO description, and destination URL
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" aria-busy={uploadingImage || saving}>
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium">
                  {selectedPosition === 'desktop_sidebar' ? '🖥️ Desktop Ad (h-56, square)' : selectedPosition === 'mobile_bottom' ? '📱 Mobile Ad (h-64, rectangle)' : '📊 Middle Ad (h-40, wide)'}
                </p>
              </div>

              <div>
                <label htmlFor="ad-title" className="block text-sm font-medium mb-1">Title</label>
                <Input
                  id="ad-title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Advertisement title"
                  data-testid="input-ad-title"
                  required
                />
              </div>

              <div>
                <label htmlFor="ad-image-upload" className="block text-sm font-medium mb-2">Upload Image</label>
                <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4">
                  <input
                    id="ad-image-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleImageUpload}
                    disabled={uploadingImage || saving}
                    className="w-full"
                    data-testid="input-ad-image-upload"
                  />
                  {uploadingImage && <p role="status" className="text-sm text-muted-foreground mt-2">Uploading...</p>}
                </div>
                
                {previewImage && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Preview:</p>
                    <img 
                      src={previewImage} 
                      alt="Preview" 
                      className={`rounded border ${selectedPosition === 'desktop_sidebar' ? 'w-full h-56 object-cover' : 'w-full h-64 object-cover'}`}
                      data-testid="img-ad-preview"
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="ad-alt" className="block text-sm font-medium mb-1">Alt Text (SEO)</label>
                <Input
                  id="ad-alt"
                  value={formData.altText}
                  onChange={(e) => setFormData({ ...formData, altText: e.target.value })}
                  placeholder="Describe the image for accessibility"
                  data-testid="input-ad-alt"
                  required
                />
              </div>

              <div>
                <label htmlFor="ad-description" className="block text-sm font-medium mb-1">SEO Description</label>
                <Textarea
                  id="ad-description"
                  value={formData.seoDescription}
                  onChange={(e) => setFormData({ ...formData, seoDescription: e.target.value })}
                  placeholder="Description for search engines"
                  data-testid="textarea-ad-description"
                  required
                />
              </div>

              <div>
                <label htmlFor="ad-url" className="block text-sm font-medium mb-1">Destination URL</label>
                <Input
                  id="ad-url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://example.com"
                  data-testid="input-ad-url"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  data-testid="checkbox-ad-active"
                />
                <label htmlFor="isActive" className="text-sm font-medium">Active</label>
              </div>

              <div className="flex gap-2">
                <Button 
                  type="submit" 
                  disabled={saving || uploadingImage || !formData.imageUrl.trim() || !formData.url.trim()}
                  data-testid="button-submit-ad"
                >
                  {editingId ? 'Update' : 'Create'} Advertisement
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  disabled={saving}
                  onClick={() => {
                    cancelImageUpload();
                    setShowForm(false);
                    setEditingId(null);
                    setPreviewImage(null);
                    setSelectedPosition('desktop_sidebar');
                    setFormData(emptyForm());
                  }}
                  data-testid="button-cancel-ad"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Advertisement List */}
      {isError && (
        <Card className="bg-white dark:bg-gray-900">
          <CardContent className="pt-6" role="alert">
            <p>Advertisements could not be loaded. Please try again.</p>
            <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching} className="mt-3">Retry</Button>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4">
        {ads && ads.length > 0 ? (
          ads.map((ad) => (
            <Card key={ad._id} className="bg-white dark:bg-gray-900">
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <img 
                      src={ad.imageUrl} 
                      alt={ad.altText}
                      className="w-32 h-32 object-cover rounded"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/images/no-image.webp';
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-bold text-lg">{ad.title}</h3>
                        <p className="text-sm text-muted-foreground">{ad.seoDescription}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(ad)}
                          disabled={saving}
                          aria-label={`Edit ${ad.title}`}
                          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          data-testid={`button-edit-ad-${ad._id}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(ad._id)}
                          disabled={deleteMutation.isPending || saving}
                          aria-label={`Delete ${ad.title}`}
                          className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                          data-testid={`button-delete-ad-${ad._id}`}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p><span className="font-medium">URL:</span> <a href={ad.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{ad.url}</a></p>
                      <p><span className="font-medium">Position:</span> {positionLabels[ad.position]}</p>
                      <p><span className="font-medium">Status:</span> <span className={ad.isActive ? 'text-green-600' : 'text-gray-500'}>{ad.isActive ? 'Active' : 'Inactive'}</span></p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : !isError ? (
          <Card className="bg-white dark:bg-gray-900">
            <CardContent className="pt-6 text-center py-12">
              <p className="text-muted-foreground">No advertisements yet. Create your first ad!</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AdminPage>
  );
}
