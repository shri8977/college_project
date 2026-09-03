/// <reference types="vite/client" />
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, doc, getDocFromServer } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const databaseId = firebaseConfig.firestoreDatabaseId;
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
}, databaseId || '(default)');

export const storage = getStorage(app);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration or network status.", error.message);
    }
  }
}
testConnection();

export default app;


