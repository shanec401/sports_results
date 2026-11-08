# 🏆 ArenaPick — Multi-Sport League, Fixture & Prediction Leaderboard App

**ArenaPick** is a zero-build static web application designed for **GitHub Pages**, powered by **Firebase Authentication** (Google Sign-In + Username/Password) and **Cloud Firestore** with role-based Admin Security Rules.

---

## ✨ Key Features

### 1. 🏟️ 10 Supported Sports
Create unlimited leagues and competitions across 10 sports:
- 🏑 **GAA Hurling** *(Includes automatic `Goals - Points` calculator where `1 Goal = 3 Points`, e.g. `2-22 (28)`)*
- 🏐 **GAA Gaelic Football** *(Includes automatic `Goals - Points` calculator)*
- 🏉 **Rugby Union** *(Rugby Nations Cup / Nations Championship, Six Nations, URC, Champions Cup, Rugby Championship)*
- 🏉 **Rugby League** *(Super League, NRL)*
- ⚽ **Soccer** *(Premier League, UEFA Champions League, League of Ireland)*
- 🏈 **American Football** *(NFL, NCAA College Football)*
- 🏀 **Basketball** *(NBA)*
- ⛳ **Golf** *(PGA Tour)*
- 🎾 **Tennis** *(ATP Tour)*
- 🎣 **Fishing** *(Competitive Angling Leagues)*

---

### 2. 🎯 Prediction Scoring System & Per-Team Closeness Maths
Every competition has its own live **Leaderboard** (customizable per competition by Admins). When an Admin enters a fixture's final score or runs Live Auto-Sync, all predictions are automatically graded using the following rules:

| Tier | Rule | Condition | Points Awarded |
| :--- | :--- | :--- | :--- |
| **Correct Result** | Picked the right outcome (`Home Win`, `Away Win`, or `Draw`) | `Predicted Outcome == Actual Outcome` | **+3 Points** |
| **Tier 1 Score Bonus** | **Exact / Within 7 Pts (Each Team)** | `\|PredHome - ActualHome\| <= 7` **AND** `\|PredAway - ActualAway\| <= 7` | **+3 Bonus Points** *(6 Pts Total with Result)* |
| **Tier 2 Score Bonus** | **Within 14 Pts (Each Team)** | `\|PredHome - ActualHome\| <= 14` **AND** `\|PredAway - ActualAway\| <= 14` | **+2 Bonus Points** *(5 Pts Total with Result)* |

- **Bullseye Highlight**: Predicting the exact score for both teams (`0` difference) awards the full **+3 Result** + **+3 Bonus** (**6 Points**) with a special 🎯 Bullseye badge.
- **Independent Closeness Evaluation**: Score bonuses are calculated independently of the Win/Loss outcome—so if a match is decided by a last-second 1-point swing (`22–21` vs your predicted `20–22`), you still earn your **+3 Within 7 Pts/Team** bonus!

---

### 3. 🗓️ Round-by-Round Filtering (Fixtures & Leaderboard)
- **Filter Fixtures by Round**: Each fixture belongs to a round (e.g., `Round 1`, `Round 2`, `Munster Round 1`, `Quarter-Final`, `Finals Weekend`). Players can click the **Round Filter Chips** or use the **Jump to Round** dropdown to view only that round's games.
- **Round-Specific Leaderboards**: On the **Leaderboard** tab, switch between **🏆 Full Competition (All Rounds)** and any individual round to see who topped a specific week or round.

---

### 4. 🌐 Live Internet Auto-Sync (`live-sync.js`)
Admins can automatically populate upcoming fixtures, rounds, venues, kickoff times, and completed final scores directly from the internet:
- Uses **ESPN's Public Scoreboard API**, **TheSportsDB API**, and built-in multi-round tournament schedules.
- **Supported Live Feeds**:
  - 🏉 **Rugby Union**: **Rugby Nations Cup / Nations Championship (Autumn Nations Series)**, **Guinness Six Nations**, **United Rugby Championship (URC)**, **Investec Champions Cup**, **The Rugby Championship**
  - 🏑🏐 **GAA**: **All-Ireland & Provincial Senior Hurling** and **Sam Maguire Gaelic Football** (with full Goals & Points breakdowns)
  - ⚽ **Soccer**: **English Premier League**, **UEFA Champions League**, **League of Ireland Premier Division**
  - 🏈 **American Football**: **NFL**, **NCAA College Football**
  - 🏀 **Basketball**: **NBA**
  - 🎾 **Tennis**: **ATP Tour**
  - ⛳ **Golf**: **PGA Tour**
  - 🏉 **Rugby League**: **Super League**, **NRL**
- **Two Sync Modes**:
  1. **Sync into Current Active Competition**: Adds new fixtures and updates completed final scores—automatically grading all user predictions!
  2. **Create a Brand-New Competition from Feed**: Creates the competition and imports all rounds and fixtures in one click.

---

### 5. 🔒 Members-Only Leaderboard & User Privacy
- **Logged-Out Visitors**: Can browse **Fixtures & Results** across all sports and competitions.
- **Logged-In Members Only**: The **Leaderboard**, **player standings**, **My Predictions**, and **PDF Standings Export** are locked behind authentication.
- **Database-Level Protection**: Enforced in `firestore.rules` (`match /predictions/{predId}` requires `allow read: if isSignedIn();`), preventing unauthenticated users from reading player predictions or leaderboard data.

---

### 6. 🛡️ Admin Control Center
Verified Admins (`admins/{uid}`) unlock the **Admin Control Center** and quick-action toolbar buttons to:
- **Create & Delete Competitions**: Delete any competition using the red **🗑️ Delete Competition** button next to the Active Competition selector, in the Fixtures toolbar, or inside the Admin panel (syncs deletion to Firebase Firestore and removes associated fixtures/predictions).
- **Add, Edit & Lock Fixtures**: Manually create fixtures, assign round names, or lock games at kickoff.
- **Enter Final Scores**: Supports both standard scorelines and GAA `Goals - Points` inputs with instant leaderboard recalculation.
- **Approve Player Registrations**: Approve or manage players in private/approval-gated leagues.

---

## 🔥 Complete Step-by-Step Firebase Setup Guide

Follow these steps to connect ArenaPick to your own **Firebase** project from scratch.

### Step 1: Create a Firebase Project & Web App
1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Create a project** (or select your existing project, e.g., `sports-results-dcfb6`).
2. On the Project Overview page, click the **Web icon (`</>`)** to add a web app.
3. Enter a nickname (e.g., `ArenaPick`) and click **Register app**.
4. Copy the `firebaseConfig` object shown on screen and paste the values into [`firebase-config.js`](./firebase-config.js):

```javascript
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

---

### Step 2: Enable Authentication & Authorize Your GitHub Pages Domain
1. In the Firebase Console sidebar, go to **Build** &rarr; **Authentication** and click **Get started**.
2. Under the **Sign-in method** tab:
   - Click **Email/Password**, toggle **Enable**, and click **Save** *(this powers the Username + Password sign-in in ArenaPick)*.
   - Click **Google**, toggle **Enable**, select your support email, and click **Save**.
3. Under the **Settings** tab (inside Authentication) &rarr; click **Authorized domains**:
   - Click **Add domain** and enter your GitHub Pages domain:
     ```text
     YOUR-GITHUB-USERNAME.github.io
     ```
   - *(This prevents the `auth/unauthorized-domain` error when signing in from GitHub Pages.)*

---

### Step 3: Create the Cloud Firestore Database
1. In the Firebase Console sidebar, go to **Build** &rarr; **Firestore Database** and click **Create database**.
2. Choose a location close to your users (e.g., `eur3 (europe-west)`) and click **Next**.
3. Select **Start in production mode** (or test mode) and click **Create**.

---

### Step 4: Publish the Firestore Security Rules
1. Inside **Firestore Database**, click the **Rules** tab at the top.
2. Replace everything in the editor with the contents of [`firestore.rules`](./firestore.rules) and click **Publish**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    function isApprovedFor(compId) {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/registrations/$(compId + '__' + request.auth.uid)) &&
        get(/databases/$(database)/documents/registrations/$(compId + '__' + request.auth.uid)).data.status == 'approved';
    }

    // 1. ADMINS (/admins/{uid})
    match /admins/{uid} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // 2. COMPETITIONS (/competitions/{compId})
    match /competitions/{compId} {
      allow read: if true;
      allow create, update, delete: if isAdmin();
    }

    // 3. LEAGUE REGISTRATIONS (/registrations/{regId})
    match /registrations/{regId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && (
        isAdmin() ||
        (regId == request.resource.data.competitionId + '__' + request.auth.uid
          && request.resource.data.userId == request.auth.uid
          && request.resource.data.status in ['pending', 'approved'])
      );
      allow update: if isAdmin() || (
        isSignedIn() &&
        resource.data.userId == request.auth.uid &&
        request.resource.data.userId == request.auth.uid &&
        request.resource.data.status == resource.data.status
      );
      allow delete: if isAdmin() || (
        isSignedIn() && resource.data.userId == request.auth.uid
      );
    }

    // 4. GAMES / FIXTURES (/games/{gameId})
    match /games/{gameId} {
      allow read: if true;
      allow create, update, delete: if isAdmin();
    }

    // 5. USER PREDICTIONS (/predictions/{predId}) — Locked to signed-in users only
    match /predictions/{predId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && (
        isAdmin() || (
          predId == request.resource.data.gameId + '__' + request.auth.uid &&
          request.resource.data.userId == request.auth.uid &&
          (request.resource.data.requiresApproval == false || isApprovedFor(request.resource.data.competitionId))
        )
      );
      allow update: if isAdmin() || (
        isSignedIn() &&
        resource.data.userId == request.auth.uid &&
        request.resource.data.userId == request.auth.uid
      );
      allow delete: if isAdmin() || (
        isSignedIn() && resource.data.userId == request.auth.uid
      );
    }
  }
}
```

---

### Step 5: How to Make Yourself an Admin in Firebase
Admin access is controlled by a Firestore collection named `admins` where each document ID is an Admin user's Firebase **UID**.

1. Open your live **ArenaPick** app and **Sign In** (using Google or Username/Password).
2. Click the **🛡️ Admin** tab in the top navigation bar.
3. In the box titled **"How to Make Yourself the First Admin in Firebase"**, click **📋 Copy UID** to copy your personal Firebase User ID (e.g., `xYz123AbC...`).
   - *(Alternatively, you can find any user's UID in the Firebase Console under **Authentication** &rarr; **Users** &rarr; **User UID** column.)*
4. Go to your **Firebase Console** &rarr; **Firestore Database** &rarr; **Data** tab:
   - Click **+ Start collection**.
   - Enter **`admins`** as the **Collection ID** and click **Next**.
   - Paste your copied **User UID** into the **Document ID** field.
   - Add a field:
     - **Field**: `role`
     - **Type**: `string`
     - **Value**: `admin`
   - Click **Save**.
5. Return to your ArenaPick site and click **🔄 Verify Admin Status** (or refresh the page). The **🛡️ ArenaPick Admin Control Center** will unlock immediately!

> **Tip — Adding More Admins Later**: To make another person an Admin, open your `admins` collection in **Firestore Database**, click **+ Add document**, paste their **User UID** as the **Document ID**, set `role` = `"admin"`, and click **Save**.

---

## 📦 Project File Structure & GitHub Pages Deployment

| File | Purpose |
| :--- | :--- |
| [`index.html`](./index.html) | Main application layout, modals, Round filter bars, Members-Only Leaderboard gate, and Admin Control Center |
| [`styles.css`](./styles.css) | Dark-mode stadium theme, responsive cards, round chips, and print/PDF stylesheet |
| [`app.js`](./app.js) | Application state, Firebase Auth/Firestore sync, Round filtering, Admin tools, and PDF export |
| [`sports-data.js`](./sports-data.js) | 10-sport catalog, GAA `Goals - Points` maths, `+3 / +3 (Within 7) / +2 (Within 14)` scoring calculator, and starter data |
| [`live-sync.js`](./live-sync.js) | Live internet fixture & result auto-sync engine (ESPN API, TheSportsDB, Rugby Nations Cup, and GAA schedules) |
| [`firebase-config.js`](./firebase-config.js) | Firebase project configuration |
| [`firestore.rules`](./firestore.rules) | Cloud Firestore security rules for Admins, Competitions, Fixtures, Registrations, and Members-Only Predictions |

### Deploying or Updating on GitHub Pages
1. Create a public GitHub repository (or open your existing repository).
2. Click **Add file** &rarr; **Upload files**, drag and drop all files from this folder (`index.html`, `styles.css`, `app.js`, `sports-data.js`, `live-sync.js`, `firebase-config.js`, `firestore.rules`, `README.md`), and click **Commit changes**.
3. In your repository, go to **Settings** &rarr; **Pages**, set **Source** to **Deploy from a branch**, select **`main`** (`/root`), and click **Save**.
