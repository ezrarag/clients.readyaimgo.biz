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
  console.log("=== WORKSPACE INFO ===");
  const wsDoc = await db.collection("workspaces").doc("Wwy2KrS5g3D47REVczlm").get();
  if (wsDoc.exists) {
    console.log("Workspace Wwy2KrS5g3D47REVczlm exists!");
    console.log(JSON.stringify(wsDoc.data(), null, 2));
  } else {
    console.log("Workspace Wwy2KrS5g3D47REVczlm does NOT exist");
  }
}

main().catch(console.error);
