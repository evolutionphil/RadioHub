import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/lib/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings as SettingsIcon,
  Server,
  Database,
  Radio,
  Globe,
  Shield,
  Bell,
  Palette,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Music
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SystemSettings {
  // General Settings
  siteName: string;
  siteDescription: string;
  contactEmail: string;
  timezone: string;
  language: string;
  
  // Radio Settings
  defaultBitrate: number;
  maxConcurrentStreams: number;
  streamTimeout: number;
  enableAutoSync: boolean;
  syncInterval: number;
  
  // Database Settings
  mongoUrl: string;
  maxConnections: number;
  connectionTimeout: number;
  enableBackup: boolean;
  backupInterval: number;
  
  // API Settings
  rateLimit: number;
  apiTimeout: number;
  enableCors: boolean;
  allowedOrigins: string[];
  
  // Security Settings
  enableHttps: boolean;
  jwtSecret: string;
  sessionTimeout: number;
  enableTwoFactor: boolean;
  passwordMinLength: number;
  
  // Notification Settings
  enableEmailNotifications: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  
  // UI Settings
  theme: 'light' | 'dark' | 'auto';
  primaryColor: string;
  enableAnimations: boolean;
  compactMode: boolean;
  
  // Performance Settings
  enableCaching: boolean;
  cacheTimeout: number;
  enableCompression: boolean;
  maxFileSize: number;
}

const defaultSettings: SystemSettings = {
  // General
  siteName: "Mega Radio Manager",
  siteDescription: "Professional Radio Station Management Platform",
  contactEmail: "admin@megaradio.com",
  timezone: "UTC",
  language: "en",
  
  // Radio
  defaultBitrate: 128,
  maxConcurrentStreams: 1000,
  streamTimeout: 30000,
  enableAutoSync: true,
  syncInterval: 240, // 4 hours
  
  // Database
  mongoUrl: "mongodb://localhost:27017/megaradio",
  maxConnections: 100,
  connectionTimeout: 30000,
  enableBackup: true,
  backupInterval: 1440, // 24 hours
  
  // API
  rateLimit: 100,
  apiTimeout: 30000,
  enableCors: true,
  allowedOrigins: ["*"],
  
  // Security
  enableHttps: false,
  jwtSecret: "",
  sessionTimeout: 1440, // 24 hours
  enableTwoFactor: false,
  passwordMinLength: 8,
  
  // Notifications
  enableEmailNotifications: false,
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPassword: "",
  
  // UI
  theme: 'light',
  primaryColor: '#3b82f6',
  enableAnimations: true,
  compactMode: false,
  
  // Performance
  enableCaching: true,
  cacheTimeout: 3600,
  enableCompression: true,
  maxFileSize: 10485760 // 10MB
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: currentSettings, isLoading } = useQuery({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      return response.json();
    }
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: SystemSettings) => {
      const response = await apiRequest('PUT', '/api/settings', newSettings);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: "Settings saved successfully" });
      setHasChanges(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to save settings", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Test connection mutations
  const testDatabaseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/settings/test-database');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: data.success ? "Database connection successful" : "Database connection failed",
        description: data.message,
        variant: data.success ? "default" : "destructive"
      });
    }
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/settings/test-email', {
        to: settings.contactEmail,
        subject: "Test Email from Mega Radio Manager",
        body: "This is a test email to verify SMTP configuration."
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: data.success ? "Test email sent successfully" : "Failed to send test email",
        description: data.message,
        variant: data.success ? "default" : "destructive"
      });
    }
  });

  useEffect(() => {
    if (currentSettings) {
      setSettings(currentSettings);
    }
  }, [currentSettings]);

  const handleSettingChange = (key: keyof SystemSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
    setHasChanges(true);
  };

  const handleArraySettingChange = (key: keyof SystemSettings, value: string) => {
    const arrayValue = value.split(',').map(item => item.trim()).filter(Boolean);
    handleSettingChange(key, arrayValue);
  };

  const handleSave = () => {
    updateSettingsMutation.mutate(settings);
  };

  const handleReset = () => {
    setSettings(currentSettings || defaultSettings);
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">System Settings</h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Configure your radio management platform</p>
        </div>
        
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
          {hasChanges && (
            <Button variant="outline" onClick={handleReset} className="w-full sm:w-auto">
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          )}
          <Button 
            onClick={handleSave}
            disabled={!hasChanges || updateSettingsMutation.isPending}
            className="w-full sm:w-auto"
          >
            <Save className="w-4 h-4 mr-2" />
            {updateSettingsMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Quick Links Section */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <a 
              href="/admin/genres" 
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              <Music className="w-4 h-4 mr-2" />
              Discover Genres Home
            </a>
            <a 
              href="/admin/footer-social-media" 
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              <Globe className="w-4 h-4 mr-2" />
              Footer Social Media
            </a>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-1">
          <TabsTrigger value="general" className="text-xs sm:text-sm">General</TabsTrigger>
          <TabsTrigger value="radio" className="text-xs sm:text-sm">Radio</TabsTrigger>
          <TabsTrigger value="database" className="text-xs sm:text-sm hidden sm:block">Database</TabsTrigger>
          <TabsTrigger value="api" className="text-xs sm:text-sm hidden lg:block">API</TabsTrigger>
          <TabsTrigger value="security" className="text-xs sm:text-sm hidden lg:block">Security</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs sm:text-sm hidden lg:block">Notifications</TabsTrigger>
          <TabsTrigger value="appearance" className="text-xs sm:text-sm">Appearance</TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <SettingsIcon className="w-5 h-5 mr-2" />
                General Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="siteName">Site Name</Label>
                  <Input
                    id="siteName"
                    value={settings.siteName}
                    onChange={(e) => handleSettingChange('siteName', e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={settings.contactEmail}
                    onChange={(e) => handleSettingChange('contactEmail', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="siteDescription">Site Description</Label>
                <Textarea
                  id="siteDescription"
                  value={settings.siteDescription}
                  onChange={(e) => handleSettingChange('siteDescription', e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={settings.timezone} onValueChange={(value) => handleSettingChange('timezone', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">Eastern Time</SelectItem>
                      <SelectItem value="America/Chicago">Central Time</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                      <SelectItem value="Europe/London">London</SelectItem>
                      <SelectItem value="Europe/Paris">Paris</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="language">Language</Label>
                  <Select value={settings.language} onValueChange={(value) => handleSettingChange('language', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                      <SelectItem value="it">Italian</SelectItem>
                      <SelectItem value="pt">Portuguese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Radio Settings */}
        <TabsContent value="radio">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Radio className="w-5 h-5 mr-2" />
                Radio Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultBitrate">Default Bitrate (kbps)</Label>
                  <Input
                    id="defaultBitrate"
                    type="number"
                    value={settings.defaultBitrate}
                    onChange={(e) => handleSettingChange('defaultBitrate', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maxConcurrentStreams">Max Concurrent Streams</Label>
                  <Input
                    id="maxConcurrentStreams"
                    type="number"
                    value={settings.maxConcurrentStreams}
                    onChange={(e) => handleSettingChange('maxConcurrentStreams', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="streamTimeout">Stream Timeout (ms)</Label>
                  <Input
                    id="streamTimeout"
                    type="number"
                    value={settings.streamTimeout}
                    onChange={(e) => handleSettingChange('streamTimeout', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableAutoSync"
                    checked={settings.enableAutoSync}
                    onCheckedChange={(checked) => handleSettingChange('enableAutoSync', checked)}
                  />
                  <Label htmlFor="enableAutoSync">Enable Automatic Sync</Label>
                </div>

                {settings.enableAutoSync && (
                  <div className="space-y-2">
                    <Label htmlFor="syncInterval">Sync Interval (minutes)</Label>
                    <Input
                      id="syncInterval"
                      type="number"
                      value={settings.syncInterval}
                      onChange={(e) => handleSettingChange('syncInterval', parseInt(e.target.value))}
                    />
                    <p className="text-sm text-gray-500">
                      How often to sync with Radio-Browser API (default: 240 minutes / 4 hours)
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Database Settings */}
        <TabsContent value="database">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Database className="w-5 h-5 mr-2" />
                Database Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="mongoUrl">MongoDB Connection URL</Label>
                <Input
                  id="mongoUrl"
                  type="password"
                  value={settings.mongoUrl}
                  onChange={(e) => handleSettingChange('mongoUrl', e.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testDatabaseMutation.mutate()}
                    disabled={testDatabaseMutation.isPending}
                  >
                    {testDatabaseMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4 mr-2" />
                    )}
                    Test Connection
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxConnections">Max Connections</Label>
                  <Input
                    id="maxConnections"
                    type="number"
                    value={settings.maxConnections}
                    onChange={(e) => handleSettingChange('maxConnections', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="connectionTimeout">Connection Timeout (ms)</Label>
                  <Input
                    id="connectionTimeout"
                    type="number"
                    value={settings.connectionTimeout}
                    onChange={(e) => handleSettingChange('connectionTimeout', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableBackup"
                    checked={settings.enableBackup}
                    onCheckedChange={(checked) => handleSettingChange('enableBackup', checked)}
                  />
                  <Label htmlFor="enableBackup">Enable Automatic Backups</Label>
                </div>

                {settings.enableBackup && (
                  <div className="space-y-2">
                    <Label htmlFor="backupInterval">Backup Interval (minutes)</Label>
                    <Input
                      id="backupInterval"
                      type="number"
                      value={settings.backupInterval}
                      onChange={(e) => handleSettingChange('backupInterval', parseInt(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Settings */}
        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Globe className="w-5 h-5 mr-2" />
                API Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rateLimit">Rate Limit (requests/minute)</Label>
                  <Input
                    id="rateLimit"
                    type="number"
                    value={settings.rateLimit}
                    onChange={(e) => handleSettingChange('rateLimit', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="apiTimeout">API Timeout (ms)</Label>
                  <Input
                    id="apiTimeout"
                    type="number"
                    value={settings.apiTimeout}
                    onChange={(e) => handleSettingChange('apiTimeout', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableCors"
                    checked={settings.enableCors}
                    onCheckedChange={(checked) => handleSettingChange('enableCors', checked)}
                  />
                  <Label htmlFor="enableCors">Enable CORS</Label>
                </div>

                {settings.enableCors && (
                  <div className="space-y-2">
                    <Label htmlFor="allowedOrigins">Allowed Origins (comma-separated)</Label>
                    <Input
                      id="allowedOrigins"
                      value={settings.allowedOrigins.join(', ')}
                      onChange={(e) => handleArraySettingChange('allowedOrigins', e.target.value)}
                      placeholder="https://example.com, https://app.example.com"
                    />
                    <p className="text-sm text-gray-500">
                      Use * to allow all origins (not recommended for production)
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Shield className="w-5 h-5 mr-2" />
                Security Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="enableHttps"
                  checked={settings.enableHttps}
                  onCheckedChange={(checked) => handleSettingChange('enableHttps', checked)}
                />
                <Label htmlFor="enableHttps">Force HTTPS</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jwtSecret">JWT Secret Key</Label>
                <Input
                  id="jwtSecret"
                  type="password"
                  value={settings.jwtSecret}
                  onChange={(e) => handleSettingChange('jwtSecret', e.target.value)}
                  placeholder="Enter a secure random string"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sessionTimeout">Session Timeout (minutes)</Label>
                  <Input
                    id="sessionTimeout"
                    type="number"
                    value={settings.sessionTimeout}
                    onChange={(e) => handleSettingChange('sessionTimeout', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="passwordMinLength">Minimum Password Length</Label>
                  <Input
                    id="passwordMinLength"
                    type="number"
                    value={settings.passwordMinLength}
                    onChange={(e) => handleSettingChange('passwordMinLength', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="enableTwoFactor"
                  checked={settings.enableTwoFactor}
                  onCheckedChange={(checked) => handleSettingChange('enableTwoFactor', checked)}
                />
                <Label htmlFor="enableTwoFactor">Enable Two-Factor Authentication</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notification Settings */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Bell className="w-5 h-5 mr-2" />
                Notification Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="enableEmailNotifications"
                  checked={settings.enableEmailNotifications}
                  onCheckedChange={(checked) => handleSettingChange('enableEmailNotifications', checked)}
                />
                <Label htmlFor="enableEmailNotifications">Enable Email Notifications</Label>
              </div>

              {settings.enableEmailNotifications && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="smtpHost">SMTP Host</Label>
                      <Input
                        id="smtpHost"
                        value={settings.smtpHost}
                        onChange={(e) => handleSettingChange('smtpHost', e.target.value)}
                        placeholder="smtp.gmail.com"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="smtpPort">SMTP Port</Label>
                      <Input
                        id="smtpPort"
                        type="number"
                        value={settings.smtpPort}
                        onChange={(e) => handleSettingChange('smtpPort', parseInt(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="smtpUser">SMTP Username</Label>
                      <Input
                        id="smtpUser"
                        value={settings.smtpUser}
                        onChange={(e) => handleSettingChange('smtpUser', e.target.value)}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="smtpPassword">SMTP Password</Label>
                      <Input
                        id="smtpPassword"
                        type="password"
                        value={settings.smtpPassword}
                        onChange={(e) => handleSettingChange('smtpPassword', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testEmailMutation.mutate()}
                      disabled={testEmailMutation.isPending}
                    >
                      {testEmailMutation.isPending ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Bell className="w-4 h-4 mr-2" />
                      )}
                      Send Test Email
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Settings */}
        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Palette className="w-5 h-5 mr-2" />
                Appearance Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="theme">Theme</Label>
                  <Select value={theme} onValueChange={(value: any) => setTheme(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">Auto (System)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Primary Color</Label>
                  <Input
                    id="primaryColor"
                    type="color"
                    value={settings.primaryColor}
                    onChange={(e) => handleSettingChange('primaryColor', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableAnimations"
                    checked={settings.enableAnimations}
                    onCheckedChange={(checked) => handleSettingChange('enableAnimations', checked)}
                  />
                  <Label htmlFor="enableAnimations">Enable Animations</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="compactMode"
                    checked={settings.compactMode}
                    onCheckedChange={(checked) => handleSettingChange('compactMode', checked)}
                  />
                  <Label htmlFor="compactMode">Compact Mode</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save Changes Banner */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 bg-yellow-50 dark:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              You have unsaved changes
            </span>
            <Button size="sm" onClick={handleSave}>
              Save Now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}