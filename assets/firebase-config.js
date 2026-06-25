// Shared Firebase initialization for both the admin console (index.html)
// and the public poll widget (poll.html / embed snippet).
//
// Everything loads from the gstatic CDN so the files work as plain static
// HTML — no build step — which is what lets the widget run on WordPress / Wix.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore-lite.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCA0R6hobL-i85-eGTkhpOyy4FL30Ei2pQ",
  authDomain: "polling-d51ee.firebaseapp.com",
  projectId: "polling-d51ee",
  storageBucket: "polling-d51ee.firebasestorage.app",
  messagingSenderId: "780130776841",
  appId: "1:780130776841:web:83993c9eb8ce84b44e45d8",
  measurementId: "G-4Q0NMWE8FQ"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
