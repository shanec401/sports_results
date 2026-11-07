// ============================================================================
// FIREBASE CONFIGURATION — SPORTS LEAGUE & PREDICTION HUB
// ============================================================================
// Configured for Firebase project: sports-results-dcfb6

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCmUSdT1dQgmPlnvdmW9VnhH0wJJ582vR0",
  authDomain: "sports-results-dcfb6.firebaseapp.com",
  projectId: "sports-results-dcfb6",
  storageBucket: "sports-results-dcfb6.firebasestorage.app",
  messagingSenderId: "427084615882",
  appId: "1:427084615882:web:c52cbdfc4aa6b5074ee433",
  measurementId: "G-3B1YPBHVRT"
};

export function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem("sportshub_firebase_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && parsed.apiKey !== "YOUR_API_KEY") {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read saved Firebase config:", e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

export function isFirebaseConfigured(config = getActiveFirebaseConfig()) {
  return Boolean(
    config &&
    config.apiKey &&
    config.apiKey !== "YOUR_API_KEY" &&
    config.projectId &&
    config.projectId !== "YOUR_PROJECT_ID"
  );
}
