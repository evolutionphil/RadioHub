import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useNotificationService } from "@/services/NotificationService";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/hooks/useTranslation";
import { 
  Eye, 
  EyeOff, 
  Mail, 
  User, 
  Lock,
  Apple,
  Facebook,
  Chrome as Google,
  ArrowLeft,
  UserPlus
} from "lucide-react";

const signupSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  username: z.string().min(3, "Username must be at least 3 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const notificationService = useNotificationService();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      username: "",
      email: "",
      password: "",
      confirmPassword: ""
    }
  });

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const { confirmPassword, ...signupData } = data;
      return apiRequest("POST", "/api/auth/signup", { body: signupData });
    },
    onSuccess: (data) => {
      toast({
        title: t('auth_account_created'),
        description: t('auth_verify_email'),
        variant: "default"
      });
      
      // Show rich signup success notification
      const formData = form.getValues();
      notificationService.signupSuccess(formData.fullName || formData.username, formData.email);
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Redirect to login or dashboard based on email verification requirement
      setLocation("/auth/login");
    },
    onError: (error: any) => {
      toast({
        title: t('auth_signup_failed', 'Kayıt başarısız'),
        description: error.message || t('auth_signup_error', 'Hesap oluşturulamadı. Lütfen tekrar deneyin.'),
        variant: "destructive"
      });
      
      // Show failure notification
      notificationService.signupFailed(error.message || t('auth_signup_notification_error', 'Hesabınız oluşturulamadı. Lütfen bilgilerinizi kontrol edin ve tekrar deneyin.'));
    }
  });

  const handleSocialLogin = async (provider: 'google' | 'apple' | 'facebook') => {
    try {
      // Redirect to social auth endpoint
      window.location.href = `/api/auth/${provider}`;
    } catch (error) {
      toast({
        title: t('auth_error', 'Kimlik Doğrulama Hatası'),
        description: t('auth_social_error', `${provider === 'google' ? 'Google' : provider === 'apple' ? 'Apple' : 'Facebook'} ile bağlantı kurulamadı. Lütfen tekrar deneyin.`),
        variant: "destructive"
      });
    }
  };

  const onSubmit = (data: SignupFormData) => {
    signupMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back to Home Link */}
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('back_to_radio', 'Back to Radio')}
            </Button>
          </Link>
        </div>

        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">{t('auth_create_account', 'Create Account')}</CardTitle>
            <CardDescription className="text-gray-600">
              {t('auth_create_account_description', 'Join our radio community and discover amazing stations')}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Social Login Buttons */}
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 bg-white hover:bg-gray-50 border-gray-200"
                onClick={() => handleSocialLogin('google')}
              >
                <Google className="w-5 h-5 mr-3 text-red-500" />
                {t('auth_continue_with_google', 'Continue with Google')}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 bg-white hover:bg-gray-50 border-gray-200"
                onClick={() => handleSocialLogin('apple')}
              >
                <Apple className="w-5 h-5 mr-3 text-gray-900" />
                {t('auth_continue_with_apple', 'Continue with Apple')}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 bg-white hover:bg-gray-50 border-gray-200"
                onClick={() => handleSocialLogin('facebook')}
              >
                <Facebook className="w-5 h-5 mr-3 text-blue-600" />
                {t('auth_continue_with_facebook', 'Continue with Facebook')}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">{t('auth_continue_with_email', 'Or continue with email')}</span>
              </div>
            </div>

            {/* Email Signup Form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">{t('auth_full_name_label', 'Full Name')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            placeholder={t('auth_full_name_placeholder', 'Tam adınızı girin')}
                            className="pl-10 h-11 bg-white border-gray-200 focus:border-blue-500"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">{t('auth_username_label', 'Username')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            placeholder={t('auth_choose_unique_username', 'Choose a unique username')}
                            className="pl-10 h-11 bg-white border-gray-200 focus:border-blue-500"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">{t('auth_email_label', 'Email Address')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            type="email"
                            placeholder={t('auth_enter_email', 'Enter your email address')}
                            className="pl-10 h-11 bg-white border-gray-200 focus:border-blue-500"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">{t('auth_password_label', 'Password')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder={t('auth_enter_password', 'Create a strong password')}
                            className="pl-10 pr-10 h-11 bg-white border-gray-200 focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">{t('auth_confirm_password_label', 'Şifreyi Onayla')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder={t('auth_confirm_password_placeholder', 'Şifrenizi onaylayın')}
                            className="pl-10 pr-10 h-11 bg-white border-gray-200 focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium"
                  disabled={signupMutation.isPending}
                >
                  {signupMutation.isPending ? t('auth_creating_account', 'Hesap Oluşturuluyor...') : t('auth_create_account_button', 'Hesap Oluştur')}
                </Button>
              </form>
            </Form>

            {/* Login Link */}
            <div className="text-center text-sm text-gray-600">
              {t('auth_already_have_account', 'Zaten hesabınız var mı?')}{" "}
              <Link href="/auth/login">
                <span className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer">
                  {t('auth_sign_in_here', 'Buradan giriş yapın')}
                </span>
              </Link>
            </div>

            {/* Terms and Privacy */}
            <div className="text-center text-xs text-gray-500">
              {t('auth_terms_agreement', 'Hesap oluşturarak')}{" "}
              <a href="/terms" className="text-blue-600 hover:underline">
                {t('auth_terms_of_service', 'Hizmet Şartları')}
              </a>{" "}
              {t('auth_and', 've')}{" "}
              <a href="/privacy" className="text-blue-600 hover:underline">
                {t('auth_privacy_policy', 'Gizlilik Politikası')}
              </a>{" "}
              {t('auth_terms_agreement_end', 'kabul etmiş olursunuz.')}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}