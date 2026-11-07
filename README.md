# 🏆 ArenaPick — Multi-Sport Competition, Fixture & Prediction Leaderboard App

ArenaPick is a zero-build static web application for **GitHub Pages** backed by **Firebase Authentication** (Google + Username/Password) and **Cloud Firestore** with Admin security rules.

---

## 🏟️ Supported Sports (10 Sports)
- 🏑 **GAA Hurling** *(Includes automatic `Goals - Points` calculator where 1 Goal = 3 Points!)*
- 🏐 **GAA Gaelic Football** *(Includes automatic `Goals - Points` calculator!)*
- 🏉 **Rugby Union**
- 🏉 **Rugby League**
- ⚽ **Soccer**
- 🏈 **American Football**
- 🏀 **Basketball**
- ⛳ **Golf**
- 🎾 **Tennis**
- 🎣 **Fishing**

---

## ⚡ Prediction Scoring System
Each competition tracks its own **Leaderboard** using the following scoring tiers (customizable per league by Admins):
1. **Correct Result (Win / Loss / Draw)**: **+3 Points**
2. **Exact / Close Score Bonus (Exact or within 2 pts)**: **+3 Bonus Points** (6 Points Total)
3. **Within 5 Points of Score Bonus**: **+2 Bonus Points** (5 Points Total)

---

## 🚀 Setup Guide (Firebase + GitHub Pages)

1. Create a new project in the [Firebase Console](https://console.firebase.google.com/).
2. Register a Web App (`</>`) and paste your `firebaseConfig` into `firebase-config.js` (or click **Local / Setup DB** in the top navigation bar of the live site).
3. Enable **Authentication** &rarr; **Email/Password** and **Google**, and add your `YOUR-USERNAME.github.io` domain under **Authorized domains**.
4. Create a **Firestore Database** and paste the rules from `firestore.rules` into the **Rules** tab.
5. Upload the files in this folder to a new GitHub repository and enable **Settings &rarr; Pages &rarr; Deploy from `main` branch**.
