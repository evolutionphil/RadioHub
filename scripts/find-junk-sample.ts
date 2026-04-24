import 'dotenv/config';
import mongoose from 'mongoose';
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.db!.collection('stations');
  const junks = await col.find({ noIndex: true }, { projection: { slug:1, name:1, countryCode:1, _id:0 } }).limit(5).toArray();
  console.log('noIndex=true junk örnekleri:');
  for (const j of junks) console.log(' ', JSON.stringify(j));
  await mongoose.disconnect();
})();
