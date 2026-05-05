import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Shield, LogIn } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useEffect } from "react";

export default function AdminLogin() {
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });

  const { toast } = useToast();
  const { isAuthenticated, isAdmin, refetch } = useAdminAuth();

  // Redirect if already authenticated as admin
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      window.location.href = "/admin/dashboard";
    }
  }, [isAuthenticated, isAdmin]);

  const loginMutation = useMutation({
    mutationFn: async (loginData: { username: string; password: string }) => {
      return apiRequest("POST", "/api/admin/login", { body: loginData });
    },
    onSuccess: () => {
      toast({
        title: "Login Successful",
        description: "Welcome back, administrator!",
      });
      
      // Refetch admin auth state
      refetch().then(() => {
        // Redirect to admin dashboard
        setTimeout(() => {
          window.location.href = "/admin/dashboard";
        }, 100);
      });
    },
    onError: (error: any) => {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid admin credentials",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }

    loginMutation.mutate(credentials);
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center px-4">
      <Card className="w-full max-w-md bg-[#151515] border-gray-800">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">Admin Login</CardTitle>
          <CardDescription className="text-gray-400">
            Sign in to access the admin dashboard
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-300">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                value={credentials.username}
                onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                className="bg-[#1A1A1A] border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                placeholder="Enter admin username"
                required
                data-testid="input-admin-username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={credentials.password}
                onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                className="bg-[#1A1A1A] border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                placeholder="Enter admin password"
                required
                data-testid="input-admin-password"
              />
            </div>

            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3"
              data-testid="button-admin-login"
            >
              {loginMutation.isPending ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Signing in...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </div>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <div className="text-center space-y-2">
              <p className="text-xs text-gray-500">
                Default credentials for development:
              </p>
              <div className="bg-gray-800 rounded-lg p-3 text-left">
                <div className="font-mono text-sm text-gray-300 space-y-1">
                  <div>Username: <span className="text-blue-400">admin</span></div>
                  <div>Password: <span className="text-blue-400">admin123</span></div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 text-center">
            <Button
              variant="outline"
              onClick={() => window.location.href = "/"}
              className="border-gray-700 text-gray-400 hover:bg-gray-800"
              data-testid="button-return-home"
            >
              Return to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}