import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Eye, Search } from 'lucide-react';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { queryClient } from '@/lib/queryClient';

interface SeoData {
  seoTags: {
    title: string;
    description: string;
    keywords: string;
    canonical: string;
    ogTitle: string;
    ogDescription: string;
    ogType: string;
    ogUrl: string;
    twitterCard: string;
    twitterTitle: string;
    twitterDescription: string;
    hreflangs?: Array<{ lang: string; url: string; hreflang: string }>;
  };
}

const LANGUAGES = SEO_LANGUAGES
  .filter(lang => lang.enabled)
  .map(lang => ({
    code: lang.code,
    name: lang.name || lang.code.toUpperCase()
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function SeoPreview() {
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  const url = selectedLanguage === 'en' ? '/' : `/${selectedLanguage}`;
  
  const { data: seoData, isLoading } = useQuery<SeoData>({
    queryKey: ['/api/seo/page-data', { url }],
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/seo/page-data', { url }] });
  };

  const hreflangCount = seoData?.seoTags?.hreflangs?.length || 0;

  return (
    <div className="container mx-auto p-6 max-w-7xl" data-testid="admin-seo-preview">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Search className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">SEO Meta Tags Preview</h1>
          </div>
          <Badge variant="outline" className="text-sm">
            <Eye className="h-3 w-3 mr-1" />
            How Google Sees Your Site
          </Badge>
        </div>
        <p className="text-muted-foreground">
          View how search engines see your homepage meta tags for different languages
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Language Selection</CardTitle>
            <CardDescription>
              Choose a language to see how Google crawls that version of your homepage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select
                value={selectedLanguage}
                onValueChange={setSelectedLanguage}
              >
                <SelectTrigger className="w-64" data-testid="select-language">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name} ({lang.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                data-testid="button-refresh"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading SEO data...</span>
            </CardContent>
          </Card>
        ) : seoData ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Primary Meta Tags</CardTitle>
                <CardDescription>
                  Title and description that appear in Google search results
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground">Title Tag</label>
                  <div className="mt-1 p-4 bg-muted rounded-lg border" data-testid="text-title">
                    <code className="text-sm">&lt;title&gt;{seoData.seoTags.title}&lt;/title&gt;</code>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Length: {seoData.seoTags.title?.length || 0} characters
                    {seoData.seoTags.title?.length > 60 && ' ⚠️ May be truncated (optimal: 50-60 chars)'}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-muted-foreground">Meta Description</label>
                  <div className="mt-1 p-4 bg-muted rounded-lg border" data-testid="text-description">
                    <code className="text-sm">
                      &lt;meta name="description" content="{seoData.seoTags.description}" /&gt;
                    </code>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Length: {seoData.seoTags.description?.length || 0} characters
                    {seoData.seoTags.description?.length > 160 && ' ⚠️ May be truncated (optimal: 150-160 chars)'}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-muted-foreground">Canonical URL</label>
                  <div className="mt-1 p-4 bg-muted rounded-lg border">
                    <code className="text-sm">
                      &lt;link rel="canonical" href="{seoData.seoTags.canonical}" /&gt;
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Open Graph (Social Media)</CardTitle>
                <CardDescription>
                  How your page appears when shared on Facebook, LinkedIn, etc.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">OG Title</label>
                    <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.ogTitle}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">OG Type</label>
                    <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.ogType}</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">OG Description</label>
                  <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.ogDescription}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">OG URL</label>
                  <p className="mt-1 text-sm p-2 bg-muted rounded border font-mono">{seoData.seoTags.ogUrl}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Twitter Card</CardTitle>
                <CardDescription>
                  How your page appears when shared on Twitter/X
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Card Type</label>
                    <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.twitterCard}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Twitter Title</label>
                    <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.twitterTitle}</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Twitter Description</label>
                  <p className="mt-1 text-sm p-2 bg-muted rounded border">{seoData.seoTags.twitterDescription}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hreflang Tags</CardTitle>
                <CardDescription>
                  International SEO - tells Google about all language versions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Badge variant="secondary" className="text-lg">
                    {hreflangCount} Language Versions
                  </Badge>
                </div>
                <div className="max-h-96 overflow-y-auto space-y-1">
                  {seoData.seoTags.hreflangs?.map((tag, index: number) => (
                    <div
                      key={index}
                      className="p-2 bg-muted rounded text-xs font-mono border"
                    >
                      &lt;link rel="alternate" hreflang="{tag.hreflang}" href="{tag.url}" /&gt;
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>SEO Keywords</CardTitle>
                <CardDescription>
                  Target keywords for search engine optimization
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm p-3 bg-muted rounded border">{seoData.seoTags.keywords}</p>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No SEO data available
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
