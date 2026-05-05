import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Settings2, Music, Share2 } from "lucide-react";

export default function HomeSettings() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Home Page Settings</h1>
        <p className="text-gray-500 mt-2">Manage homepage content and features</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sections">Sections</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Homepage Management</CardTitle>
              <CardDescription>Configure homepage sections and content</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600">
                Manage all homepage content from this unified dashboard. Navigate to specific sections below to configure them.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sections" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Discover Genres Card */}
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Music className="w-5 h-5" />
                      Discover Genres
                    </CardTitle>
                    <CardDescription>Manage discoverable genres on homepage</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  Configure which genres appear in the "Discover Genres" carousel on the homepage. Control images, labels, and visibility.
                </p>
                <Link href="/admin/genres">
                  <Button variant="outline" className="w-full">
                    Manage Genres
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Social Media Card */}
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Share2 className="w-5 h-5" />
                      Social Media Links
                    </CardTitle>
                    <CardDescription>Manage footer social media icons</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  Add, edit, or remove social media links displayed in the footer. Control platform, URL, and visibility.
                </p>
                <Link href="/admin/footer-social-media">
                  <Button variant="outline" className="w-full">
                    Manage Social Media
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Coming Soon</CardTitle>
              <CardDescription className="text-blue-800">More homepage sections will be added here</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-blue-800">
              <p>Additional homepage management features will be consolidated under this menu as the platform grows.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
