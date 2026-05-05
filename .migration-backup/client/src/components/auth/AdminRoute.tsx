import { useEffect } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, Lock } from "lucide-react";

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAuthenticated, isLoading, isAdmin } = useAdminAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) {
      toast({
        title: "Access Denied",
        description: "You need admin privileges to access this page.",
        variant: "destructive",
      });
    }
  }, [isAuthenticated, isLoading, isAdmin, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0E0E0E]">
        <div className="bg-[#151515] py-7">
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold text-white md:text-3xl">Admin Access Required</h1>
          </div>
        </div>

        <div className="container mx-auto p-6">
          <Card className="bg-[#151515] border-gray-800">
            <CardHeader className="text-center">
              <Lock className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <CardTitle className="text-white text-2xl">Authentication Required</CardTitle>
              <p className="text-gray-400">
                You must be logged in to access admin features
              </p>
            </CardHeader>
            <CardContent className="text-center">
              <Button 
                onClick={() => window.location.href = '/admin/login'}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3"
              >
                Admin Sign In
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0E0E0E]">
        <div className="bg-[#151515] py-7">
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold text-white md:text-3xl">Admin Access Denied</h1>
          </div>
        </div>

        <div className="container mx-auto p-6">
          <Card className="bg-[#151515] border-gray-800">
            <CardHeader className="text-center">
              <Shield className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <CardTitle className="text-white text-2xl">Access Denied</CardTitle>
              <p className="text-gray-400">
                You do not have administrator privileges required to access this page
              </p>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4 mb-6">
                <div className="flex items-center space-x-2 text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Administrator Access Required</span>
                </div>
                <p className="text-red-300 text-sm mt-2">
                  Current role: <span className="font-mono bg-gray-800 px-2 py-1 rounded">{user?.role || 'user'}</span>
                </p>
                <p className="text-red-300 text-sm mt-1">
                  Required role: <span className="font-mono bg-gray-800 px-2 py-1 rounded">admin</span>
                </p>
              </div>

              <div className="space-y-2">
                <Button 
                  onClick={() => window.location.href = '/'}
                  variant="outline"
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Return to Home
                </Button>
                <p className="text-xs text-gray-500">
                  Contact your system administrator if you believe you should have admin access
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}