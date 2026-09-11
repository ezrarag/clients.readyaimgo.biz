import fs from 'fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Load env variables
const envPath = './.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const getEnvVal = (key) => {
  const match = envContent.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`)) || envContent.match(new RegExp(`${key}\\s*=\\s*([^\\n\\r]+)`));
  return match ? (match[1] || match[2]).replace(/\\n/g, '\n').replace(/\r/g, '').trim() : '';
};

process.env.FIREBASE_PROJECT_ID = getEnvVal('FIREBASE_PROJECT_ID');
process.env.FIREBASE_CLIENT_EMAIL = getEnvVal('FIREBASE_CLIENT_EMAIL');
process.env.FIREBASE_PRIVATE_KEY = getEnvVal('FIREBASE_PRIVATE_KEY');

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  }),
});

const db = getFirestore();

async function main() {
  const docsToUpdate = ["XaAngtg19mk3sdRnc7Bi", "mWP1rgpgb7fPEj97RmPw"];
  console.log("=== MIGRATING RECENT MKEBLACK FEEDBACKS ===");
  
  for (const id of docsToUpdate) {
    const docRef = db.collection("clientFeedback").doc(id);
    const snap = await docRef.get();
    if (snap.exists) {
      await docRef.update({ projectId: "SUwqw3jWvGC1aImcJZsh" });
      console.log(`Updated feedback document ${id} projectId to SUwqw3jWvGC1aImcJZsh`);
    } else {
      console.log(`Document ${id} not found`);
    }
  }
}

main().catch(console.error);
