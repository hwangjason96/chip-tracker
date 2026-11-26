// ---------------------------------------------------------------------------
// Optional: live sync between friends' phones with Firebase Realtime Database.
//
// Leave FIREBASE_CONFIG as null and the app saves to this browser only
// (great if one person runs the "bank" on one device).
//
// To share live across devices, see README.md → "Enable live sync", then paste
// your Firebase web config here, commit, and push.
// ---------------------------------------------------------------------------
// These values identify the Firebase project; they are not secrets.
// Access is controlled by the Realtime Database rules (only rooms/<room> is open).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCkuhTNDhVTwB3oklysTWtTT-FrtXzJQ00",
  authDomain: "chip-tracker-cf94b.firebaseapp.com",
  databaseURL: "https://chip-tracker-cf94b-default-rtdb.firebaseio.com",
  projectId: "chip-tracker-cf94b",
  storageBucket: "chip-tracker-cf94b.firebasestorage.app",
  messagingSenderId: "974963940219",
  appId: "1:974963940219:web:b3a853d22044c696027bde"
};
