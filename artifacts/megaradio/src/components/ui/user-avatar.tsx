import React, { useState } from 'react';

interface UserAvatarProps {
  avatar?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function UserAvatar({ avatar, name, className = '', size = 'md' }: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);
  
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-16 w-16 md:h-20 md:w-20',
    lg: 'h-24 w-24 md:h-32 md:w-32'
  };

  const handleImageError = () => {
    setImageError(true);
  };

  // Use avatar if available and no error, otherwise fallback
  const shouldShowAvatar = avatar && !imageError;

  return (
    <div className={`${sizeClasses[size]} rounded-full ${className}`}>
      {shouldShowAvatar ? (
        <img 
          className={`${sizeClasses[size]} rounded-full object-cover`}
          src={avatar}
          alt={name || 'User avatar'}
          onError={handleImageError}
          loading="lazy"
        />
      ) : (
        <img 
          className={`${sizeClasses[size]} rounded-full object-cover`}
          src="/no-avatar.svg"
          alt={name || 'User avatar'}
          loading="lazy"
        />
      )}
    </div>
  );
}