import webpush from 'web-push';

/**
 * Generate VAPID key pair for push notifications
 * Run this once to generate keys for your application
 */
export function generateVapidKeys() {
  const vapidKeys = webpush.generateVAPIDKeys();
  
  // console.log('🔑 VAPID Keys Generated:');
  // console.log('='.repeat(50));
  // console.log('Public Key:');
  // console.log(vapidKeys.publicKey);
  // console.log('\nPrivate Key:');
  // console.log(vapidKeys.privateKey);
  // console.log('='.repeat(50));
  // console.log('\nAdd these to your environment variables:');
  // console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  // console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  // console.log('\nFor client-side access, also add:');
  // console.log(`VITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  
  return vapidKeys;
}

// Run directly if this file is executed
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  generateVapidKeys();
}