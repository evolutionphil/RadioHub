import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');

  const email = process.argv[2];
  const password = process.argv[3];
  const username = process.argv[4] || email.split('@')[0];
  const fullName = process.argv[5] || username;

  if (!email || !password) {
    console.error('Kullanım: npx tsx scripts/create-admin.ts <email> <password> [username] [fullName]');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const users = db.collection('users');

  const existing = await users.findOne({ email });
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash,
          role: 'admin',
          status: 'active',
          emailVerified: true,
          permissions: {
            canManageStations: true,
            canManageUsers: true,
            canRunSync: true,
            canViewAnalytics: true,
            canExportData: true,
          },
          updatedAt: now,
        },
      }
    );
    console.log('✓ Mevcut kullanıcı admin yapıldı + şifre güncellendi:', email);
    console.log('  _id:', existing._id.toString());
    console.log('  username:', existing.username);
  } else {
    const doc = {
      username,
      email,
      passwordHash,
      fullName,
      role: 'admin',
      status: 'active',
      emailVerified: true,
      isPublicProfile: false,
      isSeedProfile: false,
      favoriteStations: [],
      recentlyPlayedStations: [],
      following: [],
      followers: [],
      followersCount: 0,
      followingCount: 0,
      preferences: {
        theme: 'dark',
        language: 'en',
        autoplay: false,
        volume: 80,
        notificationsEnabled: true,
        playAtLogin: 'LAST_PLAYED',
      },
      permissions: {
        canManageStations: true,
        canManageUsers: true,
        canRunSync: true,
        canViewAnalytics: true,
        canExportData: true,
      },
      privacy: {
        profileVisibility: 'public',
        showFavorites: true,
        showListeningHistory: false,
        showStatistics: true,
        allowPublicCollections: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const res = await users.insertOne(doc as any);
    console.log('✓ Yeni admin oluşturuldu:', email);
    console.log('  _id:', res.insertedId.toString());
    console.log('  username:', username);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
