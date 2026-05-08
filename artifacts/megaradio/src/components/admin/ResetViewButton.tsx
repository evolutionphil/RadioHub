import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ResetViewButtonProps {
  hasNonDefaultPrefs: boolean;
  reset: () => void;
  className?: string;
  toastDescription?: string;
  testId?: string;
  title?: string;
}

export function ResetViewButton({
  hasNonDefaultPrefs,
  reset,
  className = 'whitespace-nowrap',
  toastDescription = 'View preferences restored to defaults on this device and your account.',
  testId = 'button-reset-view',
  title = 'Reset view preferences on this device and your account',
}: ResetViewButtonProps) {
  const { toast } = useToast();

  if (!hasNonDefaultPrefs) return null;

  const handleClick = () => {
    reset();
    toast({
      title: 'View reset',
      description: toastDescription,
    });
  };

  return (
    <Button
      data-testid={testId}
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className={className}
      title={title}
    >
      <X className="mr-2 h-4 w-4" />
      Reset view
    </Button>
  );
}
