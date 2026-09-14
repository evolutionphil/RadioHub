const text = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/** Public identity only. Never turn a private email address into a display name. */
export function publicUserIdentity(user: Record<string, any>) {
  const fullName = text(user.fullName, user.full_name);
  const username = text(user.username);
  const name = fullName || text(user.name, user.displayName) || username || 'User';
  const avatar = text(user.avatar, user.profileImageUrl, user.profile_image_url) || null;
  return { name, fullName, displayName: name, username, avatar, profileImageUrl: avatar };
}
