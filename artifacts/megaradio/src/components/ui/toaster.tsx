import { useToast } from "@/hooks/use-toast"
import { Heart, Check } from "lucide-react"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()
  const favoriteVisible = toasts.some(({ variant }) => variant === 'favorite' || variant === 'favorite-removed')

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, closeLabel, ...props }) {
        const favorite = props.variant === 'favorite' || props.variant === 'favorite-removed'
        return (
          <Toast key={id} {...props} style={favorite ? { paddingInlineStart: 12, paddingInlineEnd: 56, ...props.style } : props.style}>
            {favorite && <div aria-hidden="true" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff4199]/10 text-[#ff4199]">
              <Heart className="h-[19px] w-[19px]" fill={props.variant === 'favorite' ? 'currentColor' : 'none'} strokeWidth={1.7} />
              {props.variant === 'favorite' && <Check className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-[#1b1b1f] p-0.5 text-white" strokeWidth={2.5} />}
            </div>}
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && <ToastTitle className={favorite ? 'text-[13px] leading-5 [overflow-wrap:anywhere]' : undefined}>{title}</ToastTitle>}
              {description && (
                <ToastDescription className={favorite ? 'line-clamp-2 text-xs leading-[18px] text-white/60' : undefined}>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose aria-label={closeLabel || 'Dismiss notification'} style={favorite ? { right: 'auto', insetInlineEnd: 4 } : undefined} className={favorite ? 'top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-white/60 opacity-100 hover:bg-white/5 hover:text-white focus-visible:ring-[#ff4199]' : undefined} />
          </Toast>
        )
      })}
      <ToastViewport className={favoriteVisible ? 'pointer-events-none left-0 right-0 top-[calc(env(safe-area-inset-top,0px)+76px)] mx-auto max-h-[40vh] max-w-[420px] p-3 sm:bottom-auto sm:left-auto sm:top-[calc(env(safe-area-inset-top,0px)+88px)] sm:mx-0' : undefined} />
    </ToastProvider>
  )
}
