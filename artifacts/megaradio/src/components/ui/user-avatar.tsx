import { PublicProfileAvatar } from './public-profile-avatar';

interface UserAvatarProps {
  avatar?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function UserAvatar({ avatar, name, className = '', size = 'md' }: UserAvatarProps) {
  
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-16 w-16 md:h-20 md:w-20',
    lg: 'h-24 w-24 md:h-32 md:w-32'
  };

  return <PublicProfileAvatar profile={{ avatar }} name={name || 'User avatar'}
    size={size === 'sm' ? 32 : size === 'lg' ? 128 : 80}
    className={`${sizeClasses[size]} ${className}`} />;
}
