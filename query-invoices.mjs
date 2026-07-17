import fs from 'fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.trim()?.replace(/^"/, '')?.replace(/"$/, '')?.replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore();

async function main() {
  console.log("=== QUERYING CLIENTS & INVOICES ===");
  const clientsSnap = await db.collection("clients").get();
  
  for (const clientDoc of clientsSnap.docs) {
    const clientId = clientDoc.id;
    const clientData = clientDoc.data();
    
    const invoicesSnap = await db.collection("clients").doc(clientId).collection("invoices").get();
    if (invoicesSnap.size > 0) {
      console.log(`\nClient ID: ${clientId} (${clientData.name || 'Unnamed'})`);
      for (const invDoc of invoicesSnap.docs) {
        const invData = invDoc.data();
        console.log(`    - Invoice ID: ${invDoc.id}`);
        console.log(`      Number: ${invData.invoiceNumber}`);
        console.log(`      Title: ${invData.title}`);
        console.log(`      Status: ${invData.status}`);
        
        const html = invData.renderedHtml || "";
        if (html) {
          let clean = true;
          for (let i = 0; i < html.length; i++) {
            const code = html.charCodeAt(i);
            if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
              clean = false;
              console.log(`      [WARNING] Found illegal control character at index ${i} (hex: ${code.toString(16)}):`);
              console.log(`      Context: "${html.slice(Math.max(0, i - 15), i + 15)}"`);
            }
          }
          if (clean) {
            console.log(`      Rendered HTML is clean of illegal control characters`);
          }
        } else {
          console.log(`      Rendered HTML is empty or missing`);
        }
      }
    }
  }
}

main().catch(console.error);
