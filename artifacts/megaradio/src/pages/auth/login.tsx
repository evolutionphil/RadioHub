import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useNotificationService } from "@/services/NotificationService";
import { apiRequest } from "@/lib/queryClient";
import { FormTextInput } from "@/components/forms/FormTextInput";
import { SocialLoginButtonGroup } from "@/components/ui/social-login-button-group";
import { useTranslation } from "@/hooks/useTranslation";


interface LoginFormData {
  email: string;
  password: string;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const notificationService = useNotificationService();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [loginForm, setLoginForm] = useState<LoginFormData>({
    email: "",
    password: ""
  });
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const res = await apiRequest("POST", "/api/auth/login", { body: data });
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Welcome back!",
        description: "You have been successfully logged in.",
        variant: "default"
      });
      
      // Show rich notification for successful login
      notificationService.loginSuccess(data?.user?.fullName || data?.user?.username || "User");
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/");
    },
    onError: (error: any) => {
      setError("Invalid username/password.");
      // Show failure notification
      notificationService.loginFailed("Invalid email or password. Please check your credentials and try again.");
    }
  });



  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    loginMutation.mutate(loginForm);
  };

  return (
    <div>
      {/* Header */}
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold text-white md:text-3xl">
            {t('login', 'Login')}
          </h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto pb-10 text-white">
        <div className="mx-auto w-full max-w-[345px]">
          {/* Social Login Buttons */}
          <SocialLoginButtonGroup />

          {/* Title */}
          <div className="py-8 text-center text-xl font-bold sm:text-3xl">
            {t('login_manage_profile', 'Manage your profile')} <br />
            {t('login_enjoy_listen', 'Enjoy when you listen')}
          </div>

          {/* Login Form */}
          <div className="mx-auto flex w-full max-w-[310px] flex-col justify-center">
            <form onSubmit={submitForm} className="space-y-5">
              {error && (
                <p className="text-center font-bold text-[#FF4199]">
                  {error}
                </p>
              )}

              <FormTextInput
                placeholder={t('email', 'E-Mail')}
                name="email"
                value={loginForm.email}
                onChange={(value) => setLoginForm(prev => ({ ...prev, email: value }))}
                type="email"
              >
                <img loading="lazy" className="w-5" src="/icons/email.svg" alt="Email icon" />
              </FormTextInput>

              <FormTextInput
                placeholder={t('password', 'Password')}
                name="password"
                value={loginForm.password}
                onChange={(value) => setLoginForm(prev => ({ ...prev, password: value }))}
                type="password"
              >
                <img loading="lazy" className="w-5" src="/icons/password.svg" alt="Password icon" />
              </FormTextInput>

              <button
                className="mb-6 flex justify-center items-center overflow-hidden py-3 w-full cursor-pointer border-0 bg-[#FF4199] rounded text-xl font-medium focus:outline-none focus:ring-0 text-white disabled:opacity-50"
                type="submit"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? t('logging_in', 'Logging in...') : t('log_in', 'Log in')}
              </button>

              <Link href="/auth/forgot-password">
                <span className="block text-center text-xl font-medium text-[#FFFFFF30] underline cursor-pointer">
                  {t('forgot_password', 'Forget your password?')}
                </span>
              </Link>
            </form>
          </div>
        </div>


      </div>
    </div>
  );
}