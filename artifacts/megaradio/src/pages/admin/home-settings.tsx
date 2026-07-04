import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Music, Share2 } from "lucide-react";
import { AdminPage } from "./AdminPage";

export default function HomeSettings() {
  return (
    <AdminPage title="Home Page Settings" description="Manage homepage content and features">
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
    </AdminPage>
  );
}
