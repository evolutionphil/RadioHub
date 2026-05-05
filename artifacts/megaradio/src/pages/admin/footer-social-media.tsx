import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Trash2, Edit2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface FooterSocialMedia {
  _id: string;
  platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'whatsapp' | 'telegram' | 'reddit' | 'pinterest' | 'youtube' | 'tiktok';
  url: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'whatsapp' | 'telegram' | 'reddit' | 'pinterest' | 'youtube' | 'tiktok';
  url: string;
  isActive: boolean;
  position: number;
}

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' }
];

export default function FooterSocialMediaAdmin() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<FormData['platform']>('facebook');
  const [formData, setFormData] = useState<FormData>({
    platform: 'facebook',
    url: '',
    isActive: true,
    position: 0
  });

  const { data: socialLinks = [], isLoading } = useQuery<FooterSocialMedia[]>({
    queryKey: ["/api/admin/footer-social-media"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch('/api/admin/footer-social-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to create social link');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/footer-social-media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/footer-social-media"] });
      setFormData({
        platform: 'facebook',
        url: '',
        isActive: true,
        position: 0
      });
      setShowForm(false);
      toast({ description: 'Social media link created successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to create social media link', variant: 'destructive' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch(`/api/admin/footer-social-media/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to update social link');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/footer-social-media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/footer-social-media"] });
      setEditingId(null);
      setFormData({
        platform: 'facebook',
        url: '',
        isActive: true,
        position: 0
      });
      setShowForm(false);
      toast({ description: 'Social media link updated successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to update social media link', variant: 'destructive' });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/footer-social-media/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete social link');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/footer-social-media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/footer-social-media"] });
      toast({ description: 'Social media link deleted successfully!' });
    },
    onError: () => {
      toast({ description: 'Failed to delete social media link', variant: 'destructive' });
    }
  });

  const handleEditClick = (item: FooterSocialMedia) => {
    setEditingId(item._id);
    setFormData({
      platform: item.platform,
      url: item.url,
      isActive: item.isActive,
      position: item.position
    });
    setSelectedPlatform(item.platform);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Footer Social Media Links</h1>
        <Button onClick={() => { setEditingId(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Social Media Link
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Social Media Link' : 'Add New Social Media Link'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Platform</label>
                <Select value={selectedPlatform} onValueChange={(val: any) => {
                  setSelectedPlatform(val);
                  setFormData({ ...formData, platform: val });
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">URL</label>
                <Input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://facebook.com/..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Position (Order)</label>
                <Input
                  type="number"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: parseInt(e.target.value) || 0 })}
                  min="0"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="isActive" className="text-sm font-medium">Active</label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? 'Update' : 'Create'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingId(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {socialLinks.map((item) => (
          <Card key={item._id}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{PLATFORMS.find(p => p.value === item.platform)?.label}</h3>
                  <p className="text-sm text-gray-600">{item.url}</p>
                  <p className="text-xs text-gray-500 mt-2">Position: {item.position} | {item.isActive ? 'Active' : 'Inactive'}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditClick(item)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMutation.mutate(item._id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {socialLinks.length === 0 && !showForm && (
        <Card>
          <CardContent className="pt-6 text-center text-gray-500">
            No social media links configured yet. Add one to get started!
          </CardContent>
        </Card>
      )}
    </div>
  );
}
